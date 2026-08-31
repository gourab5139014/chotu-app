import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createSession } from "../../src/auth/session";
import { seedDeployment } from "../../src/db/bootstrap";
import { makeTestApp, type TestApp } from "../support/app";

describe("/profile routes", () => {
  let t: TestApp;
  let headers: Record<string, string>;
  let userId: string;

  beforeEach(async () => {
    t = makeTestApp();
    await seedDeployment(t.handle, {
      admin: { email: "a@x.com", password: "password12345" },
    });
    const u = (await t.repos.users.findByEmail("a@x.com"))!;
    userId = u.id;
    const { token } = await createSession(t.handle, u.id, 3600);
    headers = {
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
    };
  });
  afterEach(() => t.cleanup());

  it("requires auth", async () => {
    expect((await t.app.request("/profile")).status).toBe(401);
  });

  it("GET returns the profile with a read-only USD currency", async () => {
    const res = await t.app.request("/profile", { headers });
    expect(res.status).toBe(200);
    const { profile } = (await res.json()) as {
      profile: Record<string, unknown>;
    };
    expect(profile).toMatchObject({
      id: userId,
      email: "a@x.com",
      unitSystem: "imperial",
      currencyCode: "USD",
    });
    expect(typeof profile["timeZone"]).toBe("string");
  });

  it("PATCH updates display name, unit system, and time zone", async () => {
    const res = await t.app.request("/profile", {
      method: "PATCH",
      headers,
      body: JSON.stringify({
        displayName: "Road Tripper",
        unitSystem: "metric",
        timeZone: "America/Los_Angeles",
      }),
    });
    expect(res.status).toBe(200);
    const { profile } = (await res.json()) as {
      profile: Record<string, unknown>;
    };
    expect(profile).toMatchObject({
      displayName: "Road Tripper",
      unitSystem: "metric",
      timeZone: "America/Los_Angeles",
      currencyCode: "USD",
    });

    const stored = (await t.repos.users.findById(userId))!;
    expect(stored.unitSystem).toBe("metric");
    expect(stored.displayName).toBe("Road Tripper");
  });

  it("PATCH accepts a single field", async () => {
    const res = await t.app.request("/profile", {
      method: "PATCH",
      headers,
      body: JSON.stringify({ displayName: "Just A Name" }),
    });
    expect(res.status).toBe(200);
    const stored = (await t.repos.users.findById(userId))!;
    expect(stored.displayName).toBe("Just A Name");
    expect(stored.unitSystem).toBe("imperial");
  });

  it("PATCH rejects an empty body (400)", async () => {
    const res = await t.app.request("/profile", {
      method: "PATCH",
      headers,
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(400);
  });

  it("PATCH rejects an unknown time zone (400)", async () => {
    const res = await t.app.request("/profile", {
      method: "PATCH",
      headers,
      body: JSON.stringify({ timeZone: "Mars/Olympus_Mons" }),
    });
    expect(res.status).toBe(400);
  });

  it("PATCH ignores currencyCode and role (not in the schema)", async () => {
    const res = await t.app.request("/profile", {
      method: "PATCH",
      headers,
      body: JSON.stringify({
        displayName: "OK",
        currencyCode: "EUR",
        role: "user",
      }),
    });
    expect(res.status).toBe(200);
    const stored = (await t.repos.users.findById(userId))!;
    expect(stored.currencyCode).toBe("USD");
    expect(stored.role).toBe("admin");
  });
});
