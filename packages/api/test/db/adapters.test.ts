import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { adapterFor, makeDb, type DbHandle } from "../../src/db/index";
import { makeSqlite } from "../../src/db/adapters/sqlite";

describe("adapterFor", () => {
  it("maps URL schemes to adapters", () => {
    expect(adapterFor("postgres://u:p@h:5432/d")).toBe("postgres");
    expect(adapterFor("postgresql://u:p@h:5432/d")).toBe("postgres");
    expect(adapterFor("file:./chotu.db")).toBe("sqlite");
    expect(adapterFor(":memory:")).toBe("sqlite");
  });

  it("rejects an unknown scheme", () => {
    expect(() => adapterFor("mysql://x")).toThrow(/Unrecognised/);
  });
});

describe("SQLite adapter", () => {
  const dir = mkdtempSync(join(tmpdir(), "chotu-sqlite-"));
  const file = join(dir, "t.db");
  const handle = makeSqlite(`file:${file}`);

  afterAll(async () => {
    await handle.close();
    rmSync(dir, { recursive: true, force: true });
  });

  it("connects and runs select 1", () => {
    const row = handle.client.prepare("select 1 as x").get() as { x: number };
    expect(row.x).toBe(1);
  });

  it("has foreign_keys ON and WAL journal mode", () => {
    expect(handle.client.pragma("foreign_keys", { simple: true })).toBe(1);
    expect(handle.client.pragma("journal_mode", { simple: true })).toBe("wal");
  });

  it("creates a real file on disk", () => {
    expect(existsSync(file)).toBe(true);
  });

  it("drizzle can execute against it", () => {
    const rows = handle.db.all<{ x: number }>(sql`select 1 as x`);
    expect(rows[0]?.x).toBe(1);
  });
});

const pgUrl = process.env["DATABASE_URL"];
const hasPg = typeof pgUrl === "string" && pgUrl.startsWith("postgres");

describe.skipIf(!hasPg)("PostgreSQL adapter", () => {
  let handle: DbHandle;

  beforeAll(() => {
    handle = makeDb(pgUrl as string);
  });

  afterAll(async () => {
    await handle.close();
  });

  it("connects and runs select 1", async () => {
    if (handle.dialect !== "postgres") throw new Error("expected postgres");
    const rows = await handle.client<{ x: number }[]>`select 1 as x`;
    expect(rows[0]?.x).toBe(1);
  });

  it("search_path is the chotu schema", async () => {
    if (handle.dialect !== "postgres") throw new Error("expected postgres");
    const rows = await handle.client<
      { search_path: string }[]
    >`show search_path`;
    expect(rows[0]?.search_path).toContain("chotu");
  });
});
