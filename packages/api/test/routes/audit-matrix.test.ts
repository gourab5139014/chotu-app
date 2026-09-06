import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createSession } from "../../src/auth/session";
import { seedDeployment } from "../../src/db/bootstrap";
import { AUDIT_ACTIONS } from "../../src/domain/audit-actions";
import { newId } from "../../src/domain/id";
import type { NewUser } from "../../src/db/schema/types";
import { makeTestApp, type TestApp } from "../support/app";
import { setupOidcFixture, type OidcFixture } from "../support/oidc-issuer";

function regularUser(over: Partial<NewUser> = {}): NewUser {
  return {
    id: newId(),
    email: `u-${Math.random().toString(36).slice(2)}@x.com`,
    emailVerifiedAt: new Date(),
    displayName: "Regular",
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

async function headersFor(t: TestApp, userId: string) {
  const { token } = await createSession(t.handle, userId, 3600);
  return { authorization: `Bearer ${token}`, "content-type": "application/json" };
}

async function runOidcFlow(
  t: TestApp,
  path: string,
  headers: Record<string, string> = {},
): Promise<Response> {
  const start = await t.app.request(path, { headers });
  const authorizeRes = await fetch(start.headers.get("location")!, {
    redirect: "manual",
  });
  const parsed = new URL(authorizeRes.headers.get("location")!);
  return t.app.request(parsed.pathname + parsed.search);
}

/**
 * AC-9: every audited admin / security action writes exactly one audit record,
 * with an action code and no secret content. Driven off AUDIT_ACTIONS, so a
 * new action must be exercised here to pass.
 */
describe("audit matrix — every audited action (AC-9, T11.2)", () => {
  let t: TestApp;
  let admin: Record<string, string>;
  let oidc: OidcFixture;

  beforeEach(async () => {
    t = makeTestApp();
    await seedDeployment(t.handle, {
      admin: { email: "root@x.com", password: "password12345" },
    });
    const a = (await t.repos.users.findByEmail("root@x.com"))!;
    admin = await headersFor(t, a.id);
    oidc = await setupOidcFixture(t.repos, { key: "mx" });
  });
  afterEach(async () => {
    await oidc.close();
    await t.cleanup();
  });

  it("covers every AUDIT_ACTIONS entry with a clean single audit row", async () => {
    const covered = new Set<string>();
    // Actions with no recorded actor id, by design: self-service or system
    // flows, and self-delete (the actor row is gone in the same transaction).
    const anonymous = new Set([
      "user.registered",
      "invitation.accepted",
      "user.auto_provisioned",
      "user.self_deleted",
    ]);

    const record = async (label: string, fn: () => unknown) => {
      const before = await t.repos.audit.count();
      await fn();
      const after = await t.repos.audit.count();
      expect(after - before, `${label}: exactly one audit row`).toBe(1);
      const [row] = await t.repos.audit.list({ limit: 1 });
      expect(row, label).toBeDefined();
      covered.add(row!.action);
      // AC-9: an actor (unless it is an anonymous flow) and no secret content.
      if (!anonymous.has(row!.action)) {
        expect(row!.actorUserId, `${label}: has an actor`).not.toBeNull();
      }
      const blob = JSON.stringify({
        summary: row!.summary,
        metadata: row!.metadata,
      });
      // No credential material: token prefixes, Argon2 hashes, long hex/base64,
      // or a test password value.
      expect(blob, `${label}: no credential material`).not.toMatch(
        /chs_|cht_|\$argon2|[0-9a-f]{32,}|[A-Za-z0-9_-]{40,}|password12345/,
      );
    };

    const post = (path: string, body?: unknown, h = admin) =>
      t.app.request(path, {
        method: "POST",
        headers: h,
        ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
      });

    // --- user + role lifecycle ---
    let target = "";
    await record("user.created", async () => {
      const res = await post("/admin/users", {
        email: "made@x.com",
        displayName: "Made",
      });
      target = ((await res.json()) as { user: { id: string } }).user.id;
    });
    await record("role.granted", () =>
      post(`/admin/users/${target}/grant-admin`),
    );
    await record("role.revoked", () =>
      post(`/admin/users/${target}/revoke-admin`),
    );
    await record("user.deactivated", () =>
      post(`/admin/users/${target}/deactivate`),
    );
    await record("user.reactivated", () =>
      post(`/admin/users/${target}/reactivate`),
    );
    await record("user.reset_triggered", () =>
      post(`/admin/users/${target}/reset`),
    );
    await record("user.deleted", () =>
      t.app.request(`/admin/users/${target}`, {
        method: "DELETE",
        headers: admin,
        body: JSON.stringify({ confirmEmail: "made@x.com" }),
      }),
    );

    // --- settings ---
    await record("settings.updated", () =>
      t.app.request("/admin/settings", {
        method: "PATCH",
        headers: admin,
        body: JSON.stringify({ registrationPolicy: "open" }),
      }),
    );

    // --- invitations ---
    let inviteToken = "";
    await record("invitation.created", async () => {
      const res = await post("/admin/invitations", { email: "inv@x.com" });
      inviteToken = ((await res.json()) as { invitationToken: string })
        .invitationToken;
    });
    await record("invitation.accepted", () =>
      t.app.request("/invitations/accept", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          token: inviteToken,
          displayName: "Invitee",
          password: "password12345",
        }),
      }),
    );

    // --- self-registration ---
    await record("user.registered", () =>
      t.app.request("/register", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          email: "selfreg@x.com",
          displayName: "Self",
          password: "password12345",
        }),
      }),
    );

    // --- OIDC providers ---
    await record("oidc_provider.created", () =>
      post("/admin/oidc-providers", {
        key: "extra",
        displayName: "Extra",
        issuerUrl: "https://extra.example.com",
        clientId: "c",
        clientSecretRef: "env:EXTRA_SECRET",
      }),
    );
    await record("oidc_provider.updated", () =>
      t.app.request("/admin/oidc-providers/extra", {
        method: "PATCH",
        headers: admin,
        body: JSON.stringify({ enabled: false }),
      }),
    );
    await record("oidc_provider.deleted", () =>
      t.app.request("/admin/oidc-providers/extra", {
        method: "DELETE",
        headers: admin,
      }),
    );

    // --- OIDC sign-in / provision / link / unlink ---
    // sso_auto so a first sign-in auto-provisions.
    await t.app.request("/admin/settings", {
      method: "PATCH",
      headers: admin,
      body: JSON.stringify({ registrationPolicy: "sso_auto" }),
    });
    oidc.issuer.setNextIdentity({ sub: "sub-x", email: "oidcuser@x.com" });
    await record("user.auto_provisioned", () =>
      runOidcFlow(t, `/auth/oidc/${oidc.providerKey}/start`),
    );
    oidc.issuer.setNextIdentity({ sub: "sub-x", email: "oidcuser@x.com" });
    await record("oidc.signed_in", () =>
      runOidcFlow(t, `/auth/oidc/${oidc.providerKey}/start`),
    );

    const linker = await t.repos.users.create(regularUser({ email: "linker@x.com" }));
    const linkerHeaders = await headersFor(t, linker.id);
    oidc.issuer.setNextIdentity({ sub: "sub-linker", email: "linker@x.com" });
    await record("identity.linked", () =>
      runOidcFlow(t, `/auth/oidc/${oidc.providerKey}/link/start`, linkerHeaders),
    );
    const linkedIdentity = (await t.repos.identities.listForUser(linker.id))[0]!;
    // linker also has a password, so unlink is allowed.
    await record("identity.unlinked", () =>
      t.app.request(`/identities/${linkedIdentity.id}`, {
        method: "DELETE",
        headers: linkerHeaders,
      }),
    );

    // --- self-delete ---
    const selfDeleter = await t.repos.users.create(
      regularUser({ email: "bye@x.com" }),
    );
    const selfHeaders = await headersFor(t, selfDeleter.id);
    await record("user.self_deleted", () =>
      t.app.request("/profile", { method: "DELETE", headers: selfHeaders }),
    );

    // --- no gaps ---
    expect([...covered].sort()).toEqual([...AUDIT_ACTIONS].sort());
  });
});
