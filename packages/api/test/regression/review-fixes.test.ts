import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { seedDeployment } from "../../src/db/bootstrap";
import { makeTestApp, type TestApp } from "../support/app";

describe("review fix: malformed x-request-id does not 500", () => {
  let t: TestApp;
  beforeEach(() => {
    t = makeTestApp();
  });
  afterEach(() => t.cleanup());

  it("ignores an unsafe request id and generates a clean UUID", async () => {
    const res = await t.app.request("/healthz", {
      headers: { "x-request-id": "id with spaces and $(danger)" },
    });
    expect(res.status).toBe(200);
    expect(res.headers.get("x-request-id")).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
    );
  });

  it("keeps a safe caller-supplied request id", async () => {
    const res = await t.app.request("/healthz", {
      headers: { "x-request-id": "trace-abc.123_DEF" },
    });
    expect(res.headers.get("x-request-id")).toBe("trace-abc.123_DEF");
  });
});

describe("review fix: successful sign-ins do not lock the account", () => {
  let t: TestApp;
  beforeEach(async () => {
    t = makeTestApp({ RATE_LIMIT_SIGNIN_PER_MIN_ACCOUNT: "3" });
    await seedDeployment(t.handle, {
      admin: { email: "a@x.com", password: "correct-horse-1" },
    });
  });
  afterEach(() => t.cleanup());

  const signin = (password: string) =>
    t.app.request("/auth/sign-in", {
      method: "POST",
      headers: { "content-type": "application/json", "x-forwarded-for": "7.7.7.7" },
      body: JSON.stringify({ email: "a@x.com", password }),
    });

  it("ten correct sign-ins in a row all succeed", async () => {
    for (let i = 0; i < 10; i++) {
      expect((await signin("correct-horse-1")).status).toBe(200);
    }
  });

  it("only failed attempts count toward the per-account limit", async () => {
    expect((await signin("wrong")).status).toBe(401);
    expect((await signin("wrong")).status).toBe(401);
    expect((await signin("wrong")).status).toBe(401);
    // 4th attempt (any password) is now blocked
    expect((await signin("correct-horse-1")).status).toBe(429);
  });
});

describe("review fix: a thrown AppError still produces a log line", () => {
  let t: TestApp;
  let spy: ReturnType<typeof vi.spyOn>;
  beforeEach(async () => {
    t = makeTestApp();
    await seedDeployment(t.handle, {
      admin: { email: "a@x.com", password: "correct-horse-1" },
    });
    spy = vi.spyOn(console, "log").mockImplementation(() => undefined);
  });
  afterEach(async () => {
    spy.mockRestore();
    await t.cleanup();
  });

  it("logs a 401 from a thrown unauthorized", async () => {
    await t.app.request("/auth/me"); // no credential -> authMiddleware throws 401
    const lines = spy.mock.calls
      .map((c) => String(c[0]))
      .filter((l) => l.startsWith('{"ts":"'));
    const parsed = lines
      .map((l) => JSON.parse(l) as Record<string, unknown>)
      .find((p) => p["path"] === "/auth/me");
    expect(parsed).toMatchObject({ status: 401, code: "unauthorized" });
  });
});
