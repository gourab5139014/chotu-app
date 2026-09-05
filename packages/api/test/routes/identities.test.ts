import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createSession } from "../../src/auth/session";
import { seedDeployment } from "../../src/db/bootstrap";
import { newId } from "../../src/domain/id";
import type { NewUser } from "../../src/db/schema/types";
import { expectAuditDelta } from "../support/audit";
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
    passwordHash: "argon2id$has-a-password",
    mustChangePassword: false,
    unitSystem: "imperial",
    currencyCode: "USD",
    timeZone: "America/New_York",
    deactivatedAt: null,
    ...over,
  };
}

/** Drive one start -> authorize -> callback round trip, with any headers. */
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

describe("/identities — link and unlink (T7.4)", () => {
  let t: TestApp;
  let oidc: OidcFixture;
  let userId: string;
  let headers: Record<string, string>;

  beforeEach(async () => {
    t = makeTestApp();
    await seedDeployment(t.handle, {
      admin: { email: "root@x.com", password: "password12345" },
    });
    oidc = await setupOidcFixture(t.repos);

    const u = await t.repos.users.create(regularUser({ email: "u@x.com" }));
    userId = u.id;
    const { token } = await createSession(t.handle, u.id, 3600);
    headers = { authorization: `Bearer ${token}` };
  });

  afterEach(async () => {
    await oidc.close();
    await t.cleanup();
  });

  it("requires auth", async () => {
    expect((await t.app.request("/identities")).status).toBe(401);
  });

  it("links a new identity to the signed-in user", async () => {
    oidc.issuer.setNextIdentity({ sub: "sub-link-1", email: "u@x.com" });

    const res = await expectAuditDelta(
      t.handle,
      { action: "identity.linked" },
      () => runOidcFlow(t, `/auth/oidc/${oidc.providerKey}/link/start`, headers),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { linked: boolean; providerKey: string };
    expect(body.linked).toBe(true);
    expect(body.providerKey).toBe(oidc.providerKey);

    const identities = await t.repos.identities.listForUser(userId);
    expect(identities).toHaveLength(1);
    expect(identities[0]?.subject).toBe("sub-link-1");
  });

  it("linking the same identity again is idempotent (no duplicate)", async () => {
    oidc.issuer.setNextIdentity({ sub: "sub-link-2", email: "u@x.com" });
    await runOidcFlow(t, `/auth/oidc/${oidc.providerKey}/link/start`, headers);
    const again = await runOidcFlow(
      t,
      `/auth/oidc/${oidc.providerKey}/link/start`,
      headers,
    );
    expect(again.status).toBe(200);
    expect(await t.repos.identities.listForUser(userId)).toHaveLength(1);
  });

  it("refuses to link an identity already linked to a different user (409)", async () => {
    const other = await t.repos.users.create(regularUser({ email: "other@x.com" }));
    await t.repos.identities.create({
      id: newId(),
      userId: other.id,
      providerKey: oidc.providerKey,
      subject: "sub-taken",
      emailAtLink: "other@x.com",
    });

    oidc.issuer.setNextIdentity({ sub: "sub-taken", email: "u@x.com" });
    const res = await runOidcFlow(
      t,
      `/auth/oidc/${oidc.providerKey}/link/start`,
      headers,
    );
    expect(res.status).toBe(409);
    expect(await t.repos.identities.listForUser(userId)).toHaveLength(0);
  });

  it("lists and unlinks an identity (204, audited)", async () => {
    const identity = await t.repos.identities.create({
      id: newId(),
      userId,
      providerKey: oidc.providerKey,
      subject: "sub-x",
      emailAtLink: "u@x.com",
    });

    const list = await t.app.request("/identities", { headers });
    const { identities } = (await list.json()) as { identities: Array<{ id: string }> };
    expect(identities.map((i) => i.id)).toContain(identity.id);

    const res = await expectAuditDelta(
      t.handle,
      { action: "identity.unlinked" },
      () =>
        t.app.request(`/identities/${identity.id}`, {
          method: "DELETE",
          headers,
        }),
    );
    expect(res.status).toBe(204);
    expect(await t.repos.identities.findById(identity.id)).toBeNull();
  });

  it("refuses to unlink the caller's only sign-in method (422)", async () => {
    const noPasswordUser = await t.repos.users.create(
      regularUser({ email: "nopass@x.com", passwordHash: null }),
    );
    const { token } = await createSession(t.handle, noPasswordUser.id, 3600);
    const npHeaders = { authorization: `Bearer ${token}` };
    const identity = await t.repos.identities.create({
      id: newId(),
      userId: noPasswordUser.id,
      providerKey: oidc.providerKey,
      subject: "sub-only",
      emailAtLink: "nopass@x.com",
    });

    const res = await t.app.request(`/identities/${identity.id}`, {
      method: "DELETE",
      headers: npHeaders,
    });
    expect(res.status).toBe(422);
    const body = (await res.json()) as { code: string };
    expect(body.code).toBe("auth_method_required");
    expect(await t.repos.identities.findById(identity.id)).not.toBeNull();
  });

  it("404s unlinking someone else's identity", async () => {
    const other = await t.repos.users.create(regularUser({ email: "other2@x.com" }));
    const identity = await t.repos.identities.create({
      id: newId(),
      userId: other.id,
      providerKey: oidc.providerKey,
      subject: "sub-other",
      emailAtLink: "other2@x.com",
    });

    const res = await t.app.request(`/identities/${identity.id}`, {
      method: "DELETE",
      headers,
    });
    expect(res.status).toBe(404);
  });
});
