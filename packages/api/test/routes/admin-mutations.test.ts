import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createSession } from "../../src/auth/session";
import { hashToken } from "../../src/auth/tokens";
import { seedDeployment } from "../../src/db/bootstrap";
import { newId } from "../../src/domain/id";
import type { NewUser } from "../../src/db/schema/types";
import { expectAuditDelta } from "../support/audit";
import { makeTestApp, type TestApp } from "../support/app";
import { loadLastAdmin } from "../support/fixtures";
import { lastAdmin } from "../fixtures/last-admin";

function regularUser(over: Partial<NewUser> = {}): NewUser {
  return {
    id: newId(),
    email: `u-${Math.random().toString(36).slice(2)}@x.com`,
    emailVerifiedAt: null,
    displayName: "Regular",
    role: "user",
    status: "active",
    passwordHash: null,
    mustChangePassword: false,
    unitSystem: "imperial",
    currencyCode: "USD",
    timeZone: "America/New_York",
    deactivatedAt: null,
    ...over,
  };
}

describe("/admin/users mutations", () => {
  let t: TestApp;
  let adminHeaders: Record<string, string>;

  beforeEach(async () => {
    t = makeTestApp();
    await seedDeployment(t.handle, {
      admin: { email: "root@x.com", password: "password12345" },
    });
    const admin = (await t.repos.users.findByEmail("root@x.com"))!;
    const { token } = await createSession(t.handle, admin.id, 3600);
    adminHeaders = {
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
    };
  });
  afterEach(() => t.cleanup());

  const req = async (
    path: string,
    init: RequestInit = {},
  ): Promise<Response> => t.app.request(path, init);

  const post = (path: string, body?: unknown): Promise<Response> =>
    req(path, {
      method: "POST",
      headers: adminHeaders,
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    });

  // ---- T5c.1 create -------------------------------------------------------

  it("creates a user with a password (201) and audits it", async () => {
    const res = await expectAuditDelta(t.handle, { action: "user.created" }, () =>
      post("/admin/users", {
        email: "new@x.com",
        displayName: "New Person",
        password: "password12345",
      }),
    );
    expect(res.status).toBe(201);
    const stored = await t.repos.users.findByEmail("new@x.com");
    expect(stored?.role).toBe("user");
    expect(stored?.passwordHash).not.toBeNull();
  });

  it("creates a user without a password and returns a one-time link", async () => {
    const res = await post("/admin/users", {
      email: "link@x.com",
      displayName: "Link Person",
      role: "admin",
    });
    expect(res.status).toBe(201);
    const { setPasswordToken, user } = (await res.json()) as {
      setPasswordToken?: string;
      user: { role: string };
    };
    expect(typeof setPasswordToken).toBe("string");
    expect(user.role).toBe("admin");

    const tokenRow = await t.repos.userTokens.findByHash(
      hashToken(setPasswordToken!),
    );
    expect(tokenRow?.purpose).toBe("set_password");
  });

  it("rejects a duplicate email (409)", async () => {
    await post("/admin/users", { email: "dupe@x.com", displayName: "A" });
    const res = await post("/admin/users", {
      email: "dupe@x.com",
      displayName: "B",
    });
    expect(res.status).toBe(409);
  });

  it("rejects a non-admin caller (403)", async () => {
    const u = await t.repos.users.create(regularUser());
    const { token } = await createSession(t.handle, u.id, 3600);
    const res = await t.app.request("/admin/users", {
      method: "POST",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify({ email: "z@x.com", displayName: "Z" }),
    });
    expect(res.status).toBe(403);
  });

  // ---- T5c.1 deactivate / reactivate -----------------------------------

  it("deactivate cuts the user's session immediately (401 next request)", async () => {
    const u = await t.repos.users.create(regularUser());
    const { token: userToken } = await createSession(t.handle, u.id, 3600);
    const userHeaders = { authorization: `Bearer ${userToken}` };

    expect((await t.app.request("/profile", { headers: userHeaders })).status).toBe(
      200,
    );

    const res = await expectAuditDelta(
      t.handle,
      { action: "user.deactivated" },
      () => post(`/admin/users/${u.id}/deactivate`),
    );
    expect(res.status).toBe(204);

    expect((await t.app.request("/profile", { headers: userHeaders })).status).toBe(
      401,
    );
    expect((await t.repos.users.findById(u.id))?.status).toBe("deactivated");
    const tokens = await t.repos.apiTokens.listForUser(u.id);
    expect(tokens.every((x) => x.revokedAt != null)).toBe(true);
  });

  it("reactivate restores active status and audits it", async () => {
    const u = await t.repos.users.create(
      regularUser({ status: "deactivated", deactivatedAt: new Date() }),
    );
    const res = await expectAuditDelta(
      t.handle,
      { action: "user.reactivated" },
      () => post(`/admin/users/${u.id}/reactivate`),
    );
    expect(res.status).toBe(204);
    expect((await t.repos.users.findById(u.id))?.status).toBe("active");
  });

  // ---- T5c.2 reset ----------------------------------------------------

  it("reset issues a reset token and audits it (email not configured)", async () => {
    const u = await t.repos.users.create(regularUser());
    const res = await expectAuditDelta(
      t.handle,
      { action: "user.reset_triggered" },
      () => post(`/admin/users/${u.id}/reset`),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { sent: boolean; resetToken?: string };
    expect(body.sent).toBe(false);
    expect(typeof body.resetToken).toBe("string");

    const tokenRow = await t.repos.userTokens.findByHash(
      hashToken(body.resetToken!),
    );
    expect(tokenRow?.purpose).toBe("reset");
    expect(tokenRow?.userId).toBe(u.id);
  });

  // ---- T5c.3 grant / revoke admin + delete ---------------------------

  it("grant then revoke admin, each audited", async () => {
    const u = await t.repos.users.create(regularUser());

    const grant = await expectAuditDelta(
      t.handle,
      { action: "role.granted" },
      () => post(`/admin/users/${u.id}/grant-admin`),
    );
    expect(grant.status).toBe(204);
    expect((await t.repos.users.findById(u.id))?.role).toBe("admin");

    const revoke = await expectAuditDelta(
      t.handle,
      { action: "role.revoked" },
      () => post(`/admin/users/${u.id}/revoke-admin`),
    );
    expect(revoke.status).toBe(204);
    expect((await t.repos.users.findById(u.id))?.role).toBe("user");
  });

  it("delete removes the user and cascades, with an explicit confirm", async () => {
    const u = await t.repos.users.create(regularUser({ email: "gone@x.com" }));
    const { token } = await createSession(t.handle, u.id, 3600);
    await t.repos.apiTokens.create({
      id: newId(),
      userId: u.id,
      tokenHash: hashToken("cht_x"),
      label: "x",
      expiresAt: null,
    });

    const wrong = await req(`/admin/users/${u.id}`, {
      method: "DELETE",
      headers: adminHeaders,
      body: JSON.stringify({ confirmEmail: "not@right.com" }),
    });
    expect(wrong.status).toBe(400);
    expect(await t.repos.users.findById(u.id)).not.toBeNull();

    const res = await expectAuditDelta(
      t.handle,
      { action: "user.deleted" },
      () =>
        req(`/admin/users/${u.id}`, {
          method: "DELETE",
          headers: adminHeaders,
          body: JSON.stringify({ confirmEmail: "gone@x.com" }),
        }),
    );
    expect(res.status).toBe(204);
    expect(await t.repos.users.findById(u.id)).toBeNull();
    expect(await t.repos.sessions.findByHash(hashToken(token))).toBeNull();
    expect(await t.repos.apiTokens.listForUser(u.id)).toHaveLength(0);
  });

  // ---- T5c.4 INV-6 last-admin lock ---------------------------------

  it("refuses to demote, deactivate, or delete the last active admin", async () => {
    const root = (await t.repos.users.findByEmail("root@x.com"))!;

    const demote = await post(`/admin/users/${root.id}/revoke-admin`);
    expect(demote.status).toBe(422);
    expect(((await demote.json()) as { code: string }).code).toBe("last_admin");
    expect((await t.repos.users.findById(root.id))?.role).toBe("admin");

    const deact = await post(`/admin/users/${root.id}/deactivate`);
    expect(deact.status).toBe(422);
    expect((await t.repos.users.findById(root.id))?.status).toBe("active");

    const del = await req(`/admin/users/${root.id}`, {
      method: "DELETE",
      headers: adminHeaders,
      body: JSON.stringify({ confirmEmail: "root@x.com" }),
    });
    expect(del.status).toBe(422);
    expect(await t.repos.users.findById(root.id)).not.toBeNull();

    expect(await t.repos.users.countActiveAdmins()).toBe(1);
  });
});

describe("/admin/users INV-6 contention (last-admin fixture)", () => {
  let t: TestApp;

  beforeEach(async () => {
    t = makeTestApp();
    await loadLastAdmin(t.handle);
  });
  afterEach(() => t.cleanup());

  it("two concurrent demotions never reach zero admins", async () => {
    const { token } = await createSession(t.handle, lastAdmin.admins[0].id, 3600);
    const headers = { authorization: `Bearer ${token}` };
    const demote = (id: string) =>
      t.app.request(`/admin/users/${id}/revoke-admin`, {
        method: "POST",
        headers,
      });

    const [a, b] = await Promise.all([
      demote(lastAdmin.admins[0].id),
      demote(lastAdmin.admins[1].id),
    ]);

    const statuses = [a.status, b.status].sort();
    // Exactly one demotion is allowed through; the other is refused.
    expect(statuses.filter((s) => s === 204)).toHaveLength(1);
    expect(await t.repos.users.countActiveAdmins()).toBeGreaterThanOrEqual(1);
  });
});
