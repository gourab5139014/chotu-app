import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createSession } from "../../src/auth/session";
import { seedDeployment } from "../../src/db/bootstrap";
import { newId } from "../../src/domain/id";
import type { NewUser } from "../../src/db/schema/types";
import { expectAuditDelta } from "../support/audit";
import { makeTestApp, type TestApp } from "../support/app";

function regularUser(over: Partial<NewUser> = {}): NewUser {
  return {
    id: newId(),
    email: `u-${Math.random().toString(36).slice(2)}@x.com`,
    emailVerifiedAt: new Date(),
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

const NEW_PROVIDER = {
  key: "okta",
  displayName: "Okta",
  issuerUrl: "https://example.okta.com",
  clientId: "client-1",
  clientSecretRef: "env:OKTA_SECRET",
};

describe("/admin/oidc-providers", () => {
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

  const create = (body: unknown = NEW_PROVIDER) =>
    t.app.request("/admin/oidc-providers", {
      method: "POST",
      headers: adminHeaders,
      body: JSON.stringify(body),
    });

  it("rejects a non-admin caller (403)", async () => {
    const u = await t.repos.users.create(regularUser());
    const { token } = await createSession(t.handle, u.id, 3600);
    const res = await t.app.request("/admin/oidc-providers", {
      method: "POST",
      headers: {
        authorization: `Bearer ${token}`,
        "content-type": "application/json",
      },
      body: JSON.stringify(NEW_PROVIDER),
    });
    expect(res.status).toBe(403);
  });

  it("creates a provider without ever returning the secret, and audits it", async () => {
    const res = await expectAuditDelta(
      t.handle,
      { action: "oidc_provider.created" },
      () => create(),
    );
    expect(res.status).toBe(201);
    const { provider } = (await res.json()) as {
      provider: Record<string, unknown>;
    };
    expect(provider["key"]).toBe("okta");
    expect(provider["secretConfigured"]).toBe(true);
    expect(provider["scopes"]).toEqual(["openid", "email", "profile"]);
    expect(JSON.stringify(provider)).not.toContain("OKTA_SECRET");

    const stored = await t.repos.oidcProviders.findByKey("okta");
    expect(stored?.clientSecretRef).toBe("env:OKTA_SECRET");
  });

  it("rejects a duplicate key (409)", async () => {
    await create();
    const res = await create();
    expect(res.status).toBe(409);
  });

  it("rejects an invalid key format (400)", async () => {
    const res = await create({ ...NEW_PROVIDER, key: "Not Valid!" });
    expect(res.status).toBe(400);
  });

  it("rejects a malformed clientSecretRef (400)", async () => {
    const res = await create({
      ...NEW_PROVIDER,
      clientSecretRef: "just-the-raw-secret",
    });
    expect(res.status).toBe(400);
  });

  it("lists and reads a provider", async () => {
    await create();
    const list = await t.app.request("/admin/oidc-providers", {
      headers: adminHeaders,
    });
    const { providers } = (await list.json()) as { providers: unknown[] };
    expect(providers).toHaveLength(1);

    const detail = await t.app.request("/admin/oidc-providers/okta", {
      headers: adminHeaders,
    });
    expect(detail.status).toBe(200);
  });

  it("404s for an unknown key", async () => {
    const res = await t.app.request("/admin/oidc-providers/nope", {
      headers: adminHeaders,
    });
    expect(res.status).toBe(404);
  });

  it("updates a subset of fields", async () => {
    await create();
    const res = await t.app.request("/admin/oidc-providers/okta", {
      method: "PATCH",
      headers: adminHeaders,
      body: JSON.stringify({ enabled: false, displayName: "Okta (disabled)" }),
    });
    expect(res.status).toBe(200);
    const { provider } = (await res.json()) as {
      provider: Record<string, unknown>;
    };
    expect(provider["enabled"]).toBe(false);
    expect(provider["displayName"]).toBe("Okta (disabled)");
    expect(provider["clientId"]).toBe("client-1");
  });

  it("deletes a provider with no linked identities", async () => {
    await create();
    const res = await t.app.request("/admin/oidc-providers/okta", {
      method: "DELETE",
      headers: adminHeaders,
    });
    expect(res.status).toBe(204);
    expect(await t.repos.oidcProviders.findByKey("okta")).toBeNull();
  });

  it("refuses to delete a provider in use without force (409)", async () => {
    await create();
    const u = await t.repos.users.create(regularUser());
    await t.repos.identities.create({
      id: newId(),
      userId: u.id,
      providerKey: "okta",
      subject: "sub-1",
      emailAtLink: u.email,
    });

    const res = await t.app.request("/admin/oidc-providers/okta", {
      method: "DELETE",
      headers: adminHeaders,
    });
    expect(res.status).toBe(409);
    const body = (await res.json()) as { code: string };
    expect(body.code).toBe("provider_in_use");
    expect(await t.repos.oidcProviders.findByKey("okta")).not.toBeNull();
  });

  it("force delete refuses when it would strand a user (422)", async () => {
    await create();
    const u = await t.repos.users.create(regularUser({ passwordHash: null }));
    await t.repos.identities.create({
      id: newId(),
      userId: u.id,
      providerKey: "okta",
      subject: "sub-1",
      emailAtLink: u.email,
    });

    const res = await t.app.request(
      "/admin/oidc-providers/okta?force=true",
      { method: "DELETE", headers: adminHeaders },
    );
    expect(res.status).toBe(422);
    const body = (await res.json()) as { code: string };
    expect(body.code).toBe("auth_method_required");
    // Nothing was unlinked or deleted.
    expect(await t.repos.oidcProviders.findByKey("okta")).not.toBeNull();
    expect((await t.repos.identities.listForUser(u.id)).length).toBe(1);
  });

  it("force delete unlinks and deletes when every affected user still has a method", async () => {
    await create();
    const u = await t.repos.users.create(
      regularUser({ passwordHash: "argon2id$has-a-password" }),
    );
    await t.repos.identities.create({
      id: newId(),
      userId: u.id,
      providerKey: "okta",
      subject: "sub-1",
      emailAtLink: u.email,
    });

    const res = await expectAuditDelta(
      t.handle,
      { action: "oidc_provider.deleted" },
      () =>
        t.app.request("/admin/oidc-providers/okta?force=true", {
          method: "DELETE",
          headers: adminHeaders,
        }),
    );
    expect(res.status).toBe(204);
    expect(await t.repos.oidcProviders.findByKey("okta")).toBeNull();
    expect((await t.repos.identities.listForUser(u.id)).length).toBe(0);
  });
});
