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

describe("/vehicles", () => {
  let t: TestApp;
  let headers: Record<string, string>;
  let userId: string;

  beforeEach(async () => {
    t = makeTestApp();
    await seedDeployment(t.handle, {
      admin: { email: "root@x.com", password: "password12345" },
    });
    const u = await t.repos.users.create(regularUser({ email: "u@x.com" }));
    userId = u.id;
    const { token } = await createSession(t.handle, u.id, 3600);
    headers = {
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
    };
  });
  afterEach(() => t.cleanup());

  const create = (body: unknown, h = headers) =>
    t.app.request("/vehicles", { method: "POST", headers: h, body: JSON.stringify(body) });

  it("requires auth", async () => {
    expect((await t.app.request("/vehicles")).status).toBe(401);
  });

  it("creates a vehicle with the odometer in the caller's unit system", async () => {
    const res = await create({ name: "Civic", make: "Honda", initialOdometer: 12345.6 });
    expect(res.status).toBe(201);
    const { vehicle } = (await res.json()) as {
      vehicle: {
        name: string;
        make: string;
        initialOdometerMiE3: number;
        initialOdometer: number;
        unitSystem: string;
      };
    };
    expect(vehicle.name).toBe("Civic");
    expect(vehicle.make).toBe("Honda");
    expect(vehicle.initialOdometerMiE3).toBe(12_345_600);
    expect(vehicle.initialOdometer).toBe(12345.6);
    expect(vehicle.unitSystem).toBe("imperial");
  });

  it("converts a metric caller's odometer to the canonical mi_e3", async () => {
    const metricUser = await t.repos.users.create(
      regularUser({ email: "metric@x.com", unitSystem: "metric" }),
    );
    const { token } = await createSession(t.handle, metricUser.id, 3600);
    const metricHeaders = {
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
    };

    const res = await create({ name: "Golf", initialOdometer: 100 }, metricHeaders);
    expect(res.status).toBe(201);
    const { vehicle } = (await res.json()) as {
      vehicle: { initialOdometerMiE3: number; unitSystem: string };
    };
    // 100 km -> ~62.137 mi -> 62137 mi_e3.
    expect(vehicle.initialOdometerMiE3).toBe(62_137);
    expect(vehicle.unitSystem).toBe("metric");
  });

  it("rejects a duplicate active name (409)", async () => {
    await create({ name: "Dupe", initialOdometer: 0 });
    const res = await create({ name: "Dupe", initialOdometer: 0 });
    expect(res.status).toBe(409);
  });

  it("lists vehicles, hiding archived ones by default", async () => {
    const a = (await (await create({ name: "Active", initialOdometer: 0 })).json()) as {
      vehicle: { id: string };
    };
    const b = (await (
      await create({ name: "Soon Archived", initialOdometer: 0 })
    ).json()) as { vehicle: { id: string } };
    await t.app.request(`/vehicles/${b.vehicle.id}/archive`, {
      method: "POST",
      headers,
    });

    const defaultList = await t.app.request("/vehicles", { headers });
    const { vehicles: defaultVehicles } = (await defaultList.json()) as {
      vehicles: Array<{ id: string }>;
    };
    expect(defaultVehicles.map((v) => v.id)).toEqual([a.vehicle.id]);

    const fullList = await t.app.request("/vehicles?includeArchived=true", { headers });
    const { vehicles: fullVehicles } = (await fullList.json()) as {
      vehicles: Array<{ id: string }>;
    };
    expect(fullVehicles).toHaveLength(2);
  });

  it("gets, updates, archives, unarchives, and deletes one vehicle", async () => {
    const created = (await (
      await create({ name: "Original", initialOdometer: 0 })
    ).json()) as { vehicle: { id: string } };
    const id = created.vehicle.id;

    const got = await t.app.request(`/vehicles/${id}`, { headers });
    expect(got.status).toBe(200);

    const patched = await t.app.request(`/vehicles/${id}`, {
      method: "PATCH",
      headers,
      body: JSON.stringify({ name: "Renamed", year: 2019 }),
    });
    expect(patched.status).toBe(200);
    const { vehicle: patchedVehicle } = (await patched.json()) as {
      vehicle: { name: string; year: number };
    };
    expect(patchedVehicle.name).toBe("Renamed");
    expect(patchedVehicle.year).toBe(2019);

    const emptyPatch = await t.app.request(`/vehicles/${id}`, {
      method: "PATCH",
      headers,
      body: JSON.stringify({}),
    });
    expect(emptyPatch.status).toBe(400);

    const archived = await t.app.request(`/vehicles/${id}/archive`, {
      method: "POST",
      headers,
    });
    expect(archived.status).toBe(200);
    expect(
      ((await archived.json()) as { vehicle: { archivedAt: string | null } })
        .vehicle.archivedAt,
    ).not.toBeNull();
    // Idempotent.
    expect(
      (await t.app.request(`/vehicles/${id}/archive`, { method: "POST", headers })).status,
    ).toBe(200);

    const unarchived = await t.app.request(`/vehicles/${id}/unarchive`, {
      method: "POST",
      headers,
    });
    expect(
      ((await unarchived.json()) as { vehicle: { archivedAt: string | null } })
        .vehicle.archivedAt,
    ).toBeNull();

    const deleted = await t.app.request(`/vehicles/${id}`, {
      method: "DELETE",
      headers,
    });
    expect(deleted.status).toBe(204);
    expect((await t.app.request(`/vehicles/${id}`, { headers })).status).toBe(404);
  });

  describe("isolation matrix — every vehicle route (FR-11.6)", () => {
    let vehicleId: string;
    let otherHeaders: Record<string, string>;

    beforeEach(async () => {
      const created = (await (
        await create({ name: "Owned", initialOdometer: 0 })
      ).json()) as { vehicle: { id: string } };
      vehicleId = created.vehicle.id;

      const other = await t.repos.users.create(regularUser({ email: "other@x.com" }));
      const { token } = await createSession(t.handle, other.id, 3600);
      otherHeaders = {
        authorization: `Bearer ${token}`,
        "content-type": "application/json",
      };
    });

    const routes: Array<{ method: string; path: () => string; body?: unknown }> = [
      { method: "GET", path: () => "/vehicles" },
      { method: "POST", path: () => "/vehicles", body: { name: "X", initialOdometer: 0 } },
      { method: "GET", path: () => `/vehicles/${vehicleId}` },
      {
        method: "PATCH",
        path: () => `/vehicles/${vehicleId}`,
        body: { name: "Hijacked" },
      },
      { method: "POST", path: () => `/vehicles/${vehicleId}/archive` },
      { method: "POST", path: () => `/vehicles/${vehicleId}/unarchive` },
      { method: "DELETE", path: () => `/vehicles/${vehicleId}` },
    ];

    it("every route rejects an unauthenticated caller (401)", async () => {
      for (const r of routes) {
        const res = await t.app.request(r.path(), {
          method: r.method,
          headers: { "content-type": "application/json" },
          ...(r.body !== undefined ? { body: JSON.stringify(r.body) } : {}),
        });
        expect(res.status, `${r.method} ${r.path()}`).toBe(401);
      }
    });

    it("every :id route 404s for a non-owning user; the list/create routes are unaffected by ownership", async () => {
      for (const r of routes) {
        const res = await t.app.request(r.path(), {
          method: r.method,
          headers: otherHeaders,
          ...(r.body !== undefined ? { body: JSON.stringify(r.body) } : {}),
        });
        const expected = r.path().includes(vehicleId) ? 404 : [200, 201];
        if (Array.isArray(expected)) {
          expect(expected, `${r.method} ${r.path()}`).toContain(res.status);
        } else {
          expect(res.status, `${r.method} ${r.path()}`).toBe(expected);
        }
      }
      // The owner's vehicle is untouched by the other user's attempts.
      expect((await t.app.request(`/vehicles/${vehicleId}`, { headers })).status).toBe(
        200,
      );
    });
  });

  it("self-delete removes the account's vehicles too (deleteUserInTx)", async () => {
    await create({ name: "Mine", initialOdometer: 0 });
    const del = await t.app.request("/profile", { method: "DELETE", headers });
    expect(del.status).toBe(204);
    expect(await t.repos.vehicles.listForUser(userId)).toHaveLength(0);
  });
});
