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

describe("/profile routes", () => {
  let t: TestApp;
  let headers: Record<string, string>;
  let userId: string;

  beforeEach(async () => {
    t = makeTestApp();
    await seedDeployment(t.handle, {
      admin: { email: "a@x.com", password: "password12345" },
    });
    const u = (await t.repos.users.findByEmail("a@x.com"))!;
    userId = u.id;
    const { token } = await createSession(t.handle, u.id, 3600);
    headers = {
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
    };
  });
  afterEach(() => t.cleanup());

  it("requires auth", async () => {
    expect((await t.app.request("/profile")).status).toBe(401);
  });

  it("GET returns the profile with a read-only USD currency", async () => {
    const res = await t.app.request("/profile", { headers });
    expect(res.status).toBe(200);
    const { profile } = (await res.json()) as {
      profile: Record<string, unknown>;
    };
    expect(profile).toMatchObject({
      id: userId,
      email: "a@x.com",
      unitSystem: "imperial",
      currencyCode: "USD",
    });
    expect(typeof profile["timeZone"]).toBe("string");
  });

  it("PATCH updates display name, unit system, and time zone", async () => {
    const res = await t.app.request("/profile", {
      method: "PATCH",
      headers,
      body: JSON.stringify({
        displayName: "Road Tripper",
        unitSystem: "metric",
        timeZone: "America/Los_Angeles",
      }),
    });
    expect(res.status).toBe(200);
    const { profile } = (await res.json()) as {
      profile: Record<string, unknown>;
    };
    expect(profile).toMatchObject({
      displayName: "Road Tripper",
      unitSystem: "metric",
      timeZone: "America/Los_Angeles",
      currencyCode: "USD",
    });

    const stored = (await t.repos.users.findById(userId))!;
    expect(stored.unitSystem).toBe("metric");
    expect(stored.displayName).toBe("Road Tripper");
  });

  it("PATCH accepts a single field", async () => {
    const res = await t.app.request("/profile", {
      method: "PATCH",
      headers,
      body: JSON.stringify({ displayName: "Just A Name" }),
    });
    expect(res.status).toBe(200);
    const stored = (await t.repos.users.findById(userId))!;
    expect(stored.displayName).toBe("Just A Name");
    expect(stored.unitSystem).toBe("imperial");
  });

  it("PATCH rejects an empty body (400)", async () => {
    const res = await t.app.request("/profile", {
      method: "PATCH",
      headers,
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(400);
  });

  it("PATCH rejects an unknown time zone (400)", async () => {
    const res = await t.app.request("/profile", {
      method: "PATCH",
      headers,
      body: JSON.stringify({ timeZone: "Mars/Olympus_Mons" }),
    });
    expect(res.status).toBe(400);
  });

  it("PATCH ignores currencyCode and role (not in the schema)", async () => {
    const res = await t.app.request("/profile", {
      method: "PATCH",
      headers,
      body: JSON.stringify({
        displayName: "OK",
        currencyCode: "EUR",
        role: "user",
      }),
    });
    expect(res.status).toBe(200);
    const stored = (await t.repos.users.findById(userId))!;
    expect(stored.currencyCode).toBe("USD");
    expect(stored.role).toBe("admin");
  });

  it("DELETE removes a regular user and cascades their sessions and tokens", async () => {
    const u = await t.repos.users.create(regularUser());
    const { token } = await createSession(t.handle, u.id, 3600);
    const uHeaders = { authorization: `Bearer ${token}` };

    await t.repos.apiTokens.create({
      id: newId(),
      userId: u.id,
      tokenHash: hashToken("cht_whatever"),
      label: "ci",
      expiresAt: null,
    });

    const res = await t.app.request("/profile", {
      method: "DELETE",
      headers: uHeaders,
    });
    expect(res.status).toBe(204);

    expect(await t.repos.users.findById(u.id)).toBeNull();
    expect(await t.repos.sessions.findByHash(hashToken(token))).toBeNull();
    expect(await t.repos.apiTokens.listForUser(u.id)).toHaveLength(0);

    const [audit] = await t.repos.audit.list({ limit: 1 });
    expect(audit?.action).toBe("user.self_deleted");
    expect(audit?.targetId).toBe(u.id);
    expect(audit?.actorUserId).toBeNull();
    expect(JSON.stringify(audit)).not.toContain(u.email);
  });

  it("DELETE refuses the last active admin (422 last_admin)", async () => {
    const res = await t.app.request("/profile", {
      method: "DELETE",
      headers,
    });
    expect(res.status).toBe(422);
    const body = (await res.json()) as { code: string };
    expect(body.code).toBe("last_admin");
    expect(await t.repos.users.findById(userId)).not.toBeNull();
  });

  it("DELETE lets an admin go when another active admin remains", async () => {
    await t.repos.users.create(
      regularUser({ role: "admin", displayName: "Backup" }),
    );
    const res = await t.app.request("/profile", {
      method: "DELETE",
      headers,
    });
    expect(res.status).toBe(204);
    expect(await t.repos.users.findById(userId)).toBeNull();
  });
});
