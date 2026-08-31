import { randomUUID } from "node:crypto";

import { beforeEach, describe, expect, it } from "vitest";

import type { NewUser } from "../../src/db/schema/types";
import { describeEachAdapter } from "../support/adapters";

function newUser(over: Partial<NewUser> = {}): NewUser {
  return {
    id: randomUUID(),
    email: `u${randomUUID().slice(0, 8)}@example.com`,
    emailVerifiedAt: null,
    displayName: "Test User",
    role: "user",
    status: "active",
    passwordHash: "argon2id$x",
    mustChangePassword: false,
    unitSystem: "imperial",
    currencyCode: "USD",
    timeZone: "America/New_York",
    deactivatedAt: null,
    ...over,
  };
}

const settingsRow = {
  id: "singleton" as const,
  deploymentName: "Test",
  registrationPolicy: "invite_only" as const,
  allowedAuthMethods: ["password"] as Array<"password" | "oidc">,
  defaultUnitSystem: "imperial" as const,
  defaultCurrencyCode: "USD",
  defaultTimeZone: "America/New_York",
  fuelVolumePrecision: 3,
  sessionTtlSeconds: 3600,
  apiTokenTtlSeconds: null,
  createdAt: new Date("2026-01-01T00:00:00.000Z"),
  updatedAt: new Date("2026-01-01T00:00:00.000Z"),
};

