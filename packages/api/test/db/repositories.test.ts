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

  describe("invitations", () => {
    let adminId: string;
    beforeEach(async () => {
      adminId = (await ctx().repos.users.create(newUser({ role: "admin" })))
        .id;
    });

    it("issue / findByHash / consume", async () => {
      const { invitations } = ctx().repos;
      const row = await invitations.issue({
        id: randomUUID(),
        email: "invitee@example.com",
        tokenHash: "inv_a",
        invitedRole: "user",
        createdBy: adminId,
        expiresAt: new Date(Date.now() + 3600_000),
      });
      expect(row.acceptedAt).toBeNull();

      const found = await invitations.findByHash("inv_a");
      expect(found?.email).toBe("invitee@example.com");
      expect(found?.invitedRole).toBe("user");

      const accepted = await ctx().repos.users.create(newUser());
      await invitations.consume(row.id, accepted.id, new Date());
      const consumed = await invitations.findByHash("inv_a");
      expect(consumed?.acceptedAt).toBeInstanceOf(Date);
      expect(consumed?.acceptedUserId).toBe(accepted.id);
    });

    it("issue replaces a prior unaccepted invitation for the same email", async () => {
      const { invitations } = ctx().repos;
      await invitations.issue({
        id: randomUUID(),
        email: "Repeat@Example.com",
        tokenHash: "inv_first",
        invitedRole: "user",
        createdBy: adminId,
        expiresAt: new Date(Date.now() + 3600_000),
      });
      await invitations.issue({
        id: randomUUID(),
        email: "repeat@example.com",
        tokenHash: "inv_second",
        invitedRole: "admin",
        createdBy: adminId,
        expiresAt: new Date(Date.now() + 3600_000),
      });

      expect(await invitations.findByHash("inv_first")).toBeNull();
      const second = await invitations.findByHash("inv_second");
      expect(second?.invitedRole).toBe("admin");
    });

    it("issuing again after acceptance keeps the accepted row", async () => {
      const { invitations } = ctx().repos;
      const first = await invitations.issue({
        id: randomUUID(),
        email: "again@example.com",
        tokenHash: "inv_done",
        invitedRole: "user",
        createdBy: adminId,
        expiresAt: new Date(Date.now() + 3600_000),
      });
      const accepted = await ctx().repos.users.create(newUser());
      await invitations.consume(first.id, accepted.id, new Date());

      await invitations.issue({
        id: randomUUID(),
        email: "again@example.com",
        tokenHash: "inv_new",
        invitedRole: "user",
        createdBy: adminId,
        expiresAt: new Date(Date.now() + 3600_000),
      });

      expect((await invitations.findByHash("inv_done"))?.acceptedAt).toBeInstanceOf(
        Date,
      );
      expect((await invitations.findByHash("inv_new"))?.email).toBe(
        "again@example.com",
      );
    });
  });

  describe("oidcProviders", () => {
    it("create / findByKey / list / update / delete", async () => {
      const { oidcProviders } = ctx().repos;
      const created = await oidcProviders.create({
        id: randomUUID(),
        key: "okta",
        displayName: "Okta",
        issuerUrl: "https://example.okta.com",
        clientId: "client-1",
        clientSecretRef: "env:OKTA_SECRET",
        scopes: ["openid", "email", "profile"],
        allowedEmailDomains: ["example.com"],
        allowedGroups: null,
        autoProvision: true,
        enabled: true,
      });
      expect(created.key).toBe("okta");

      const found = await oidcProviders.findByKey("okta");
      expect(found?.displayName).toBe("Okta");
      expect(found?.allowedEmailDomains).toEqual(["example.com"]);

      expect((await oidcProviders.list()).length).toBe(1);

      const updated = await oidcProviders.update("okta", { enabled: false });
      expect(updated.enabled).toBe(false);

      await oidcProviders.delete("okta");
      expect(await oidcProviders.findByKey("okta")).toBeNull();
    });
  });

  describe("oidcLogins", () => {
    let providerKey: string;
    beforeEach(async () => {
      providerKey = "test-idp";
      await ctx().repos.oidcProviders.create({
        id: randomUUID(),
        key: providerKey,
        displayName: "Test IdP",
        issuerUrl: "https://idp.example.com",
        clientId: "c1",
        clientSecretRef: "env:X",
        scopes: ["openid"],
        allowedEmailDomains: null,
        allowedGroups: null,
        autoProvision: false,
        enabled: true,
      });
    });

    it("create / findByStateHash / consume / deleteExpired", async () => {
      const { oidcLogins } = ctx().repos;
      const row = await oidcLogins.create({
        id: randomUUID(),
        providerKey,
        stateHash: "state-hash-1",
        codeVerifier: "verifier",
        nonce: "nonce-1",
        redirectTo: null,
        linkUserId: null,
        expiresAt: new Date(Date.now() + 600_000),
      });
      expect(row.consumedAt).toBeNull();

      const found = await oidcLogins.findByStateHash("state-hash-1");
      expect(found?.providerKey).toBe(providerKey);

      await oidcLogins.consume(row.id, new Date());
      expect(
        (await oidcLogins.findByStateHash("state-hash-1"))?.consumedAt,
      ).toBeInstanceOf(Date);

      await oidcLogins.create({
        id: randomUUID(),
        providerKey,
        stateHash: "state-hash-expired",
        codeVerifier: "verifier",
        nonce: null,
        redirectTo: null,
        linkUserId: null,
        expiresAt: new Date(Date.now() - 1000),
      });
      expect(await oidcLogins.deleteExpired(new Date())).toBe(1);
      expect(await oidcLogins.findByStateHash("state-hash-expired")).toBeNull();
    });
  });

  describe("identities", () => {
    let userId: string;
    let providerKey: string;
    beforeEach(async () => {
      userId = (await ctx().repos.users.create(newUser())).id;
      providerKey = "test-idp-2";
      await ctx().repos.oidcProviders.create({
        id: randomUUID(),
        key: providerKey,
        displayName: "Test IdP 2",
        issuerUrl: "https://idp2.example.com",
        clientId: "c1",
        clientSecretRef: "env:X",
        scopes: ["openid"],
        allowedEmailDomains: null,
        allowedGroups: null,
        autoProvision: false,
        enabled: true,
      });
    });

    it("create / findByProviderSubject / listForUser / touchLogin / delete", async () => {
      const { identities } = ctx().repos;
      const row = await identities.create({
        id: randomUUID(),
        userId,
        providerKey,
        subject: "sub-123",
        emailAtLink: "user@example.com",
      });
      expect(row.lastLoginAt).toBeNull();

      const found = await identities.findByProviderSubject(providerKey, "sub-123");
      expect(found?.userId).toBe(userId);

      expect((await identities.listForUser(userId)).length).toBe(1);
      expect(await identities.countForProvider(providerKey)).toBe(1);

      await identities.touchLogin(row.id, new Date());
      expect(
        (await identities.findById(row.id))?.lastLoginAt,
      ).toBeInstanceOf(Date);

      await identities.delete(row.id);
      expect(await identities.findById(row.id)).toBeNull();
      expect(await identities.countForProvider(providerKey)).toBe(0);
    });
  });
});
