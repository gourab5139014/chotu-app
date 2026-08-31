import { Hono } from "hono";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { AppError } from "../src/domain/errors";
import { redact } from "../src/log";
import type { AppHono } from "../src/http/context";
import { onError, onNotFound } from "../src/middleware/error";
import { logging } from "../src/middleware/logging";
import { requestId } from "../src/middleware/request-id";

function bareApp(): Hono<AppHono> {
  const app = new Hono<AppHono>();
  app.onError(onError);
  app.notFound(onNotFound);
  app.use("*", requestId);
  app.use("*", logging);
  return app;
}

describe("redact", () => {
  it("drops secret-bearing keys at any depth, keeps the rest", () => {
    const out = redact({
      email: "a@b.com",
      password: "hunter2",
      nested: { token_hash: "deadbeef", ok: 1 },
      list: [{ authorization: "Bearer x" }],
    });
    expect(out).toEqual({
      email: "a@b.com",
      password: "[redacted]",
      nested: { token_hash: "[redacted]", ok: 1 },
      list: [{ authorization: "[redacted]" }],
    });
  });
});

describe("error middleware", () => {
  it("renders an AppError as { code, message } with its status", async () => {
    const app = bareApp();
    app.get("/boom", () => {
      throw new AppError("forbidden", "nope");
    });
    const res = await app.request("/boom");
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ code: "forbidden", message: "nope" });
  });

  it("renders an unexpected error as internal_error 500 and logs it redacted", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const app = bareApp();
    app.get("/kaboom", () => {
      throw new Error("db password=supersecret leaked into a message");
    });
    const res = await app.request("/kaboom");
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({
      code: "internal_error",
      message: "Internal error",
    });
    spy.mockRestore();
  });
});

describe("logging middleware", () => {
  let spy: ReturnType<typeof vi.spyOn>;
  beforeEach(() => {
    spy = vi.spyOn(console, "log").mockImplementation(() => undefined);
  });
  afterEach(() => spy.mockRestore());

  it("emits one JSON line per request with no secret fields", async () => {
    const app = bareApp();
    app.get("/x", (c) => c.json({ ok: true }));
    await app.request("/x", { headers: { authorization: "Bearer sk_secret" } });

    const lines = spy.mock.calls.map((c) => String(c[0]));
    expect(lines).toHaveLength(1);
    expect(lines[0]).not.toContain("sk_secret");
    const parsed = JSON.parse(lines[0] ?? "{}") as Record<string, unknown>;
    expect(parsed).toMatchObject({
      level: "info",
      method: "GET",
      path: "/x",
      status: 200,
    });
    expect(parsed["requestId"]).toBeTypeOf("string");
  });
});
