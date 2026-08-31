import type { SQL } from "drizzle-orm";

import { makePostgres, type PostgresHandle } from "./adapters/postgres";
import { makeSqlite, type SqliteHandle } from "./adapters/sqlite";

export type { PostgresHandle } from "./adapters/postgres";
export type { SqliteHandle } from "./adapters/sqlite";

export type DbHandle = PostgresHandle | SqliteHandle;
export type Adapter = DbHandle["dialect"];

/** Pick the adapter from the connection URL scheme. */
export function adapterFor(url: string): Adapter {
  if (url.startsWith("postgres://") || url.startsWith("postgresql://")) {
    return "postgres";
  }
  if (url.startsWith("file:") || url.startsWith("sqlite:") || url === ":memory:") {
    return "sqlite";
  }
  const scheme = url.split(":", 1)[0] ?? url;
  throw new Error(
    `Unrecognised database URL scheme "${scheme}". Use postgres:// or file:.`,
  );
}

export function makeDb(url: string): DbHandle {
  return adapterFor(url) === "postgres" ? makePostgres(url) : makeSqlite(url);
}

/** Run a raw SQL query on either dialect and return the rows. */
export async function sqlQuery<T = Record<string, unknown>>(
  handle: DbHandle,
  chunk: SQL,
): Promise<T[]> {
  if (handle.dialect === "postgres") {
    return (await handle.db.execute(chunk)) as unknown as T[];
  }
  return handle.db.all(chunk);
}

/** Run a raw SQL statement on either dialect for its effect. */
export async function sqlRun(handle: DbHandle, chunk: SQL): Promise<void> {
  if (handle.dialect === "postgres") {
    await handle.db.execute(chunk);
  } else {
    handle.db.run(chunk);
  }
}
