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
