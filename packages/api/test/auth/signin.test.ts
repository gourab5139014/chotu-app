import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { seedDeployment } from "../../src/db/bootstrap";
import { resolveSession } from "../../src/auth/session";
import { SESSION_COOKIE } from "../../src/auth/tokens";
import { makeTestApp, type TestApp } from "../support/app";

describe("POST /auth/sign-in", () => {
  let t: TestApp;

  beforeEach(async () => {
    t = makeTestApp();
    await seedDeployment(t.handle, {
      admin: { email: "admin@x.com", password: "correct horse battery" },
    });
  });
  afterEach(() => t.cleanup());

  async function post(body: unknown) {
    return t.app.request("/auth/sign-in", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
  }

  it("returns a session credential and sets an HttpOnly cookie", async () => {
    const res = await post({ email: "admin@x.com", password: "correct horse battery" });
    expect(res.status).toBe(200);

    const json = (await res.json()) as {
      session: string;
      user: { role: string; email: string };
      expiresAt: string;
    };
    expect(json.session.startsWith("chs_")).toBe(true);
    expect(json.user).toMatchObject({ email: "admin@x.com", role: "admin" });

    const setCookie = res.headers.get("set-cookie") ?? "";
    expect(setCookie).toContain(`${SESSION_COOKIE}=chs_`);
    expect(setCookie.toLowerCase()).toContain("httponly");

    // The credential resolves to the user.
    const resolved = await resolveSession(t.handle, json.session);
    expect(resolved?.user.email).toBe("admin@x.com");
  });

  it("wrong password and unknown email give the same generic 401", async () => {
    const bad = await post({ email: "admin@x.com", password: "nope" });
    const ghost = await post({ email: "ghost@x.com", password: "whatever12" });
    const badBody = await bad.json();
    const ghostBody = await ghost.json();

    expect(bad.status).toBe(401);
    expect(ghost.status).toBe(401);
    expect(badBody).toEqual(ghostBody);
    expect(badBody).toEqual({
      code: "unauthorized",
      message: "Wrong email or password.",
    });
  });

  it("rejects a malformed body with validation_error", async () => {
    const res = await post({ email: "not-an-email" });
    expect(res.status).toBe(400);
    expect(((await res.json()) as { code: string }).code).toBe(
      "validation_error",
    );
  });
});
