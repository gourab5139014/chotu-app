import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createSession } from "../../src/auth/session";
import { hashToken } from "../../src/auth/tokens";
import { seedDeployment } from "../../src/db/bootstrap";
import { newId } from "../../src/domain/id";
import type { NewUser } from "../../src/db/schema/types";
import { makeTestApp, type TestApp } from "../support/app";

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

describe("/admin/users routes", () => {
  let t: TestApp;
  let adminHeaders: Record<string, string>;
  let adminId: string;

  beforeEach(async () => {
    t = makeTestApp();
    await seedDeployment(t.handle, {
      admin: { email: "admin@x.com", password: "password12345" },
    });
    const admin = (await t.repos.users.findByEmail("admin@x.com"))!;
    adminId = admin.id;
    const { token } = await createSession(t.handle, admin.id, 3600);
    adminHeaders = { authorization: `Bearer ${token}` };
  });
  afterEach(() => t.cleanup());

  it("rejects an unauthenticated caller (401)", async () => {
    expect((await t.app.request("/admin/users")).status).toBe(401);
  });

  it("rejects a valid non-admin credential (403) — T5b.1", async () => {
    const u = await t.repos.users.create(regularUser());
    const { token } = await createSession(t.handle, u.id, 3600);
    const res = await t.app.request("/admin/users", {
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.status).toBe(403);
    const body = (await res.json()) as { code: string };
    expect(body.code).toBe("forbidden");
  });

  it("lists every account with no fuel-entry field", async () => {
    await t.repos.users.create(regularUser({ email: "b@x.com" }));
    await t.repos.users.create(regularUser({ email: "c@x.com" }));

    const res = await t.app.request("/admin/users", { headers: adminHeaders });
    expect(res.status).toBe(200);
    const { users } = (await res.json()) as {
      users: Array<Record<string, unknown>>;
    };
    expect(users.length).toBe(3);
    expect(users.map((u) => u["email"]).sort()).toEqual([
      "admin@x.com",
      "b@x.com",
      "c@x.com",
    ]);
    for (const u of users) {
      expect(Object.keys(u).sort()).toEqual([
        "createdAt",
        "displayName",
        "email",
        "id",
        "role",
        "status",
        "vehicleCount",
      ]);
    }
    const blob = JSON.stringify(users).toLowerCase();
    for (const forbidden of ["odometer", "volume", "totalcost", "entrydate", "fillup"]) {
      expect(blob).not.toContain(forbidden);
    }
  });

  it("returns detail with last sign-in and active token count", async () => {
    const u = await t.repos.users.create(regularUser({ email: "d@x.com" }));
    await createSession(t.handle, u.id, 3600);
    await t.repos.apiTokens.create({
      id: newId(),
      userId: u.id,
      tokenHash: hashToken("cht_live"),
      label: "live",
      expiresAt: null,
    });
    const revoked = await t.repos.apiTokens.create({
      id: newId(),
      userId: u.id,
      tokenHash: hashToken("cht_dead"),
      label: "dead",
      expiresAt: null,
    });
    await t.repos.apiTokens.revoke(revoked.id, new Date());

    const res = await t.app.request(`/admin/users/${u.id}`, {
      headers: adminHeaders,
    });
    expect(res.status).toBe(200);
    const { user } = (await res.json()) as { user: Record<string, unknown> };
    expect(user["id"]).toBe(u.id);
    expect(user["activeTokenCount"]).toBe(1);
    expect(typeof user["lastSignInAt"]).toBe("string");
    expect(user["linkedIdentities"]).toEqual([]);
    expect(user["vehicleCount"]).toBe(0);

    const blob = JSON.stringify(user).toLowerCase();
    for (const forbidden of ["odometer", "volume", "totalcost", "entrydate"]) {
      expect(blob).not.toContain(forbidden);
    }
  });

  it("detail is null last-sign-in when the user never signed in", async () => {
    const u = await t.repos.users.create(regularUser({ email: "e@x.com" }));
    const res = await t.app.request(`/admin/users/${u.id}`, {
      headers: adminHeaders,
    });
    const { user } = (await res.json()) as { user: Record<string, unknown> };
    expect(user["lastSignInAt"]).toBeNull();
    expect(user["activeTokenCount"]).toBe(0);
  });

  it("404 for an unknown user id", async () => {
    const res = await t.app.request(`/admin/users/${newId()}`, {
      headers: adminHeaders,
    });
    expect(res.status).toBe(404);
    void adminId;
  });
});
