import { describe, expect, it } from "vitest";

import { buildApp } from "../src/app.js";

describe("app", () => {
  it("serves GET /healthz", async () => {
    const app = buildApp();
    const res = await app.request("/healthz");

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: "ok" });
  });

  it("404s an unknown path", async () => {
    const res = await buildApp().request("/nope");
    expect(res.status).toBe(404);
  });
});
