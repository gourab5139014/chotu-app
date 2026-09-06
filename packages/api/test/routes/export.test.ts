import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createSession } from "../../src/auth/session";
import { seedDeployment } from "../../src/db/bootstrap";
import { newId } from "../../src/domain/id";
import type { FuelEntryRow, NewUser } from "../../src/db/schema/types";
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

type ExportDoc = {
  schemaVersion: number;
  canonicalUnits: { distance: string; volume: string; money: string };
  fuelVolumePrecision: number;
  profile: { unitSystem: string };
  vehicles: Array<{ id: string; name: string; initialOdometerMiE3: number }>;
  fuelEntries: Array<
    Pick<
      FuelEntryRow,
      | "vehicleId"
      | "entryDate"
      | "odometerMiE3"
      | "volumeGalE3"
      | "totalCostUsdCents"
      | "isFullTank"
      | "notes"
      | "sourceUnitSystem"
    > & { sourcePayload: Record<string, unknown> }
  >;
};

describe("export (T10.3)", () => {
  let t: TestApp;

  beforeEach(async () => {
    t = makeTestApp();
    await seedDeployment(t.handle, {
      admin: { email: "root@x.com", password: "password12345" },
    });
  });
  afterEach(() => t.cleanup());

  it("GET /export requires auth", async () => {
    expect((await t.app.request("/export")).status).toBe(401);
  });

  it("GET /admin/export rejects a non-admin (403)", async () => {
    const u = await t.repos.users.create(regularUser());
    const headers = await headersFor(t, u.id);
    expect((await t.app.request("/admin/export", { headers })).status).toBe(403);
  });

  it("admin backup omits credential hashes", async () => {
    const admin = (await t.repos.users.findByEmail("root@x.com"))!;
    const headers = await headersFor(t, admin.id);
    const res = await t.app.request("/admin/export", { headers });
    expect(res.status).toBe(200);
    const blob = JSON.stringify(await res.json());
    expect(blob).not.toContain("passwordHash");
    expect(blob).not.toContain("password_hash");
    expect(blob).not.toContain("tokenHash");
  });

  it("a user's export round-trips into a fresh account via a loader", async () => {
    // --- Source user A: profile pref + 2 vehicles + entries ---
    const a = await t.repos.users.create(
      regularUser({ email: "a@x.com", unitSystem: "imperial" }),
    );
    const aHeaders = await headersFor(t, a.id);

    const mkVehicle = async (name: string, initialOdometer: number) => {
      const r = await t.app.request("/vehicles", {
        method: "POST",
        headers: aHeaders,
        body: JSON.stringify({ name, initialOdometer }),
      });
      return ((await r.json()) as { vehicle: { id: string } }).vehicle.id;
    };
    const v1 = await mkVehicle("Alpha", 1000);
    const v2 = await mkVehicle("Beta", 0);

    const mkEntry = (vid: string, body: Record<string, unknown>) =>
      t.app.request(`/vehicles/${vid}/entries`, {
        method: "POST",
        headers: aHeaders,
        body: JSON.stringify({ volume: 10, totalCost: 30, ...body }),
      });
    await mkEntry(v1, { entryDate: "2026-01-05", odometer: 1100 });
    await mkEntry(v1, { entryDate: "2026-01-20", odometer: 1400, notes: "trip" });
    await mkEntry(v2, { entryDate: "2026-02-01", odometer: 60, isFullTank: false });

    const doc = (await (
      await t.app.request("/export", { headers: aHeaders })
    ).json()) as ExportDoc;

    expect(doc.canonicalUnits).toEqual({
      distance: "mi_e3",
      volume: "gal_e3",
      money: "usd_cents",
    });
    expect(doc.vehicles).toHaveLength(2);
    expect(doc.fuelEntries).toHaveLength(3);

    // --- Loader (not the API): rebuild the dataset for a fresh user B ---
    const b = await t.repos.users.create(regularUser({ email: "b@x.com" }));
    await t.repos.users.update(b.id, { unitSystem: doc.profile.unitSystem as never });

    const idMap = new Map<string, string>();
    for (const v of doc.vehicles) {
      const created = await t.repos.vehicles.create({
        id: newId(),
        userId: b.id,
        name: v.name,
        make: null,
        model: null,
        year: null,
        fuelType: null,
        initialOdometerMiE3: v.initialOdometerMiE3,
      });
      idMap.set(v.id, created.id);
    }
    for (const e of doc.fuelEntries) {
      await t.repos.fuelEntries.create({
        id: newId(),
        vehicleId: idMap.get(e.vehicleId)!,
        entryDate: e.entryDate,
        odometerMiE3: e.odometerMiE3,
        volumeGalE3: e.volumeGalE3,
        totalCostUsdCents: e.totalCostUsdCents,
        currencyCode: "USD",
        isFullTank: e.isFullTank,
        notes: e.notes,
        sourceUnitSystem: e.sourceUnitSystem,
        sourcePayload: e.sourcePayload,
      });
    }

    // --- B's export now matches A's, ignoring ids and timestamps ---
    const bHeaders = await headersFor(t, b.id);
    const bDoc = (await (
      await t.app.request("/export", { headers: bHeaders })
    ).json()) as ExportDoc;

    const normVehicle = (v: ExportDoc["vehicles"][number]) => ({
      name: v.name,
      initialOdometerMiE3: v.initialOdometerMiE3,
    });
    const byName = (
      x: { name: string },
      y: { name: string },
    ) => x.name.localeCompare(y.name);
    expect(bDoc.vehicles.map(normVehicle).sort(byName)).toEqual(
      doc.vehicles.map(normVehicle).sort(byName),
    );

    const normEntry = (e: ExportDoc["fuelEntries"][number]) => ({
      entryDate: e.entryDate,
      odometerMiE3: e.odometerMiE3,
      volumeGalE3: e.volumeGalE3,
      totalCostUsdCents: e.totalCostUsdCents,
      isFullTank: e.isFullTank,
      notes: e.notes,
      sourceUnitSystem: e.sourceUnitSystem,
      sourcePayload: JSON.stringify(e.sourcePayload),
    });
    const sortKey = (x: { entryDate: string; odometerMiE3: number }) =>
      `${x.entryDate}:${x.odometerMiE3}`;
    expect(
      bDoc.fuelEntries.map(normEntry).sort((x, y) => sortKey(x).localeCompare(sortKey(y))),
    ).toEqual(
      doc.fuelEntries.map(normEntry).sort((x, y) => sortKey(x).localeCompare(sortKey(y))),
    );
  });
});
