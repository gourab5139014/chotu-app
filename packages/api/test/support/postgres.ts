import { fileURLToPath } from "node:url";

import { sql } from "drizzle-orm";
import { migrate } from "drizzle-orm/postgres-js/migrator";

import { makePostgres, type PostgresHandle } from "../../src/db/adapters/postgres";

const migrationsFolder = fileURLToPath(
  new URL("../../src/db/migrations/postgres", import.meta.url),
);

export interface MigratedPostgres {
  readonly handle: PostgresHandle;
  cleanup(): Promise<void>;
}

/**
 * A migrated PostgreSQL database in a throwaway `chotu` schema. Requires
 * `DATABASE_URL` to point at a reachable server (the CI postgres matrix leg).
 */
export async function openMigratedPostgres(url: string): Promise<MigratedPostgres> {
  const bootstrap = makePostgres(url, { schemaName: "public" });
  await bootstrap.client`drop schema if exists chotu cascade`;
  await bootstrap.client`create schema chotu`;
  await bootstrap.close();

  const handle = makePostgres(url);
  await handle.db.execute(sql`set search_path to chotu`);
  await migrate(handle.db, { migrationsFolder, migrationsSchema: "chotu" });

  return {
    handle,
    cleanup: async () => {
      await handle.client`drop schema if exists chotu cascade`;
      await handle.close();
    },
  };
}
