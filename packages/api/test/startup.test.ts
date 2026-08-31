import { sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";

import {
  bootstrapSchema,
  seedDeployment,
  SEEDED_ADMIN_EMAIL,
} from "../src/db/bootstrap";
import { sqlRun } from "../src/db/index";
import { assertStartupSafe, StartupError } from "../src/startup";
import { openRawSqlite } from "./support/sqlite";

const PG = "postgres://u:p@localhost:5432/chotu";
const SQLITE = "file:./chotu.db";

async function seededSqlite() {
  const mig = openRawSqlite();
  await bootstrapSchema(mig.handle, { build: "startup-test" });
  await seedDeployment(mig.handle, { admin: { seedDefault: true } });
  return mig;
}

describe("assertStartupSafe", () => {
  it("development mode: no guards, even with a seeded admin on SQLite", async () => {
    const mig = await seededSqlite();
    try {
      await expect(
        assertStartupSafe(
          { CHOTU_ENV: "development", DATABASE_URL: SQLITE },
          mig.handle,
        ),
      ).resolves.toBeUndefined();
    } finally {
      await mig.cleanup();
    }
  });

  it("production + SQLite DATABASE_URL is refused (FR-1.10)", async () => {
    const mig = await seededSqlite();
    try {
      await expect(
        assertStartupSafe(
          { CHOTU_ENV: "production", DATABASE_URL: SQLITE },
          mig.handle,
        ),
      ).rejects.toThrow(/SQLite/);
    } finally {
      await mig.cleanup();
    }
  });

  it("production + unchanged seeded admin is refused (FR-1.6)", async () => {
    const mig = await seededSqlite();
    try {
      await expect(
        assertStartupSafe(
          { CHOTU_ENV: "production", DATABASE_URL: PG },
          mig.handle,
        ),
      ).rejects.toBeInstanceOf(StartupError);
      await expect(
        assertStartupSafe(
          { CHOTU_ENV: "production", DATABASE_URL: PG },
          mig.handle,
        ),
      ).rejects.toThrow(/default password/);
    } finally {
      await mig.cleanup();
    }
  });

  it("production is allowed once the seeded admin has changed its password", async () => {
    const mig = await seededSqlite();
    try {
      await sqlRun(
        mig.handle,
        sql`update "user" set must_change_password = 0 where email = ${SEEDED_ADMIN_EMAIL}`,
      );
      await expect(
        assertStartupSafe(
          { CHOTU_ENV: "production", DATABASE_URL: PG },
          mig.handle,
        ),
      ).resolves.toBeUndefined();
    } finally {
      await mig.cleanup();
    }
  });
});
