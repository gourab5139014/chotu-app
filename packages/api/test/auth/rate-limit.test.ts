import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { seedDeployment } from "../../src/db/bootstrap";
import { makeTestApp, type TestApp } from "../support/app";

describe("sign-in rate limiting (FR-2.6)", () => {
  let t: TestApp;

  beforeEach(async () => {
    t = makeTestApp({
      TRUSTED_PROXY: "true",
      RATE_LIMIT_SIGNIN_PER_MIN_IP: "5",
      RATE_LIMIT_SIGNIN_PER_MIN_ACCOUNT: "3",
    });
    await seedDeployment(t.handle, {
      admin: { email: "a@x.com", password: "password12345" },
    });
  });
  afterEach(() => t.cleanup());

  const attempt = (email: string, ip: string, password = "wrong") =>
    t.app.request("/auth/sign-in", {
      method: "POST",
      headers: { "content-type": "application/json", "x-forwarded-for": ip },
      body: JSON.stringify({ email, password }),
    });

  it("blocks a burst from one IP with 429 + Retry-After", async () => {
    // account limit is 3, so vary the account to isolate the IP limit (5)
    const statuses: number[] = [];
    for (let i = 0; i < 7; i++) {
      const res = await attempt(`u${i}@x.com`, "9.9.9.9");
      statuses.push(res.status);
      if (res.status === 429) {
        expect(Number(res.headers.get("retry-after"))).toBeGreaterThan(0);
      }
    }
    expect(statuses.filter((s) => s === 429).length).toBeGreaterThan(0);
    expect(statuses.slice(0, 5).every((s) => s === 401)).toBe(true);
  });

  it("blocks a burst against one account even across IPs", async () => {
    const s1 = await attempt("a@x.com", "1.1.1.1");
    const s2 = await attempt("a@x.com", "2.2.2.2");
    const s3 = await attempt("a@x.com", "3.3.3.3");
    const s4 = await attempt("a@x.com", "4.4.4.4");
    expect([s1.status, s2.status, s3.status]).toEqual([401, 401, 401]);
    expect(s4.status).toBe(429);
  });

  it("a fresh IP + account is unaffected", async () => {
    t.rateLimiter.reset();
    const ok = await t.app.request("/auth/sign-in", {
      method: "POST",
      headers: { "content-type": "application/json", "x-forwarded-for": "5.5.5.5" },
      body: JSON.stringify({ email: "a@x.com", password: "password12345" }),
    });
    expect(ok.status).toBe(200);
  });
});
