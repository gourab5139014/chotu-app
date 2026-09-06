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

describe("reconciliation routes (T10.2)", () => {
  let t: TestApp;
  let adminHeaders: Record<string, string>;
  let user: { id: string };
  let headers: Record<string, string>;
  let vehicleId: string;

  beforeEach(async () => {
    t = makeTestApp();
    await seedDeployment(t.handle, {
      admin: { email: "root@x.com", password: "password12345" },
    });
    const admin = (await t.repos.users.findByEmail("root@x.com"))!;
    adminHeaders = await headersFor(t, admin.id);

    user = await t.repos.users.create(regularUser({ email: "u@x.com" }));
    headers = await headersFor(t, user.id);
    const v = await t.app.request("/vehicles", {
      method: "POST",
      headers,
      body: JSON.stringify({ name: "Car", initialOdometer: 0 }),
    });
    vehicleId = ((await v.json()) as { vehicle: { id: string } }).vehicle.id;
  });
  afterEach(() => t.cleanup());

  const addEntry = (body: Record<string, unknown>) =>
    t.app.request(`/vehicles/${vehicleId}/entries`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        volume: 10,
        totalCost: 30,
        ...body,
      }),
    });

  it("GET /reconcile requires auth", async () => {
    expect((await t.app.request("/reconcile")).status).toBe(401);
  });

  it("a clean dataset returns no findings (FR-17.5)", async () => {
    await addEntry({ entryDate: "2026-01-05", odometer: 100 });
    await addEntry({ entryDate: "2026-01-12", odometer: 250 });
    const res = await t.app.request("/reconcile", { headers });
    expect(res.status).toBe(200);
    expect((await res.json()) as { findings: unknown[] }).toEqual({ findings: [] });
  });

  it("flags a duplicate pair with a message (per-user report)", async () => {
    // A tie is allowed at write time, so two identical entries can exist.
    await addEntry({ entryDate: "2026-02-01", odometer: 500 });
    await addEntry({ entryDate: "2026-02-01", odometer: 500 });

    const res = await t.app.request("/reconcile", { headers });
    const { findings } = (await res.json()) as {
      findings: Array<{ checkCode: string; message: string; recordType: string }>;
    };
    const dupes = findings.filter((f) => f.checkCode === "duplicate");
    expect(dupes).toHaveLength(2);
    expect(dupes[0]?.message).toMatch(/duplicate/i);
    expect(dupes[0]?.recordType).toBe("fuel_entry");
  });

  it("GET /admin/reconcile rejects a non-admin (403)", async () => {
    expect(
      (await t.app.request("/admin/reconcile", { headers })).status,
    ).toBe(403);
  });

  it("admin reconcile carries user id + check code only — no message, no field values", async () => {
    await addEntry({ entryDate: "2026-02-01", odometer: 500 });
    await addEntry({ entryDate: "2026-02-01", odometer: 500 });

    const res = await t.app.request("/admin/reconcile", { headers: adminHeaders });
    expect(res.status).toBe(200);
    const { findings } = (await res.json()) as {
      findings: Array<Record<string, unknown>>;
    };
    expect(findings.length).toBeGreaterThan(0);
    for (const f of findings) {
      expect(Object.keys(f).sort()).toEqual([
        "checkCode",
        "recordId",
        "recordType",
        "userId",
      ]);
      expect(f["userId"]).toBe(user.id);
    }
    // The exact-keys check above already proves no entry field leaked; also
    // make sure no message text is present (it could carry values).
    expect(JSON.stringify(findings).toLowerCase()).not.toContain("message");
  });
});
