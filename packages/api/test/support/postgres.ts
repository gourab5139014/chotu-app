import { fileURLToPath } from "node:url";

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
 * A migrated PostgreSQL database for the round-trip and repository tests.
 * `DATABASE_URL` must point at a throwaway server (the CI postgres matrix leg).
 * The `public` schema is reset and re-migrated on every open, so tests do not
 * see each other's rows. The runtime adapter's own `search_path` behaviour
 * (FR-1.9) is covered by `adapters.test.ts`.
 */
export async function openMigratedPostgres(
  url: string,
): Promise<MigratedPostgres> {
  const admin = postgres(url, { max: 1, onnotice: () => undefined });
  await admin`drop schema if exists public cascade`;
  await admin`create schema public`;
  await admin.end();

  const handle = makePostgres(url, { schemaName: "public" });
  await migrate(handle.db, { migrationsFolder });

  return {
    handle,
    cleanup: () => handle.close(),
  };
}