describeEachAdapter("repositories", (ctx) => {
  describe("schemaMeta", () => {
    it("set then get is upsert", async () => {
      const { schemaMeta } = ctx().repos;
      expect(await schemaMeta.get()).toBeNull();
      await schemaMeta.set({
        id: "singleton",
        schemaVersion: 1,
        appliedAt: new Date("2026-01-01T00:00:00.000Z"),
        chotuBuild: "a",
      });
      await schemaMeta.set({
        id: "singleton",
        schemaVersion: 1,
        appliedAt: new Date("2026-02-01T00:00:00.000Z"),
        chotuBuild: "b",
      });
      const got = await schemaMeta.get();
      expect(got?.chotuBuild).toBe("b");
    });
  });

  describe("settings", () => {
    it("create, get, update", async () => {
      const { settings } = ctx().repos;
      await settings.create(settingsRow);
      expect((await settings.get())?.deploymentName).toBe("Test");

      const updated = await settings.update({
        registrationPolicy: "open",
        fuelVolumePrecision: 2,
      });
      expect(updated.registrationPolicy).toBe("open");
      expect(updated.fuelVolumePrecision).toBe(2);
      expect(updated.deploymentName).toBe("Test");
    });
  });

  describe("users", () => {
    it("create / findById / findByEmail (case-insensitive)", async () => {
      const { users } = ctx().repos;
      const u = await users.create(newUser({ email: "Mixed.Case@Example.com" }));

      expect((await users.findById(u.id))?.email).toBe(
        "Mixed.Case@Example.com",
      );
      expect((await users.findByEmail("mixed.case@example.com"))?.id).toBe(u.id);
      expect(await users.findByEmail("nobody@example.com")).toBeNull();
    });

    it("update patches and bumps updatedAt", async () => {
      const { users } = ctx().repos;
      const u = await users.create(newUser());
      const before = (await users.findById(u.id))!.updatedAt.getTime();
      await new Promise((r) => setTimeout(r, 5));
      const updated = await users.update(u.id, {
        displayName: "Renamed",
        mustChangePassword: true,
      });
      expect(updated.displayName).toBe("Renamed");
      expect(updated.mustChangePassword).toBe(true);
      expect(updated.updatedAt.getTime()).toBeGreaterThanOrEqual(before);
    });

    it("countActiveAdmins", async () => {
      const { users } = ctx().repos;
      expect(await users.countActiveAdmins()).toBe(0);
      await users.create(newUser({ role: "admin" }));
      await users.create(newUser({ role: "admin", status: "deactivated" }));
      await users.create(newUser({ role: "user" }));
      expect(await users.countActiveAdmins()).toBe(1);
    });

    it("list returns every user", async () => {
      const { users } = ctx().repos;
      const start = (await users.list()).length;
      await users.create(newUser());
      await users.create(newUser());
      expect((await users.list()).length).toBe(start + 2);
    });
  });

  describe("userTokens", () => {
    let userId: string;
    beforeEach(async () => {
      userId = (await ctx().repos.users.create(newUser())).id;
    });

    it("issue replaces a prior unused token of the same purpose", async () => {
      const { userTokens } = ctx().repos;
      await userTokens.issue({
        id: randomUUID(),
        userId,
        purpose: "reset",
        tokenHash: "h1",
        expiresAt: new Date(Date.now() + 60_000),
      });
      await userTokens.issue({
        id: randomUUID(),
        userId,
        purpose: "reset",
        tokenHash: "h2",
        expiresAt: new Date(Date.now() + 60_000),
      });
      expect(await userTokens.findByHash("h1")).toBeNull();
      expect((await userTokens.findByHash("h2"))?.userId).toBe(userId);
    });

    it("consume sets usedAt; deleteExpired removes past tokens", async () => {
      const { userTokens } = ctx().repos;
      const past = new Date(Date.now() - 60_000);
      const t = await userTokens.issue({
        id: randomUUID(),
        userId,
        purpose: "verify",
        tokenHash: "hv",
        expiresAt: past,
      });
      await userTokens.consume(t.id, new Date());
      expect((await userTokens.findByHash("hv"))?.usedAt).toBeInstanceOf(Date);

      const removed = await userTokens.deleteExpired(new Date());
      expect(removed).toBe(1);
      expect(await userTokens.findByHash("hv")).toBeNull();
    });
  });

  describe("apiTokens", () => {
    let userId: string;
    beforeEach(async () => {
      userId = (await ctx().repos.users.create(newUser())).id;
    });

    it("create / findByHash / listForUser / touch / revoke", async () => {
      const { apiTokens } = ctx().repos;
      const a = await apiTokens.create({
        id: randomUUID(),
        userId,
        tokenHash: "cht_a",
        label: "cli",
        expiresAt: null,
      });
      await apiTokens.create({
        id: randomUUID(),
        userId,
        tokenHash: "cht_b",
        label: null,
        expiresAt: null,
      });

      expect((await apiTokens.findByHash("cht_a"))?.id).toBe(a.id);
      expect((await apiTokens.listForUser(userId)).length).toBe(2);

      await apiTokens.touch(a.id, new Date());
      expect((await apiTokens.findByHash("cht_a"))?.lastUsedAt).toBeInstanceOf(
        Date,
      );

      await apiTokens.revoke(a.id, new Date());
      expect((await apiTokens.findByHash("cht_a"))?.revokedAt).toBeInstanceOf(
        Date,
      );
    });
  });

  describe("sessions", () => {
    let userId: string;
    beforeEach(async () => {
      userId = (await ctx().repos.users.create(newUser())).id;
    });

    it("create / findByHash / revoke / deleteExpired", async () => {
      const { sessions } = ctx().repos;
      await sessions.create({
        id: randomUUID(),
        tokenHash: "chs_live",
        userId,
        expiresAt: new Date(Date.now() + 3600_000),
        revokedAt: null,
        userAgent: "vitest",
        ip: "127.0.0.1",
      });
      const expired = await sessions.create({
        id: randomUUID(),
        tokenHash: "chs_old",
        userId,
        expiresAt: new Date(Date.now() - 1000),
        revokedAt: null,
        userAgent: null,
        ip: null,
      });

      expect((await sessions.findByHash("chs_live"))?.userId).toBe(userId);

      await sessions.revoke(expired.id, new Date());
      expect((await sessions.findByHash("chs_old"))?.revokedAt).toBeInstanceOf(
        Date,
      );

      expect(await sessions.deleteExpired(new Date())).toBe(1);
      expect(await sessions.findByHash("chs_old")).toBeNull();
    });
  });
});
