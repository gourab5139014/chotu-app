import { sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";

import {
  assertSchemaSupported,
  bootstrapSchema,
  readSchemaVersion,
  SchemaVersionError,
} from "../../src/db/bootstrap";
import { CURRENT_SCHEMA_VERSION } from "../../src/db/schema/version";
import { sqlQuery, sqlRun, type DbHandle } from "../../src/db/index";
import { openRawPostgres } from "../support/postgres";
import { openRawSqlite } from "../support/sqlite";

const url = process.env["DATABASE_URL"];
const hasPg = typeof url === "string" && url.startsWith("postgres");

async function withRaw(
  name: "sqlite" | "postgres",
  fn: (handle: DbHandle) => Promise<void>,
): Promise<void> {
  const mig =
    name === "postgres"
      ? await openRawPostgres(url as string)
      : openRawSqlite();
  try {
    await fn(mig.handle);
  } finally {
    await mig.cleanup();
  }
}

const adapters: Array<"sqlite" | "postgres"> = hasPg
  ? ["sqlite", "postgres"]
  : ["sqlite"];

for (const name of adapters) {
  describe(`bootstrapSchema [${name}]`, () => {
    it("migrates a fresh database and records the schema version", async () => {
      await withRaw(name, async (handle) => {
        await bootstrapSchema(handle, { build: "test-1" });

        // A migrated table is queryable.
        const users = await sqlQuery<{ n: number }>(
          handle,
          sql`select count(*) as n from "user"`,
        );
        expect(Number(users[0]?.n)).toBe(0);

        expect(await readSchemaVersion(handle)).toBe(CURRENT_SCHEMA_VERSION);
        await expect(assertSchemaSupported(handle)).resolves.toBeUndefined();
      });
    });

    it("assertSchemaSupported rejects a version outside the window (FR-1.3)", async () => {
      await withRaw(name, async (handle) => {
        await bootstrapSchema(handle, { build: "test-2" });
        await sqlRun(handle, 
          sql`update schema_meta set schema_version = 9999 where id = 'singleton'`,
        );
        await expect(assertSchemaSupported(handle)).rejects.toBeInstanceOf(
          SchemaVersionError,
        );
      });
    });

    it("assertSchemaSupported rejects when schema_meta is empty", async () => {
      await withRaw(name, async (handle) => {
        await bootstrapSchema(handle, { build: "test-3" });
        await sqlRun(handle, sql`delete from schema_meta`);
        await expect(assertSchemaSupported(handle)).rejects.toBeInstanceOf(
          SchemaVersionError,
        );
      });
    });
  });
}
