import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { seedDeployment } from "../../src/db/bootstrap";
import { redact } from "../../src/log";
import { makeTestApp, type TestApp } from "../support/app";

describe("redact()", () => {
  it("replaces sensitive keys at any depth, keeps everything else", () => {
    const out = redact({
      requestId: "abc",
      user: { id: "u1", password: "hunter2", newPassword: "s3cret" },
      headers: { authorization: "Bearer cht_xxx", cookie: "chotu_session=chs_x" },
      list: [{ token: "cht_leak" }, { ok: 1 }],
    });
    const blob = JSON.stringify(out);

    expect(blob).toContain('"requestId":"abc"');
    expect(blob).toContain('"id":"u1"');
    expect(blob).toContain('"ok":1');
    expect(blob).not.toContain("hunter2");
    expect(blob).not.toContain("s3cret");
    expect(blob).not.toContain("cht_xxx");
    expect(blob).not.toContain("chs_x");
    expect(blob).not.toContain("cht_leak");
    expect((blob.match(/\[redacted\]/g) ?? []).length).toBe(5);
  });
});

describe("log scan — no secret or entry value reaches the logs (T11.4)", () => {
  let t: TestApp;
  let lines: string[];
  let logSpy: ReturnType<typeof vi.spyOn>;
  let errSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(async () => {
    t = makeTestApp();
    await seedDeployment(t.handle, {
      admin: { email: "root@x.com", password: "S3cretAdminPass!" },
    });
    lines = [];
    const capture = (...a: unknown[]) => {
      lines.push(a.map(String).join(" "));
    };
    logSpy = vi.spyOn(console, "log").mockImplementation(capture);
    errSpy = vi.spyOn(console, "error").mockImplementation(capture);
  });
  afterEach(() => {
    logSpy.mockRestore();
    errSpy.mockRestore();
    return t.cleanup();
  });

  it("a batch of secret-bearing operations logs nothing sensitive", async () => {
    const json = { "content-type": "application/json" };

    // Sign in (password in the body, token + cookie in the response).
    const si = await t.app.request("/auth/sign-in", {
      method: "POST",
      headers: json,
      body: JSON.stringify({
        email: "root@x.com",
        password: "S3cretAdminPass!",
      }),
    });
    const { session } = (await si.json()) as { session: string };
    const auth = { authorization: `Bearer ${session}`, ...json };

    // Create an API token (plaintext in the response).
    const tokRes = await t.app.request("/tokens", {
      method: "POST",
      headers: auth,
      body: JSON.stringify({ label: "scan" }),
    });
    const { token: apiToken } = (await tokRes.json()) as { token: string };

    // A fuel entry with distinctive values.
    const v = await t.app.request("/vehicles", {
      method: "POST",
      headers: auth,
      body: JSON.stringify({ name: "Scan Car", initialOdometer: 0 }),
    });
    const vid = ((await v.json()) as { vehicle: { id: string } }).vehicle.id;
    await t.app.request(`/vehicles/${vid}/entries`, {
      method: "POST",
      headers: auth,
      body: JSON.stringify({
        entryDate: "2026-01-05",
        odometer: 987654,
        volume: 13579,
        totalCost: 24680,
      }),
    });

    // A reset request (returns a token when email is unconfigured).
    const rr = await t.app.request("/auth/reset-request", {
      method: "POST",
      headers: json,
      body: JSON.stringify({ email: "root@x.com" }),
    });
    const { resetToken } = (await rr.json()) as { resetToken?: string };

    // An error path (unhandled -> onError logs).
    await t.app.request("/vehicles/not-a-real-id");

    const blob = lines.join("\n");
    // Something was logged (the request lines).
    expect(lines.length).toBeGreaterThan(0);
    // No secrets or entry field values.
    for (const secret of [
      "S3cretAdminPass!",
      session,
      apiToken,
      resetToken ?? "no-reset-token-was-issued",
      "987654",
      "13579",
      "24680",
      "$argon2",
    ]) {
      expect(blob, `logs must not contain ${secret.slice(0, 12)}…`).not.toContain(
        secret,
      );
    }
  });
});
