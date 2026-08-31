import { sql } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import * as schema from "../../src/db/schema/sqlite";
import { makeUnitOfWork, UnitOfWorkAsyncError } from "../../src/db/uow";
import { openMigratedSqlite, type MigratedSqlite } from "../support/sqlite";

const META = {
  id: "singleton" as const,
  schemaVersion: 1,
  appliedAt: new Date("2026-01-01T00:00:00Z").toISOString(),
  chotuBuild: "test",
};

function metaCount(db: MigratedSqlite["handle"]["db"]): number {
  const rows = db.all<{ n: number }>(sql`select count(*) as n from schema_meta`);
  return rows[0]?.n ?? 0;
}

describe("UnitOfWork (SQLite)", () => {
  let mig: MigratedSqlite;

  beforeEach(() => {
    mig = openMigratedSqlite();
  });

  afterEach(async () => {
    await mig.cleanup();
  });

  it("commits when the callback returns", async () => {
    const uow = makeUnitOfWork(mig.handle);

    const out = await uow.run({}, (tx) => {
      if (tx.dialect !== "sqlite") throw new Error("expected sqlite");
      tx.db.insert(schema.schemaMeta).values(META).run();
      return "done";
    });

    expect(out).toBe("done");
    expect(metaCount(mig.handle.db)).toBe(1);
  });

  it("rolls back when the callback throws", async () => {
    const uow = makeUnitOfWork(mig.handle);

    await expect(
      uow.run({}, (tx) => {
        if (tx.dialect !== "sqlite") throw new Error("expected sqlite");
        tx.db.insert(schema.schemaMeta).values(META).run();
        throw new Error("boom");
      }),
    ).rejects.toThrow("boom");

    expect(metaCount(mig.handle.db)).toBe(0);
  });

  it("rejects an async callback and writes nothing", async () => {
    const uow = makeUnitOfWork(mig.handle);

    await expect(
      // eslint-disable-next-line @typescript-eslint/require-await -- deliberate misuse under test
      uow.run({}, async (tx) => {
        if (tx.dialect !== "sqlite") throw new Error("expected sqlite");
        tx.db.insert(schema.schemaMeta).values(META).run();
      }),
    ).rejects.toBeInstanceOf(UnitOfWorkAsyncError);

    expect(metaCount(mig.handle.db)).toBe(0);
  });

  it("run({ settings: true }) is a no-op lock on SQLite and still commits", async () => {
    const uow = makeUnitOfWork(mig.handle);

    await uow.run({ settings: true }, (tx) => {
      if (tx.dialect !== "sqlite") throw new Error("expected sqlite");
      tx.db.insert(schema.schemaMeta).values(META).run();
    });

    expect(metaCount(mig.handle.db)).toBe(1);
  });
});
