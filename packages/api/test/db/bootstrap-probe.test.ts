import { randomUUID } from "node:crypto";

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import postgres from "postgres";

import { makePostgres } from "../../src/db/adapters/postgres";
import { probePrivileges } from "../../src/db/bootstrap";
import type { DbHandle } from "../../src/db/index";
import { openMigratedSqlite } from "../support/sqlite";

describe("probePrivileges (SQLite)", () => {
  it("passes on a writable database file", async () => {
    const mig = openMigratedSqlite();
    try {
      expect(await probePrivileges(mig.handle)).toEqual({ ok: true });
    } finally {
      await mig.cleanup();
    }
  });
});

const url = process.env["DATABASE_URL"];
const hasPg = typeof url === "string" && url.startsWith("postgres");

describe.skipIf(!hasPg)("probePrivileges (PostgreSQL)", () => {
  const dbName = `chotu_probe_${randomUUID().replace(/-/g, "").slice(0, 12)}`;
  const roleName = `chotu_probe_lo_${randomUUID().replace(/-/g, "").slice(0, 8)}`;
  let ownerHandle: DbHandle;
  let limitedHandle: DbHandle;

  beforeAll(async () => {
    const base = new URL(url as string);
    const admin = postgres(url as string, { max: 1, onnotice: () => undefined });
    await admin.unsafe(`create database "${dbName}"`);
    await admin.unsafe(`create role "${roleName}" login password 'x'`);
    await admin.end();
    ownerHandle = makePostgres(
      `postgres://${base.username}:${base.password}@${base.host}/${dbName}`,
    );
    limitedHandle = makePostgres(
      `postgres://${roleName}:x@${base.host}/${dbName}`,
      { schemaName: "public" },
    );
  });

  afterAll(async () => {
    await ownerHandle.close();
    await limitedHandle.close();
    const admin = postgres(url as string, { max: 1, onnotice: () => undefined });
    await admin.unsafe(`drop database if exists "${dbName}" with (force)`);
    await admin.unsafe(`drop role if exists "${roleName}"`);
    await admin.end();
  });

  it("passes as the database owner", async () => {
    expect(await probePrivileges(ownerHandle)).toEqual({ ok: true });
  });

  it("names the exact missing GRANT for an under-privileged role", async () => {
    const result = await probePrivileges(limitedHandle);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.grants.join("\n")).toContain(
      `GRANT CREATE ON DATABASE "${dbName}"`,
    );
    expect(result.message).toContain("Bootstrap cannot proceed");
    expect(result.message).toContain(`TO "${roleName}"`);
  });
});
