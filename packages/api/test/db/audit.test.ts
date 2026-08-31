import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { makeRepos, writeAuditInTx } from "../../src/db/repositories";
import { makeUnitOfWork } from "../../src/db/uow";
import type { Repos } from "../../src/domain/ports";
import { openMigratedSqlite, type MigratedSqlite } from "../support/sqlite";

const ENTRY = {
  actorUserId: null,
  action: "user.deactivated",
  targetType: "user",
  targetId: "u-123",
  summary: "Deactivated user u-123",
  metadata: { reason: "test" },
  ip: "203.0.113.7",
} as const;

describe("audit_log — writeAuditInTx (SQLite)", () => {
  let mig: MigratedSqlite;
  let repos: Repos;

  beforeEach(() => {
    mig = openMigratedSqlite();
    repos = makeRepos(mig.handle);
  });

  afterEach(async () => {
    await mig.cleanup();
  });

  it("commits the audit row with a successful uow", async () => {
    const uow = makeUnitOfWork(mig.handle);

    const out = await uow.run({}, (tx) => {
      void writeAuditInTx(tx, { ...ENTRY });
      return "done";
    });

    expect(out).toBe("done");
    expect(await repos.audit.count()).toBe(1);

    const [row] = await repos.audit.list();
    expect(row).toMatchObject({
      action: "user.deactivated",
      targetType: "user",
      targetId: "u-123",
      summary: "Deactivated user u-123",
      metadata: { reason: "test" },
      ip: "203.0.113.7",
      actorUserId: null,
    });
    expect(row?.id).toMatch(/[0-9a-f-]{36}/);
    expect(row?.createdAt).toBeInstanceOf(Date);
  });

  it("rolls the audit row back when the uow callback throws", async () => {
    const uow = makeUnitOfWork(mig.handle);

    await expect(
      uow.run({}, (tx) => {
        void writeAuditInTx(tx, { ...ENTRY });
        throw new Error("boom");
      }),
    ).rejects.toThrow("boom");

    expect(await repos.audit.count()).toBe(0);
  });
});

describe("audit_log — AuditRepo.record / list (SQLite)", () => {
  let mig: MigratedSqlite;
  let repos: Repos;

  beforeEach(() => {
    mig = openMigratedSqlite();
    repos = makeRepos(mig.handle);
  });

  afterEach(async () => {
    await mig.cleanup();
  });

  it("records an entry and fills id and createdAt", async () => {
    const row = await repos.audit.record({ ...ENTRY });
    expect(row.id).toMatch(/[0-9a-f-]{36}/);
    expect(row.createdAt).toBeInstanceOf(Date);
    expect(await repos.audit.count()).toBe(1);
  });

  it("lists newest first and filters by target", async () => {
    await repos.audit.record({ ...ENTRY, targetId: "u-1", summary: "one" });
    await repos.audit.record({ ...ENTRY, targetId: "u-2", summary: "two" });
    await repos.audit.record({
      ...ENTRY,
      targetType: "oidc_provider",
      targetId: "p-1",
      summary: "three",
    });

    const all = await repos.audit.list();
    expect(all).toHaveLength(3);

    const forUsers = await repos.audit.list({ targetType: "user" });
    expect(forUsers.map((r) => r.summary).sort()).toEqual(["one", "two"]);

    const one = await repos.audit.list({ targetType: "user", targetId: "u-1" });
    expect(one).toHaveLength(1);
    expect(one[0]?.summary).toBe("one");
  });
});
