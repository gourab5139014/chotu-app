import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createSession } from "../../src/auth/session";
import { seedDeployment } from "../../src/db/bootstrap";
import { expectAuditDelta } from "../support/audit";
import { makeTestApp, type TestApp } from "../support/app";
import { setupOidcFixture, type OidcFixture } from "../support/oidc-issuer";

/** Drive one full start -> authorize -> callback round trip. */
async function runOidcFlow(
  t: TestApp,
  path: string,
  headers: Record<string, string> = {},
): Promise<Response> {
  const startRes = await t.app.request(path, { headers });
  expect(startRes.status).toBe(302);
  const authorizeUrl = startRes.headers.get("location");
  expect(authorizeUrl).not.toBeNull();

  const authorizeRes = await fetch(authorizeUrl!, { redirect: "manual" });
  expect(authorizeRes.status).toBe(302);
  const callbackUrl = authorizeRes.headers.get("location");
  expect(callbackUrl).not.toBeNull();

  const parsed = new URL(callbackUrl!);
  return t.app.request(parsed.pathname + parsed.search);
}

describe("OIDC sign-in (start -> authorize -> callback)", () => {
  let t: TestApp;
  let oidc: OidcFixture;

  beforeEach(async () => {
    t = makeTestApp();
    await seedDeployment(t.handle, {
      admin: { email: "root@x.com", password: "password12345" },
    });
    oidc = await setupOidcFixture(t.repos, {
      allowedEmailDomains: ["example.com"],
    });
    // sso_auto so a first successful sign-in auto-provisions (FR-3.6).
    const admin = (await t.repos.users.findByEmail("root@x.com"))!;
    const { token } = await createSession(t.handle, admin.id, 3600);
    await t.app.request("/admin/settings", {
      method: "PATCH",
      headers: {
        authorization: `Bearer ${token}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({ registrationPolicy: "sso_auto" }),
    });
  });

  afterEach(async () => {
    await oidc.close();
    await t.cleanup();
  });

  it("auto-provisions a new user on first successful sign-in", async () => {
    oidc.issuer.setNextIdentity({
      sub: "sub-alice",
      email: "alice@example.com",
    });

    const res = await expectAuditDelta(
      t.handle,
      { action: "user.auto_provisioned" },
      () => runOidcFlow(t, `/auth/oidc/${oidc.providerKey}/start`),
    );
    expect(res.status).toBe(201);
    const body = (await res.json()) as {
      user: { email: string };
      session: string;
    };
    expect(body.user.email).toBe("alice@example.com");
    expect(body.session.startsWith("chs_")).toBe(true);

    const stored = await t.repos.users.findByEmail("alice@example.com");
    expect(stored?.emailVerifiedAt).toBeInstanceOf(Date);
    expect(stored?.passwordHash).toBeNull();

    const identity = await t.repos.identities.findByProviderSubject(
      oidc.providerKey,
      "sub-alice",
    );
    expect(identity?.userId).toBe(stored?.id);
  });

  it("a returning identity signs straight in (200, no new user)", async () => {
    oidc.issuer.setNextIdentity({ sub: "sub-bob", email: "bob@example.com" });
    const first = await runOidcFlow(t, `/auth/oidc/${oidc.providerKey}/start`);
    expect(first.status).toBe(201);
    const before = await t.repos.users.findByEmail("bob@example.com");

    const res = await expectAuditDelta(
      t.handle,
      { action: "oidc.signed_in" },
      () => runOidcFlow(t, `/auth/oidc/${oidc.providerKey}/start`),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { user: { id: string } };
    expect(body.user.id).toBe(before?.id);

    expect((await t.repos.users.list()).length).toBe(2); // admin + bob, no dupe
  });

  it("rejects an out-of-domain sign-in (AC-11)", async () => {
    oidc.issuer.setNextIdentity({
      sub: "sub-eve",
      email: "eve@not-allowed.com",
    });

    const res = await runOidcFlow(t, `/auth/oidc/${oidc.providerKey}/start`);
    expect(res.status).toBe(403);
    expect(await t.repos.users.findByEmail("eve@not-allowed.com")).toBeNull();
  });

  it("a replayed callback is refused (login already consumed)", async () => {
    oidc.issuer.setNextIdentity({
      sub: "sub-carl",
      email: "carl@example.com",
    });

    const startRes = await t.app.request(`/auth/oidc/${oidc.providerKey}/start`);
    const authorizeRes = await fetch(startRes.headers.get("location")!, {
      redirect: "manual",
    });
    const parsed = new URL(authorizeRes.headers.get("location")!);
    const callbackPath = parsed.pathname + parsed.search;

    const first = await t.app.request(callbackPath);
    expect(first.status).toBe(201);

    const replay = await t.app.request(callbackPath);
    expect(replay.status).toBe(401);
  });

  it("does not auto-provision when the deployment policy is invite_only", async () => {
    const admin = (await t.repos.users.findByEmail("root@x.com"))!;
    const { token } = await createSession(t.handle, admin.id, 3600);
    await t.app.request("/admin/settings", {
      method: "PATCH",
      headers: {
        authorization: `Bearer ${token}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({ registrationPolicy: "invite_only" }),
    });

    oidc.issuer.setNextIdentity({
      sub: "sub-dan",
      email: "dan@example.com",
    });
    const res = await runOidcFlow(t, `/auth/oidc/${oidc.providerKey}/start`);
    expect(res.status).toBe(401);
    expect(await t.repos.users.findByEmail("dan@example.com")).toBeNull();
  });
});

describe("OIDC unknown/disabled provider", () => {
  let t: TestApp;

  beforeEach(async () => {
    t = makeTestApp();
    await seedDeployment(t.handle, {
      admin: { email: "root@x.com", password: "password12345" },
    });
  });
  afterEach(() => t.cleanup());

  it("404s starting a sign-in for an unknown provider", async () => {
    const res = await t.app.request("/auth/oidc/nope/start");
    expect(res.status).toBe(404);
  });
});
