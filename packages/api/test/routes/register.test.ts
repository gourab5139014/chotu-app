import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createSession } from "../../src/auth/session";
import { seedDeployment } from "../../src/db/bootstrap";
import { expectAuditDelta } from "../support/audit";
import { makeTestApp, type TestApp } from "../support/app";

describe("POST /register + POST /verify", () => {
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

  const register = (body: unknown) =>
    t.app.request("/register", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });

  const verify = (token: string) =>
    t.app.request("/verify", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ token }),
    });

  const signIn = (email: string, password: string) =>
    t.app.request("/auth/sign-in", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email, password }),
    });

  const openRegistration = () =>
    t.app.request("/admin/settings", {
      method: "PATCH",
      headers: adminHeaders,
      body: JSON.stringify({ registrationPolicy: "open" }),
    });

  it("is refused while the policy is invite_only (403)", async () => {
    const res = await register({
      email: "eager@x.com",
      displayName: "Eager",
      password: "password12345",
    });
    expect(res.status).toBe(403);
  });

  it("registers an unverified account, then verify lets it sign in", async () => {
    await openRegistration();

    const res = await expectAuditDelta(
      t.handle,
      { action: "user.registered" },
      () =>
        register({
          email: "new@x.com",
          displayName: "New Person",
          password: "password12345",
        }),
    );
    expect(res.status).toBe(201);
    const { user, verifyToken } = (await res.json()) as {
      user: { email: string };
      verifyToken: string;
    };
    expect(user.email).toBe("new@x.com");
    expect(typeof verifyToken).toBe("string");

    const stored = await t.repos.users.findByEmail("new@x.com");
    expect(stored?.emailVerifiedAt).toBeNull();

    // Cannot sign in yet.
    expect((await signIn("new@x.com", "password12345")).status).toBe(401);

    const verified = await verify(verifyToken);
    expect(verified.status).toBe(200);
    const verifiedBody = (await verified.json()) as {
      user: { email: string };
    };
    expect(verifiedBody.user.email).toBe("new@x.com");

    const storedAfter = await t.repos.users.findByEmail("new@x.com");
    expect(storedAfter?.emailVerifiedAt).toBeInstanceOf(Date);

    // Now sign-in succeeds.
    expect((await signIn("new@x.com", "password12345")).status).toBe(200);

    // The link cannot be reused.
    expect((await verify(verifyToken)).status).toBe(404);
  });

  it("rejects an already-registered email (409)", async () => {
    await openRegistration();
    const res = await register({
      email: "root@x.com",
      displayName: "Root Again",
      password: "password12345",
    });
    expect(res.status).toBe(409);
  });

  it("rejects an unknown verify token (404)", async () => {
    const res = await verify("not-a-real-token");
    expect(res.status).toBe(404);
  });

  it("rate limits a burst of registrations from one IP", async () => {
    await openRegistration();
    const attempts = [];
    for (let i = 0; i < 8; i++) {
      attempts.push(
        await register({
          email: `burst${i}@x.com`,
          displayName: "Burst",
          password: "password12345",
        }),
      );
    }
    expect(attempts.some((r) => r.status === 429)).toBe(true);
  });
});
