import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { makeTestApp, type TestApp } from "./support/app";

describe("app skeleton", () => {
  let t: TestApp;
  beforeEach(() => {
    t = makeTestApp();
  });
  afterEach(() => t.cleanup());

  it("serves GET /healthz with the schema version", async () => {
    const res = await t.app.request("/healthz");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: "ok", schemaVersion: 1 });
  });

  it("unknown path returns the standard 404 body", async () => {
    const res = await t.app.request("/nope");
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ code: "not_found", message: "Not found" });
  });

  it("echoes an inbound x-request-id", async () => {
    const res = await t.app.request("/healthz", {
      headers: { "x-request-id": "abc-123" },
    });
    expect(res.headers.get("x-request-id")).toBe("abc-123");
  });

  it("generates an x-request-id when none is sent", async () => {
    const res = await t.app.request("/healthz");
    expect(res.headers.get("x-request-id")).toMatch(/^[0-9a-f-]{36}$/);
  });
});
