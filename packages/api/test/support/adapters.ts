import { afterAll, beforeAll, describe } from "vitest";

import { makeRepos } from "../../src/db/repositories";
import type { DbHandle } from "../../src/db/index";
import type { Repos } from "../../src/domain/ports";

import { openMigratedPostgres } from "./postgres";
import { openMigratedSqlite } from "./sqlite";

export interface AdapterCtx {
  readonly name: "sqlite" | "postgres";
  readonly handle: DbHandle;
  readonly repos: Repos;
}

const pgUrl = process.env["DATABASE_URL"];
const hasPg = typeof pgUrl === "string" && pgUrl.startsWith("postgres");

/**
 * Run `body` once per available adapter — SQLite always, PostgreSQL when
 * `DATABASE_URL` points at a server (the CI postgres matrix leg). Each adapter
 * gets a fresh migrated database for the whole block.
 */
export function describeEachAdapter(
  title: string,
  body: (ctx: () => AdapterCtx) => void,
): void {
  const targets: Array<"sqlite" | "postgres"> = hasPg
    ? ["sqlite", "postgres"]
    : ["sqlite"];

  for (const name of targets) {
    describe(`${title} [${name}]`, () => {
      let ctx: AdapterCtx;
      let cleanup: () => Promise<void>;

      beforeAll(async () => {
        if (name === "postgres") {
          const mig = await openMigratedPostgres(pgUrl as string);
          ctx = { name, handle: mig.handle, repos: makeRepos(mig.handle) };
          cleanup = () => mig.cleanup();
        } else {
          const mig = openMigratedSqlite();
          ctx = { name, handle: mig.handle, repos: makeRepos(mig.handle) };
          cleanup = () => mig.cleanup();
        }
      });

      afterAll(async () => {
        await cleanup?.();
      });

      body(() => ctx);
    });
  }
}
