import { sql } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { issueApiToken } from "../../src/auth/api-tokens";
import { createSession } from "../../src/auth/session";
import { hashToken, SESSION_COOKIE } from "../../src/auth/tokens";
import { seedDeployment } from "../../src/db/bootstrap";
import { sqlRun } from "../../src/db/index";
import { makeTestApp, type TestApp } from "../support/app";

describe("auth middleware (via GET /auth/me)", () => {
  let t: TestApp;
  let adminId: string;

  beforeEach(async () => {
    t = makeTestApp();
    await seedDeployment(t.handle, {
      admin: { email: "a@x.com", password: "password12345" },
    });
    adminId = (await t.repos.users.findByEmail("a@x.com"))!.id;
  });
  afterEach(() => t.cleanup());

  const me = (headers: Record<string, string>) =>
    t.app.request("/auth/me", { headers });

  it("no credential -> 401", async () => {
    expect((await me({})).status).toBe(401);
  });

  it("valid session cookie -> 200 with the user", async () => {
    const { token } = await createSession(t.handle, adminId, 3600);
    const res = await me({ cookie: `${SESSION_COOKIE}=${token}` });
    expect(res.status).toBe(200);
    expect(((await res.json()) as { user: { email: string } }).user.email).toBe(
      "a@x.com",
    );
  });

  it("valid session as a bearer value -> 200 (headless, Q-11)", async () => {
    const { token } = await createSession(t.handle, adminId, 3600);
    expect((await me({ authorization: `Bearer ${token}` })).status).toBe(200);
  });

  it("valid API token -> 200 and touches last_used_at", async () => {
    const { token } = await issueApiToken(t.handle, { userEmail: "a@x.com" });
    expect((await me({ authorization: `Bearer ${token}` })).status).toBe(200);
    await new Promise((r) => setTimeout(r, 20));
    const row = await t.repos.apiTokens.findByHash(hashToken(token));
    expect(row?.lastUsedAt).toBeInstanceOf(Date);
  });

  it("expired session -> 401", async () => {
    const { token } = await createSession(t.handle, adminId, -1);
    expect((await me({ cookie: `${SESSION_COOKIE}=${token}` })).status).toBe(401);
  });

  it("revoked API token -> 401", async () => {
    const { token } = await issueApiToken(t.handle, { userEmail: "a@x.com" });
    const row = await t.repos.apiTokens.findByHash(hashToken(token));
    await t.repos.apiTokens.revoke(row!.id, new Date());
    expect((await me({ authorization: `Bearer ${token}` })).status).toBe(401);
  });

  it("deactivated user -> 401 (FR-2.5)", async () => {
    const { token } = await createSession(t.handle, adminId, 3600);
    await sqlRun(
      t.handle,
      sql`update "user" set status = 'deactivated' where id = ${adminId}`,
    );
    expect((await me({ cookie: `${SESSION_COOKIE}=${token}` })).status).toBe(401);
  });
});
