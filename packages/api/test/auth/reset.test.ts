import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createSession } from "../../src/auth/session";
import { hashToken } from "../../src/auth/tokens";
import { seedDeployment } from "../../src/db/bootstrap";
import { newId } from "../../src/domain/id";
import { makeTestApp, type TestApp } from "../support/app";

describe("password reset (FR-4.2, FR-4.3)", () => {
  let t: TestApp;

  beforeEach(async () => {
    t = makeTestApp();
    await seedDeployment(t.handle, {
      admin: { email: "root@x.com", password: "old-password-1" },
    });
  });
  afterEach(() => t.cleanup());

  const json = { "content-type": "application/json" };
  const resetRequest = (email: string) =>
    t.app.request("/auth/reset-request", {
      method: "POST",
      headers: json,
      body: JSON.stringify({ email }),
    });
  const reset = (token: string, newPassword: string) =>
    t.app.request("/auth/reset", {
      method: "POST",
      headers: json,
      body: JSON.stringify({ token, newPassword }),
    });
  const signIn = (email: string, password: string) =>
    t.app.request("/auth/sign-in", {
      method: "POST",
      headers: json,
      body: JSON.stringify({ email, password }),
    });

  it("responds the same for an unknown email (no enumeration)", async () => {
    const res = await resetRequest("nobody@x.com");
    expect(res.status).toBe(200);
    expect((await res.json()) as { sent: boolean }).toEqual({ sent: true });
  });

  it("returns a reset token for a real account when email is not configured", async () => {
    const res = await resetRequest("root@x.com");
    const body = (await res.json()) as { sent: boolean; resetToken?: string };
    expect(body.sent).toBe(false);
    expect(typeof body.resetToken).toBe("string");
  });

  it("completing a reset sets the new password and revokes every session", async () => {
    const admin = (await t.repos.users.findByEmail("root@x.com"))!;
    const { token: oldSession } = await createSession(t.handle, admin.id, 3600);

    const { resetToken } = (await (
      await resetRequest("root@x.com")
    ).json()) as { resetToken: string };

    expect((await reset(resetToken, "brand-new-pass-9")).status).toBe(204);

    // Old session is dead.
    const meRes = await t.app.request("/auth/me", {
      headers: { authorization: `Bearer ${oldSession}` },
    });
    expect(meRes.status).toBe(401);

    // Old password fails, new one works.
    expect((await signIn("root@x.com", "old-password-1")).status).toBe(401);
    expect((await signIn("root@x.com", "brand-new-pass-9")).status).toBe(200);

    // The link cannot be reused.
    expect((await reset(resetToken, "another-pass-0")).status).toBe(404);
  });

  it("accepts a set_password token too", async () => {
    const u = await t.repos.users.create({
      id: newId(),
      email: "invitee@x.com",
      emailVerifiedAt: new Date(),
      displayName: "Invitee",
      role: "user",
      status: "active",
      passwordHash: null,
      mustChangePassword: false,
      unitSystem: "imperial",
      currencyCode: "USD",
      timeZone: "America/New_York",
      deactivatedAt: null,
    });
    const link = "set-password-link-xyz";
    await t.repos.userTokens.issue({
      id: newId(),
      userId: u.id,
      purpose: "set_password",
      tokenHash: hashToken(link),
      expiresAt: new Date(Date.now() + 3_600_000),
    });

    expect((await reset(link, "first-password-1")).status).toBe(204);
    expect((await signIn("invitee@x.com", "first-password-1")).status).toBe(200);
  });

  it("rejects an unknown, expired, or already-used token (404)", async () => {
    expect((await reset("no-such-token", "whatever12")).status).toBe(404);

    const admin = (await t.repos.users.findByEmail("root@x.com"))!;
    const expired = "expired-link";
    await t.repos.userTokens.issue({
      id: newId(),
      userId: admin.id,
      purpose: "reset",
      tokenHash: hashToken(expired),
      expiresAt: new Date(Date.now() - 1000),
    });
    expect((await reset(expired, "whatever12")).status).toBe(404);
  });

  it("rate limits reset requests per IP (3/hour default)", async () => {
    const results = [];
    for (let i = 0; i < 5; i++) results.push(await resetRequest("root@x.com"));
    expect(results.some((r) => r.status === 429)).toBe(true);
  });
});
