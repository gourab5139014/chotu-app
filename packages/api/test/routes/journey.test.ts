import { afterAll, beforeAll, expect, it } from "vitest";

import { seedDeployment } from "../../src/db/bootstrap";
import { describeEachAdapter } from "../support/adapters";
import { serveApp } from "../support/app";

/**
 * AC-5: one signed-in user goes end to end — invite, accept, sign in, add a
 * vehicle, log a fill-up, correct it — entirely over HTTP with a bearer
 * credential and no direct database access. Runs against both adapters.
 */
describeEachAdapter("AC-5 journey", (ctx) => {
  let baseUrl: string;
  let close: () => Promise<void>;
  let adminToken: string;

  beforeAll(async () => {
    const seeded = await seedDeployment(ctx().handle, {
      admin: { email: "admin@journey.test", password: "admin-password-1" },
    });
    adminToken = seeded.apiToken;
    ({ baseUrl, close } = await serveApp(ctx().handle));
  });

  afterAll(async () => {
    await close();
  });

  const call = (
    path: string,
    init: RequestInit & { token?: string } = {},
  ): Promise<Response> => {
    const { token, headers, ...rest } = init;
    return fetch(`${baseUrl}${path}`, {
      ...rest,
      headers: {
        "content-type": "application/json",
        ...(token != null ? { authorization: `Bearer ${token}` } : {}),
        ...(headers as Record<string, string> | undefined),
      },
    });
  };

  it("invite -> accept -> sign in -> vehicle -> fill-up -> correction", async () => {
    // 1. Admin invites a user.
    const invited = await call("/admin/invitations", {
      method: "POST",
      token: adminToken,
      body: JSON.stringify({ email: "driver@journey.test", invitedRole: "user" }),
    });
    expect(invited.status).toBe(201);
    const { invitationToken } = (await invited.json()) as {
      invitationToken: string;
    };

    // 2. The invitee accepts.
    const accepted = await call("/invitations/accept", {
      method: "POST",
      body: JSON.stringify({
        token: invitationToken,
        displayName: "Journey Driver",
        password: "driver-password-1",
      }),
    });
    expect(accepted.status).toBe(201);

    // 3. Sign in for a session bearer.
    const signedIn = await call("/auth/sign-in", {
      method: "POST",
      body: JSON.stringify({
        email: "driver@journey.test",
        password: "driver-password-1",
      }),
    });
    expect(signedIn.status).toBe(200);
    const { session } = (await signedIn.json()) as { session: string };
    expect(session.startsWith("chs_")).toBe(true);

    // 4. Add a vehicle.
    const vehicleRes = await call("/vehicles", {
      method: "POST",
      token: session,
      body: JSON.stringify({
        name: "Journey Car",
        make: "Toyota",
        initialOdometer: 30000,
      }),
    });
    expect(vehicleRes.status).toBe(201);
    const { vehicle } = (await vehicleRes.json()) as { vehicle: { id: string } };

    // 5. Log a fill-up.
    const entryRes = await call(`/vehicles/${vehicle.id}/entries`, {
      method: "POST",
      token: session,
      body: JSON.stringify({
        entryDate: "2026-02-01",
        odometer: 30450.5,
        volume: 11.2,
        totalCost: 41.99,
      }),
    });
    expect(entryRes.status).toBe(201);
    const { entry } = (await entryRes.json()) as {
      entry: { id: string; totalCostUsdCents: number };
    };
    expect(entry.totalCostUsdCents).toBe(4199);

    // 6. Correct the entry.
    const corrected = await call(`/entries/${entry.id}`, {
      method: "PATCH",
      token: session,
      body: JSON.stringify({ totalCost: 42.5, notes: "fixed the total" }),
    });
    expect(corrected.status).toBe(200);
    const { entry: fixed } = (await corrected.json()) as {
      entry: { totalCostUsdCents: number; notes: string };
    };
    expect(fixed.totalCostUsdCents).toBe(4250);
    expect(fixed.notes).toBe("fixed the total");

    // 7. The history reflects the correction, and only the owner sees it.
    const history = await call(`/vehicles/${vehicle.id}/entries`, {
      token: session,
    });
    expect(history.status).toBe(200);
    const { entries } = (await history.json()) as {
      entries: Array<{ id: string; totalCostUsdCents: number }>;
    };
    expect(entries).toHaveLength(1);
    expect(entries[0]?.totalCostUsdCents).toBe(4250);

    // The admin's bearer cannot read another user's entries (INV-9).
    const asAdmin = await call(`/vehicles/${vehicle.id}/entries`, {
      token: adminToken,
    });
    expect(asAdmin.status).toBe(404);
  });
});
