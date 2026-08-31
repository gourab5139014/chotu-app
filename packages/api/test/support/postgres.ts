import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";

import { sql } from "drizzle-orm";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";

import { makePostgres, type PostgresHandle } from "../../src/db/adapters/postgres";

const migrationsFolder = fileURLToPath(
  new URL("../../src/db/migrations/postgres", import.meta.url),
);

export interface MigratedPostgres {
  readonly handle: PostgresHandle;
  cleanup(): Promise<void>;
}

/**
 * A migrated PostgreSQL database in a per-call throwaway schema, so parallel
 * test files do not collide on the shared CI database. The handle uses a single
 * connection (`max: 1`) plus a `search_path` startup parameter, so every query
 * lands in that schema. `DATABASE_URL` must point at the CI postgres server.
 */
export async function openMigratedPostgres(
  url: string,
): Promise<MigratedPostgres> {
  const schemaName = `chotu_test_${randomUUID().replace(/-/g, "").slice(0, 16)}`;

  const admin = postgres(url, { max: 1, onnotice: () => undefined });
  await admin.unsafe(`create schema "${schemaName}"`);
  await admin.end();

  const handle = makePostgres(url, { schemaName, max: 1 });
  await handle.db.execute(sql.raw(`set search_path to "${schemaName}"`));
  await migrate(handle.db, { migrationsFolder });

  return {
    handle,
    cleanup: async () => {
      await handle.db.execute(
        sql.raw(`drop schema if exists "${schemaName}" cascade`),
      );
      await handle.close();
    },
  };
}
