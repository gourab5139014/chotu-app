import { randomUUID } from "node:crypto";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createSession } from "../../src/auth/session";
import { seedDeployment } from "../../src/db/bootstrap";
import { makeTestApp, type TestApp } from "../support/app";

describe("/tokens routes", () => {
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
    headers = { authorization: `Bearer ${token}`, "content-type": "application/json" };
  });
  afterEach(() => t.cleanup());

  it("requires auth", async () => {
    expect((await t.app.request("/tokens")).status).toBe(401);
  });

  it("create returns the plaintext once (201), then list shows it without the value", async () => {
    const created = await t.app.request("/tokens", {
      method: "POST",
      headers,
      body: JSON.stringify({ label: "ci" }),
    });
    expect(created.status).toBe(201);
    const { token } = (await created.json()) as { token: string };
    expect(token.startsWith("cht_")).toBe(true);

    const list = await t.app.request("/tokens", { headers });
    const { tokens } = (await list.json()) as {
      tokens: Array<{ id: string; label: string | null; revokedAt: string | null }>;
    };
    // seed made a "bootstrap" token; plus this "ci" one
    const ci = tokens.find((x) => x.label === "ci");
    expect(ci).toBeDefined();
    expect(JSON.stringify(tokens)).not.toContain(token);
  });

  it("several tokens can be active at once (Q-8 = A)", async () => {
    for (const label of ["one", "two", "three"]) {
      await t.app.request("/tokens", {
        method: "POST",
        headers,
        body: JSON.stringify({ label }),
      });
    }
    const { tokens } = (await (await t.app.request("/tokens", { headers })).json()) as {
      tokens: Array<{ revokedAt: string | null }>;
    };
    expect(tokens.filter((x) => x.revokedAt == null).length).toBeGreaterThanOrEqual(4);
  });

  it("delete revokes own token (204); another id -> 404", async () => {
    const { token: _t } = (await (
      await t.app.request("/tokens", {
        method: "POST",
        headers,
        body: JSON.stringify({ label: "gone" }),
      })
    ).json()) as { token: string };
    const { tokens } = (await (await t.app.request("/tokens", { headers })).json()) as {
      tokens: Array<{ id: string; label: string | null }>;
    };
    const id = tokens.find((x) => x.label === "gone")!.id;

    expect(
      (await t.app.request(`/tokens/${id}`, { method: "DELETE", headers })).status,
    ).toBe(204);
    const after = (await (await t.app.request("/tokens", { headers })).json()) as {
      tokens: Array<{ id: string; revokedAt: string | null }>;
    };
    expect(after.tokens.find((x) => x.id === id)?.revokedAt).toBeTypeOf("string");

    expect(
      (
        await t.app.request(`/tokens/${randomUUID()}`, {
          method: "DELETE",
          headers,
        })
      ).status,
    ).toBe(404);
    void userId;
  });
});
