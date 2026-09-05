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

describe("/admin/settings", () => {
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

  const patch = (body: unknown) =>
    t.app.request("/admin/settings", {
      method: "PATCH",
      headers: adminHeaders,
      body: JSON.stringify(body),
    });

  it("GET returns the settings with a read-only USD currency", async () => {
    const res = await t.app.request("/admin/settings", {
      headers: adminHeaders,
    });
    expect(res.status).toBe(200);
    const { settings } = (await res.json()) as {
      settings: Record<string, unknown>;
    };
    expect(settings["defaultCurrencyCode"]).toBe("USD");
    expect(settings["registrationPolicy"]).toBe("invite_only");
    expect(settings["allowedAuthMethods"]).toEqual(["password"]);
  });

  it("GET rejects a non-admin caller (403)", async () => {
    const u = await t.repos.users.create(regularUser());
    const { token } = await createSession(t.handle, u.id, 3600);
    const res = await t.app.request("/admin/settings", {
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.status).toBe(403);
  });

  it("PATCH updates a subset of fields and audits it", async () => {
    const res = await expectAuditDelta(
      t.handle,
      { action: "settings.updated" },
      () =>
        patch({
          fuelVolumePrecision: 2,
          sessionTtlSeconds: 7200,
          registrationPolicy: "open",
        }),
    );
    expect(res.status).toBe(200);
    const { settings } = (await res.json()) as {
      settings: Record<string, unknown>;
    };
    expect(settings["fuelVolumePrecision"]).toBe(2);
    expect(settings["sessionTtlSeconds"]).toBe(7200);
    expect(settings["registrationPolicy"]).toBe("open");
    // Untouched fields are unchanged.
    expect(settings["allowedAuthMethods"]).toEqual(["password"]);

    const stored = await t.repos.settings.get();
    expect(stored?.fuelVolumePrecision).toBe(2);
  });

  it("PATCH rejects an empty body (400)", async () => {
    expect((await patch({})).status).toBe(400);
  });

  it("PATCH rejects an empty allowedAuthMethods (400, before the business rule)", async () => {
    expect((await patch({ allowedAuthMethods: [] })).status).toBe(400);
  });

  it("PATCH rejects an unknown time zone (400)", async () => {
    expect(
      (await patch({ defaultTimeZone: "Mars/Olympus_Mons" })).status,
    ).toBe(400);
  });

  it("PATCH refuses to drop password while users exist (422 auth_method_required) — FR-9.2", async () => {
    const res = await patch({ allowedAuthMethods: ["oidc"] });
    expect(res.status).toBe(422);
    const body = (await res.json()) as { code: string };
    expect(body.code).toBe("auth_method_required");

    const stored = await t.repos.settings.get();
    expect(stored?.allowedAuthMethods).toEqual(["password"]);
  });

  it("PATCH allows keeping password alongside oidc", async () => {
    const res = await patch({ allowedAuthMethods: ["password", "oidc"] });
    expect(res.status).toBe(200);
    const stored = await t.repos.settings.get();
    expect(stored?.allowedAuthMethods).toEqual(["password", "oidc"]);
  });
});
