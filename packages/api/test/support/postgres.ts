import { randomUUID } from "node:crypto";
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

function swapDatabase(url: string, dbName: string): string {
  return url.replace(/\/[^/?]+(\?[^#]*)?$/, `/${dbName}$1`);
}

/**
 * A migrated PostgreSQL database in a per-call throwaway *database*, so parallel
 * test files never collide. Tables live in that database's `public` schema; no
 * `search_path` juggling. `DATABASE_URL` must point at the CI postgres server.
 * The runtime adapter's `search_path=chotu` behaviour (FR-1.9) is covered by
 * `adapters.test.ts`.
 */
export async function openMigratedPostgres(
  url: string,
): Promise<MigratedPostgres> {
  const dbName = `chotu_test_${randomUUID().replace(/-/g, "").slice(0, 16)}`;

  const admin = postgres(url, { max: 1, onnotice: () => undefined });
  await admin.unsafe(`create database "${dbName}"`);
  await admin.end();

  const handle = makePostgres(swapDatabase(url, dbName), { schemaName: "public" });
  await migrate(handle.db, { migrationsFolder });

  return {
    handle,
    cleanup: async () => {
      await handle.close();
      const admin2 = postgres(url, { max: 1, onnotice: () => undefined });
      await admin2.unsafe(`drop database if exists "${dbName}" with (force)`);
      await admin2.end();
    },
  };
}
