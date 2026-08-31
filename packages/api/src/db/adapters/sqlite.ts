import Database from "better-sqlite3";
import { drizzle, type BetterSQLite3Database } from "drizzle-orm/better-sqlite3";

import * as schema from "../schema/sqlite";

export interface SqliteHandle {
  readonly dialect: "sqlite";
  readonly db: BetterSQLite3Database<typeof schema>;
  readonly client: Database.Database;
  close(): Promise<void>;
}

/** `file:./x.db`, `file::memory:`, `:memory:`, or a bare path. */
function resolvePath(url: string): string {
  const stripped = url.startsWith("file:") ? url.slice("file:".length) : url;
  return stripped === "" || stripped === ":memory:" ? ":memory:" : stripped;
}

/**
 * SQLite adapter. Development and test only (FR-1.10). Every connection turns
 * foreign keys ON — off by default in SQLite, and INV-1 plus the `on delete`
 * guards depend on it — sets WAL, and a busy timeout so `BEGIN IMMEDIATE`
 * contention waits instead of failing immediately.
 */
export function makeSqlite(url: string): SqliteHandle {
  const client = new Database(resolvePath(url));
  client.pragma("journal_mode = WAL");
  client.pragma("foreign_keys = ON");
  client.pragma("busy_timeout = 5000");
  return {
    dialect: "sqlite",
    db: drizzle(client, { schema }),
    client,
    close: () =>
      new Promise<void>((resolve) => {
        client.close();
        resolve();
      }),
  };
}
