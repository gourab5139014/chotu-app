import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { migrate } from "drizzle-orm/better-sqlite3/migrator";

import { makeSqlite, type SqliteHandle } from "../../src/db/adapters/sqlite";

const migrationsFolder = fileURLToPath(
  new URL("../../src/db/migrations/sqlite", import.meta.url),
);

export interface MigratedSqlite {
  readonly handle: SqliteHandle;
  cleanup(): Promise<void>;
}

/** A fresh temp SQLite database with every migration applied. */
export function openMigratedSqlite(): MigratedSqlite {
  const dir = mkdtempSync(join(tmpdir(), "chotu-test-"));
  const handle = makeSqlite(`file:${join(dir, "t.db")}`);
  migrate(handle.db, { migrationsFolder });
  return {
    handle,
    cleanup: async () => {
      await handle.close();
      rmSync(dir, { recursive: true, force: true });
    },
  };
}
