import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createSession } from "../../src/auth/session";
import { seedDeployment } from "../../src/db/bootstrap";
import { newId } from "../../src/domain/id";
import type { NewUser } from "../../src/db/schema/types";
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

async function headersFor(t: TestApp, userId: string) {
  const { token } = await createSession(t.handle, userId, 3600);
  return { authorization: `Bearer ${token}`, "content-type": "application/json" };
}

/**
 * AC-7: every user-scoped route rejects an unauthenticated caller, and a
 * request as user B (or as an admin) cannot reach user A's data. The tables
 * below enumerate the routes explicitly — a new user-scoped route must be
 * added here.
 */
describe("isolation matrix — every user-scoped route (AC-7, T11.2)", () => {
  let t: TestApp;
  let aHeaders: Record<string, string>;
  let bHeaders: Record<string, string>;
  let adminHeaders: Record<string, string>;
  // A's resources.
  let vehicleId: string;
  let entryId: string;
  let tokenId: string;
  let identityId: string;

  beforeEach(async () => {
    t = makeTestApp();
    await seedDeployment(t.handle, {
      admin: { email: "root@x.com", password: "password12345" },
    });
    const admin = (await t.repos.users.findByEmail("root@x.com"))!;
    adminHeaders = await headersFor(t, admin.id);

    const a = await t.repos.users.create(regularUser({ email: "a@x.com" }));
    const b = await t.repos.users.create(regularUser({ email: "b@x.com" }));
    aHeaders = await headersFor(t, a.id);
    bHeaders = await headersFor(t, b.id);

    const v = await t.app.request("/vehicles", {
      method: "POST",
      headers: aHeaders,
      body: JSON.stringify({ name: "A car", initialOdometer: 0 }),
    });
    vehicleId = ((await v.json()) as { vehicle: { id: string } }).vehicle.id;

    const e = await t.app.request(`/vehicles/${vehicleId}/entries`, {
      method: "POST",
      headers: aHeaders,
      body: JSON.stringify({
        entryDate: "2026-01-05",
        odometer: 100,
        volume: 10,
        totalCost: 30,
      }),
    });
    entryId = ((await e.json()) as { entry: { id: string } }).entry.id;

    const tok = await t.app.request("/tokens", {
      method: "POST",
      headers: aHeaders,
      body: JSON.stringify({ label: "a-token" }),
    });
    void (await tok.json());
    tokenId =
      (await t.repos.apiTokens.listForUser(a.id)).find(
        (x) => x.label === "a-token",
      )?.id ?? "none";

    await t.repos.oidcProviders.create({
      id: newId(),
      key: "p",
      displayName: "P",
      issuerUrl: "https://p.example.com",
      clientId: "c",
      clientSecretRef: "env:P_SECRET",
      scopes: ["openid"],
      allowedEmailDomains: null,
      allowedGroups: null,
      autoProvision: false,
      enabled: true,
    });
    const identity = await t.repos.identities.create({
      id: newId(),
      userId: a.id,
      providerKey: "p",
      subject: "s",
      emailAtLink: "a@x.com",
    });
    identityId = identity.id;
  });
  afterEach(() => t.cleanup());

  interface Route {
    method: string;
    path: () => string;
    body?: unknown;
    /** An id-scoped route yields 404 for a non-owner; a collection route 200. */
    idScoped: boolean;
  }

  const routes = (): Route[] => [
    { method: "GET", path: () => "/profile", idScoped: false },
    { method: "GET", path: () => "/vehicles", idScoped: false },
    { method: "GET", path: () => `/vehicles/${vehicleId}`, idScoped: true },
    {
      method: "PATCH",
      path: () => `/vehicles/${vehicleId}`,
      body: { name: "hijack" },
      idScoped: true,
    },
    {
      method: "POST",
      path: () => `/vehicles/${vehicleId}/archive`,
      idScoped: true,
    },
    {
      method: "POST",
      path: () => `/vehicles/${vehicleId}/unarchive`,
      idScoped: true,
    },
    { method: "DELETE", path: () => `/vehicles/${vehicleId}`, idScoped: true },
    {
      method: "GET",
      path: () => `/vehicles/${vehicleId}/entries`,
      idScoped: true,
    },
    {
      method: "POST",
      path: () => `/vehicles/${vehicleId}/entries`,
      body: { entryDate: "2026-02-02", odometer: 1, volume: 1, totalCost: 1 },
      idScoped: true,
    },
    { method: "GET", path: () => `/entries/${entryId}`, idScoped: true },
    {
      method: "PATCH",
      path: () => `/entries/${entryId}`,
      body: { notes: "hijack" },
      idScoped: true,
    },
    { method: "DELETE", path: () => `/entries/${entryId}`, idScoped: true },
    { method: "GET", path: () => "/reconcile", idScoped: false },
    { method: "GET", path: () => "/export", idScoped: false },
    { method: "GET", path: () => "/identities", idScoped: false },
    { method: "DELETE", path: () => `/identities/${identityId}`, idScoped: true },
    { method: "GET", path: () => "/tokens", idScoped: false },
    { method: "DELETE", path: () => `/tokens/${tokenId}`, idScoped: true },
    { method: "GET", path: () => "/auth/me", idScoped: false },
  ];

  const send = (r: Route, headers?: Record<string, string>) =>
    t.app.request(r.path(), {
      method: r.method,
      ...(headers != null ? { headers } : { headers: { "content-type": "application/json" } }),
      ...(r.body !== undefined ? { body: JSON.stringify(r.body) } : {}),
    });

  it("rejects every route unauthenticated (401)", async () => {
    for (const r of routes()) {
      const res = await send(r);
      expect(res.status, `${r.method} ${r.path()}`).toBe(401);
    }
  });

  it("an id-scoped route never exposes another user's record (404 for B and for the admin)", async () => {
    for (const r of routes()) {
      if (!r.idScoped) continue;
      for (const [who, headers] of [
        ["user B", bHeaders],
        ["admin", adminHeaders],
      ] as const) {
        const res = await send(r, headers);
        expect([404, 400], `${r.method} ${r.path()} as ${who}`).toContain(
          res.status,
        );
        // 400 only for a bad body shape on PATCH/POST; ownership is still not leaked.
      }
    }
    // A's own resources still resolve.
    expect((await send(routes()[2]!, aHeaders)).status).toBe(200);
  });

  it("collection routes are scoped to the caller — B sees none of A's data", async () => {
    const bVehicles = await t.app.request("/vehicles", { headers: bHeaders });
    expect(((await bVehicles.json()) as { vehicles: unknown[] }).vehicles).toEqual(
      [],
    );
    const bReconcile = await t.app.request("/reconcile", { headers: bHeaders });
    expect(
      ((await bReconcile.json()) as { findings: unknown[] }).findings,
    ).toEqual([]);
    const bExport = await t.app.request("/export", { headers: bHeaders });
    const doc = (await bExport.json()) as {
      vehicles: unknown[];
      fuelEntries: unknown[];
    };
    expect(doc.vehicles).toEqual([]);
    expect(doc.fuelEntries).toEqual([]);
  });
});
