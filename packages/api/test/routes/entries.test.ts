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

describe("/entries", () => {
  let t: TestApp;
  let headers: Record<string, string>;
  let vehicleId: string;

  beforeEach(async () => {
    t = makeTestApp();
    await seedDeployment(t.handle, {
      admin: { email: "root@x.com", password: "password12345" },
    });
    const u = await t.repos.users.create(regularUser({ email: "u@x.com" }));
    headers = await headersFor(t, u.id);
    const created = await t.app.request("/vehicles", {
      method: "POST",
      headers,
      body: JSON.stringify({ name: "Car", initialOdometer: 0 }),
    });
    vehicleId = ((await created.json()) as { vehicle: { id: string } }).vehicle.id;
  });
  afterEach(() => t.cleanup());

  const createEntry = (body: unknown, h = headers, vid = vehicleId) =>
    t.app.request(`/vehicles/${vid}/entries`, {
      method: "POST",
      headers: h,
      body: JSON.stringify(body),
    });

  it("requires auth", async () => {
    expect(
      (await t.app.request(`/vehicles/${vehicleId}/entries`, { method: "POST" }))
        .status,
    ).toBe(401);
  });

  it("creates an entry, storing canonical integers and a display projection", async () => {
    const res = await createEntry({
      entryDate: "2026-01-15",
      odometer: 12345.5,
      volume: 11.2,
      totalCost: 42.5,
      isFullTank: true,
      notes: "regular",
    });
    expect(res.status).toBe(201);
    const { entry } = (await res.json()) as {
      entry: Record<string, unknown>;
    };
    expect(entry["odometerMiE3"]).toBe(12_345_500);
    expect(entry["volumeGalE3"]).toBe(11_200);
    expect(entry["totalCostUsdCents"]).toBe(4250);
    expect(entry["odometer"]).toBe(12345.5);
    expect(entry["volume"]).toBe(11.2);
    expect(entry["totalCost"]).toBe(42.5);
    expect(entry["totalCostFormatted"]).toBe("42.50");
    expect(entry["sourceUnitSystem"]).toBe("imperial");
  });

  it("a metric create reads back the same display value (T9a.2)", async () => {
    const metric = await t.repos.users.create(
      regularUser({ email: "metric@x.com", unitSystem: "metric" }),
    );
    const mHeaders = await headersFor(t, metric.id);
    const mVehicle = await t.app.request("/vehicles", {
      method: "POST",
      headers: mHeaders,
      body: JSON.stringify({ name: "Golf", initialOdometer: 0 }),
    });
    const mVid = ((await mVehicle.json()) as { vehicle: { id: string } }).vehicle
      .id;

    const created = await createEntry(
      { entryDate: "2026-01-15", odometer: 200000, volume: 45.5, totalCost: 80 },
      mHeaders,
      mVid,
    );
    const createdBody = (await created.json()) as {
      entry: { id: string; volume: number };
    };
    expect(createdBody.entry.volume).toBeCloseTo(45.5, 2);

    const got = await t.app.request(`/entries/${createdBody.entry.id}`, {
      headers: mHeaders,
    });
    const gotBody = (await got.json()) as { entry: { volume: number } };
    expect(gotBody.entry.volume).toBe(createdBody.entry.volume);
  });

  it("rejects a create against a vehicle the caller does not own (404)", async () => {
    const other = await t.repos.users.create(regularUser({ email: "other@x.com" }));
    const oHeaders = await headersFor(t, other.id);
    const res = await createEntry(
      { entryDate: "2026-01-15", odometer: 1, volume: 1, totalCost: 1 },
      oHeaders,
    );
    expect(res.status).toBe(404);
  });

  it("rejects a non-positive volume (400)", async () => {
    const res = await createEntry({
      entryDate: "2026-01-15",
      odometer: 1,
      volume: 0,
      totalCost: 1,
    });
    expect(res.status).toBe(400);
  });

  it("gets, updates, and deletes an entry; wrong owner is 404", async () => {
    const created = await createEntry({
      entryDate: "2026-01-15",
      odometer: 100,
      volume: 10,
      totalCost: 30,
    });
    const id = ((await created.json()) as { entry: { id: string } }).entry.id;

    const other = await t.repos.users.create(regularUser({ email: "o2@x.com" }));
    const oHeaders = await headersFor(t, other.id);
    expect(
      (await t.app.request(`/entries/${id}`, { headers: oHeaders })).status,
    ).toBe(404);

    const patched = await t.app.request(`/entries/${id}`, {
      method: "PATCH",
      headers,
      body: JSON.stringify({ totalCost: 33.33, notes: "corrected" }),
    });
    expect(patched.status).toBe(200);
    const { entry } = (await patched.json()) as {
      entry: { totalCostUsdCents: number; notes: string };
    };
    expect(entry.totalCostUsdCents).toBe(3333);
    expect(entry.notes).toBe("corrected");

    const emptyPatch = await t.app.request(`/entries/${id}`, {
      method: "PATCH",
      headers,
      body: JSON.stringify({}),
    });
    expect(emptyPatch.status).toBe(400);

    expect(
      (await t.app.request(`/entries/${id}`, { method: "DELETE", headers })).status,
    ).toBe(204);
    expect((await t.app.request(`/entries/${id}`, { headers })).status).toBe(404);
  });

  it("rejects a create or update on an archived vehicle (INV-3, 409)", async () => {
    const created = await createEntry({
      entryDate: "2026-01-15",
      odometer: 100,
      volume: 10,
      totalCost: 30,
    });
    const entryId = ((await created.json()) as { entry: { id: string } }).entry.id;

    await t.app.request(`/vehicles/${vehicleId}/archive`, {
      method: "POST",
      headers,
    });

    const create409 = await createEntry({
      entryDate: "2026-01-16",
      odometer: 200,
      volume: 10,
      totalCost: 30,
    });
    expect(create409.status).toBe(409);

    const patch409 = await t.app.request(`/entries/${entryId}`, {
      method: "PATCH",
      headers,
      body: JSON.stringify({ notes: "cannot" }),
    });
    expect(patch409.status).toBe(409);
  });

  it("rejects an entry date more than two days ahead (INV-4, 400)", async () => {
    const far = await createEntry({
      entryDate: "2099-01-01",
      odometer: 1,
      volume: 1,
      totalCost: 1,
    });
    expect(far.status).toBe(400);

    // Tomorrow in UTC is within the two-day window in any timezone.
    const tomorrow = new Date(Date.now() + 86_400_000).toISOString().slice(0, 10);
    const ok = await createEntry({
      entryDate: tomorrow,
      odometer: 2,
      volume: 1,
      totalCost: 1,
    });
    expect(ok.status).toBe(201);
  });

  describe("odometer progression (INV-2, T9b.1)", () => {
    const mk = (entryDate: string, odometer: number) => ({
      entryDate,
      odometer,
      volume: 10,
      totalCost: 30,
    });

    it("accepts a non-decreasing sequence and an exact tie", async () => {
      expect((await createEntry(mk("2026-01-05", 100))).status).toBe(201);
      expect((await createEntry(mk("2026-01-12", 250))).status).toBe(201);
      expect((await createEntry(mk("2026-01-20", 250))).status).toBe(201); // tie
    });

    it("rejects an appended entry that decreases (422 odometer_decrease)", async () => {
      await createEntry(mk("2026-01-05", 300));
      const res = await createEntry(mk("2026-01-12", 200));
      expect(res.status).toBe(422);
      expect(((await res.json()) as { code: string }).code).toBe(
        "odometer_decrease",
      );
    });

    it("rejects a create below the vehicle's starting odometer", async () => {
      // vehicle created with initialOdometer 0, so use a fresh vehicle.
      const v = await t.app.request("/vehicles", {
        method: "POST",
        headers,
        body: JSON.stringify({ name: "High Start", initialOdometer: 5000 }),
      });
      const vid = ((await v.json()) as { vehicle: { id: string } }).vehicle.id;
      const res = await t.app.request(`/vehicles/${vid}/entries`, {
        method: "POST",
        headers,
        body: JSON.stringify(mk("2026-01-05", 4000)),
      });
      expect(res.status).toBe(422);
    });

    it("rejects a back-dated entry that lands mid-sequence and decreases", async () => {
      await createEntry(mk("2026-01-05", 100));
      await createEntry(mk("2026-01-20", 500));
      const res = await createEntry(mk("2026-01-10", 50)); // between, and < 100
      expect(res.status).toBe(422);
    });

    it("rejects an update that would make an adjacent pair decrease", async () => {
      const a = await createEntry(mk("2026-01-05", 100));
      await createEntry(mk("2026-01-20", 500));
      const aId = ((await a.json()) as { entry: { id: string } }).entry.id;
      const res = await t.app.request(`/entries/${aId}`, {
        method: "PATCH",
        headers,
        body: JSON.stringify({ odometer: 800 }), // now > the 2026-01-20 entry
      });
      expect(res.status).toBe(422);
    });

    it("allows an update that corrects a value upward within bounds", async () => {
      const a = await createEntry(mk("2026-01-05", 100));
      await createEntry(mk("2026-01-20", 500));
      const aId = ((await a.json()) as { entry: { id: string } }).entry.id;
      const res = await t.app.request(`/entries/${aId}`, {
        method: "PATCH",
        headers,
        body: JSON.stringify({ odometer: 300 }),
      });
      expect(res.status).toBe(200);
    });

    it("concurrent creates never leave a decreasing adjacent pair (T9b.2)", async () => {
      for (let i = 0; i < 5; i++) {
        const v = await t.app.request("/vehicles", {
          method: "POST",
          headers,
          body: JSON.stringify({ name: `Race ${i}`, initialOdometer: 0 }),
        });
        const vid = ((await v.json()) as { vehicle: { id: string } }).vehicle.id;
        await t.app.request(`/vehicles/${vid}/entries`, {
          method: "POST",
          headers,
          body: JSON.stringify(mk("2026-01-10", 1000)),
        });

        // Both dated after the baseline; each passes on its own against [1000],
        // but one ordering of the two would decrease. The vehicle row lock
        // serialises the check-and-write (FR-13.7).
        const [ra, rb] = await Promise.all([
          t.app.request(`/vehicles/${vid}/entries`, {
            method: "POST",
            headers,
            body: JSON.stringify(mk("2026-01-20", 1500)),
          }),
          t.app.request(`/vehicles/${vid}/entries`, {
            method: "POST",
            headers,
            body: JSON.stringify(mk("2026-01-20", 1200)),
          }),
        ]);

        expect([ra.status, rb.status].filter((s) => s === 201).length).toBeGreaterThanOrEqual(1);

        const ordered = await t.repos.fuelEntries.listForVehicleOrdered(vid);
        for (let j = 1; j < ordered.length; j++) {
          expect(ordered[j]!.odometerMiE3).toBeGreaterThanOrEqual(
            ordered[j - 1]!.odometerMiE3,
          );
        }
      }
    });
  });

  describe("history + pagination (FR-12.2, FR-14, T9c.1)", () => {
    type Page = {
      entries: Array<{ id: string; entryDate: string }>;
      page: {
        limit: number;
        order: string;
        filter: { from: string | null; to: string | null };
        nextCursor: string | null;
      };
    };
    const list = (query = "") =>
      t.app.request(`/vehicles/${vehicleId}/entries${query}`, { headers });

    it("orders entry_date desc and echoes the applied filter, order, and page size", async () => {
      for (const d of ["2026-03-01", "2026-01-01", "2026-02-01"]) {
        await createEntry({ entryDate: d, odometer: 1, volume: 1, totalCost: 1 });
      }
      const res = await list("?from=2026-01-15&to=2026-12-31&limit=10");
      expect(res.status).toBe(200);
      const body = (await res.json()) as Page;
      expect(body.entries.map((e) => e.entryDate)).toEqual([
        "2026-03-01",
        "2026-02-01",
      ]);
      expect(body.page.limit).toBe(10);
      expect(body.page.order).toContain("entry_date desc");
      expect(body.page.filter).toEqual({ from: "2026-01-15", to: "2026-12-31" });
      expect(body.page.nextCursor).toBeNull();
    });

    it("400s a malformed cursor", async () => {
      expect((await list("?cursor=not-base64!!")).status).toBe(400);
    });

    it("keyset pagination never skips or repeats a row across insert and delete", async () => {
      // E1..E9 on 2026-01-01 .. 2026-01-09 -> DESC scroll is E9,E8,...,E1.
      const ids: Record<string, string> = {};
      for (let i = 1; i <= 9; i++) {
        const res = await createEntry({
          entryDate: `2026-01-0${i}`,
          odometer: i * 10,
          volume: 1,
          totalCost: 1,
        });
        ids[`E${i}`] = ((await res.json()) as { entry: { id: string } }).entry.id;
      }

      // Page 1.
      const p1 = (await (await list("?limit=3")).json()) as Page;
      expect(p1.entries.map((e) => e.id)).toEqual([ids.E9, ids.E8, ids.E7]);
      expect(p1.page.nextCursor).not.toBeNull();

      // Mutate the unseen tail: delete E5, insert E10 dated 2026-01-02.
      await t.app.request(`/entries/${ids.E5}`, { method: "DELETE", headers });
      const e10 = await createEntry({
        entryDate: "2026-01-02",
        odometer: 25,
        volume: 1,
        totalCost: 1,
      });
      ids.E10 = ((await e10.json()) as { entry: { id: string } }).entry.id;

      // Walk the rest.
      const seen = [...p1.entries.map((e) => e.id)];
      let cursor = p1.page.nextCursor;
      while (cursor != null) {
        const pg = (await (
          await list(`?limit=3&cursor=${encodeURIComponent(cursor)}`)
        ).json()) as Page;
        seen.push(...pg.entries.map((e) => e.id));
        cursor = pg.page.nextCursor;
      }

      // No id returned twice.
      expect(new Set(seen).size).toBe(seen.length);
      // E5 (deleted, unseen) never appears; E10 (inserted into the tail) does.
      expect(seen).not.toContain(ids.E5);
      expect(seen).toContain(ids.E10);
      // Every entry currently in the DB was returned exactly once.
      const stored = await t.repos.fuelEntries.listForVehicleOrdered(vehicleId);
      expect(seen.slice().sort()).toEqual(stored.map((e) => e.id).sort());
    });
  });

  it("vehicle delete needs ?cascade=true once entries exist (FR-11.5)", async () => {
    await createEntry({
      entryDate: "2026-01-15",
      odometer: 1,
      volume: 1,
      totalCost: 1,
    });

    const noFlag = await t.app.request(`/vehicles/${vehicleId}`, {
      method: "DELETE",
      headers,
    });
    expect(noFlag.status).toBe(409);

    const withFlag = await t.app.request(`/vehicles/${vehicleId}?cascade=true`, {
      method: "DELETE",
      headers,
    });
    expect(withFlag.status).toBe(204);
    expect(await t.repos.fuelEntries.countForVehicle(vehicleId)).toBe(0);
    expect(await t.repos.vehicles.findById(vehicleId)).toBeNull();
  });
});
