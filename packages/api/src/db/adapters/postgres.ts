import { drizzle, type PostgresJsDatabase } from "drizzle-orm/postgres-js";
import postgres from "postgres";

import * as schema from "../schema/pg";

export interface PostgresHandle {
  readonly dialect: "postgres";
  readonly db: PostgresJsDatabase<typeof schema>;
  readonly client: postgres.Sql;
  close(): Promise<void>;
}

/**
 * PostgreSQL adapter. `search_path` is pinned to the Chotu schema per
 * connection so the runtime cannot see or touch another schema (FR-1.9).
 */
export function makePostgres(
  url: string,
  opts: { schemaName?: string; max?: number } = {},
): PostgresHandle {
  const schemaName = opts.schemaName ?? "chotu";
  const client = postgres(url, {
    max: opts.max ?? 10,
    onnotice: () => undefined,
    connection: { search_path: schemaName },
  });
  return {
    dialect: "postgres",
    db: drizzle(client, { schema }),
    client,
    close: () => client.end({ timeout: 5 }),
  };
}
