import { sql } from "drizzle-orm";

import type { DbHandle, PostgresHandle, SqliteHandle } from "./index";

/**
 * Unit of work: run a callback inside one transaction, with optional row locks
 * taken before the callback runs.
 *
 * PostgreSQL takes `SELECT ... FOR UPDATE` on the named rows. SQLite opens the
 * transaction with `BEGIN IMMEDIATE`, which holds the database write lock for
 * the whole body, so the per-row locks are implicit.
 *
 * `better-sqlite3` rejects a promise-returning transaction callback outright,
 * so on SQLite the callback MUST be synchronous — no `async`, no `await` on a
 * non-resolved promise, no returned promise. A violating callback fails fast
 * with `UnitOfWorkAsyncError` and the transaction rolls back.
 *
 * See specs/0001-m1-trusted-fuel-logging/plan.md section 4.
 */

export class UnitOfWorkAsyncError extends Error {
  constructor() {
    super(
      "On SQLite a uow.run callback must be synchronous: no async/await, no returned promise.",
    );
    this.name = "UnitOfWorkAsyncError";
  }
}

export interface UowLocks {
  /** Lock the `deployment_settings` singleton (INV-6, last active admin). */
  readonly settings?: boolean;
  /** Lock a `vehicle` row (INV-2, odometer progression). */
  readonly vehicleId?: string;
}

export type Tx =
  | { readonly dialect: "postgres"; readonly db: PostgresHandle["db"] }
  | { readonly dialect: "sqlite"; readonly db: SqliteHandle["db"] };

export interface UnitOfWork {
  run<T>(locks: UowLocks, fn: (tx: Tx) => T | Promise<T>): Promise<T>;
}

function isThenable(value: unknown): value is PromiseLike<unknown> {
  return (
    value != null && typeof (value as { then?: unknown }).then === "function"
  );
}

/**
 * Run an ordered list of transaction steps in one `uow.run`.
 *
 * Each step calls the dialect-agnostic `*InTx` helpers (sync on SQLite, a
 * promise on PostgreSQL) and may throw to abort and roll the whole
 * transaction back. This hides the "SQLite callback must be synchronous" split
 * from the caller: on PostgreSQL the steps are chained with `await`, on SQLite
 * they run in order and a step that returns a promise fails fast with
 * `UnitOfWorkAsyncError`.
 */
export function runTxSteps(
  uow: UnitOfWork,
  locks: UowLocks,
  steps: ReadonlyArray<(tx: Tx) => unknown>,
): Promise<void> {
  return uow.run(locks, (tx) => {
    if (tx.dialect === "postgres") {
      let chain: Promise<unknown> = Promise.resolve();
      for (const step of steps) chain = chain.then(() => step(tx));
      return chain.then(() => undefined);
    }
    for (const step of steps) {
      if (isThenable(step(tx))) throw new UnitOfWorkAsyncError();
    }
    return undefined;
  });
}

export function makeUnitOfWork(handle: DbHandle): UnitOfWork {
  if (handle.dialect === "postgres") {
    const { db } = handle;
    return {
      run(locks, fn) {
        return db.transaction(async (pgTx) => {
          if (locks.settings) {
            await pgTx.execute(
              sql`select 1 from deployment_settings where id = 'singleton' for update`,
            );
          }
          if (locks.vehicleId != null) {
            await pgTx.execute(
              sql`select 1 from vehicle where id = ${locks.vehicleId} for update`,
            );
          }
          // The transaction object carries the same query interface as the db.
          return fn({ dialect: "postgres", db: pgTx as PostgresHandle["db"] });
        });
      },
    };
  }

  const { db } = handle;
  return {
    run(_locks, fn) {
      return Promise.resolve().then(() =>
        db.transaction(
          (sqTx) => {
            const result = fn({
              dialect: "sqlite",
              db: sqTx as SqliteHandle["db"],
            });
            if (isThenable(result)) {
              throw new UnitOfWorkAsyncError();
            }
            return result;
          },
          { behavior: "immediate" },
        ),
      );
    },
  };
}
