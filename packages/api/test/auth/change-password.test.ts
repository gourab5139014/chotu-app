import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createSession } from "../../src/auth/session";
import { SEEDED_ADMIN_EMAIL, seedDeployment } from "../../src/db/bootstrap";
import { makeTestApp, type TestApp } from "../support/app";

describe("must-change-password gate + change-password + sign-out", () => {
  let t: TestApp;

  beforeEach(async () => {
    t = makeTestApp();
    await seedDeployment(t.handle, { admin: { seedDefault: true } });
  });
  afterEach(() => t.cleanup());

  async function sessionFor(email: string) {
    const u = (await t.repos.users.findByEmail(email))!;
    const { token } = await createSession(t.handle, u.id, 3600);
    return { token, headers: { authorization: `Bearer ${token}` } };
  }

  it("a must_change_password user is 403 on a gated route", async () => {
    const { headers } = await sessionFor(SEEDED_ADMIN_EMAIL);
    const res = await t.app.request("/auth/me", { headers });
    expect(res.status).toBe(403);
    expect(((await res.json()) as { code: string }).code).toBe(
      "password_change_required",
    );
  });

  it("change-password clears the flag, then the gated route works", async () => {
    const { headers } = await sessionFor(SEEDED_ADMIN_EMAIL);

    const bad = await t.app.request("/auth/change-password", {
      method: "POST",
      headers: { ...headers, "content-type": "application/json" },
      body: JSON.stringify({ currentPassword: "wrong", newPassword: "brand-new-pass" }),
    });
    expect(bad.status).toBe(401);

    const ok = await t.app.request("/auth/change-password", {
      method: "POST",
      headers: { ...headers, "content-type": "application/json" },
      body: JSON.stringify({ currentPassword: "tiger", newPassword: "brand-new-pass" }),
    });
    expect(ok.status).toBe(204);

    const me = await t.app.request("/auth/me", { headers });
    expect(me.status).toBe(200);
    expect(
      (await t.repos.users.findByEmail(SEEDED_ADMIN_EMAIL))?.mustChangePassword,
    ).toBe(false);
  });

  it("sign-out revokes the session", async () => {
    // give the admin a usable password so the gate does not interfere
    await seedCleanUser(t);
    const { token, headers } = await sessionFor("clean@x.com");

    expect((await t.app.request("/auth/me", { headers })).status).toBe(200);
    const out = await t.app.request("/auth/sign-out", { method: "POST", headers });
    expect(out.status).toBe(204);
    expect((await t.app.request("/auth/me", { headers })).status).toBe(401);
    // the raw credential no longer resolves
    void token;
  });
});

async function seedCleanUser(t: TestApp): Promise<void> {
  await t.repos.users.create({
    id: crypto.randomUUID(),
    email: "clean@x.com",
    emailVerifiedAt: null,
    displayName: "Clean",
    role: "user",
    status: "active",
    passwordHash: "x",
    mustChangePassword: false,
    unitSystem: "imperial",
    currencyCode: "USD",
    timeZone: "America/New_York",
    deactivatedAt: null,
  });
}
