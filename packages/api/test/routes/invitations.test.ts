import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createSession } from "../../src/auth/session";
import { hashToken } from "../../src/auth/tokens";
import { seedDeployment } from "../../src/db/bootstrap";
import { newId } from "../../src/domain/id";
import type { NewUser } from "../../src/db/schema/types";
import { expectAuditDelta } from "../support/audit";
import { makeTestApp, type TestApp } from "../support/app";

function regularUser(over: Partial<NewUser> = {}): NewUser {
  return {
    id: newId(),
    email: `u-${Math.random().toString(36).slice(2)}@x.com`,
    emailVerifiedAt: null,
    displayName: "Regular",
    role: "user",
    status: "active",
    passwordHash: null,
    mustChangePassword: false,
    unitSystem: "imperial",
    currencyCode: "USD",
    timeZone: "America/New_York",
    deactivatedAt: null,
    ...over,
  };
}

describe("/admin/invitations + /invitations/accept", () => {
  let t: TestApp;
  let adminHeaders: Record<string, string>;

  beforeEach(async () => {
    t = makeTestApp();
    await seedDeployment(t.handle, {
      admin: { email: "root@x.com", password: "password12345" },
    });
    const admin = (await t.repos.users.findByEmail("root@x.com"))!;
    const { token } = await createSession(t.handle, admin.id, 3600);
    adminHeaders = {
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
    };
  });
  afterEach(() => t.cleanup());

  const createInvite = (body: unknown) =>
    t.app.request("/admin/invitations", {
      method: "POST",
      headers: adminHeaders,
      body: JSON.stringify(body),
    });

  const accept = (body: unknown) =>
    t.app.request("/invitations/accept", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });

  it("creates an invitation (201) and audits it", async () => {
    const res = await expectAuditDelta(
      t.handle,
      { action: "invitation.created" },
      () => createInvite({ email: "invitee@x.com", invitedRole: "user" }),
    );
    expect(res.status).toBe(201);
    const body = (await res.json()) as {
      invitation: { email: string; invitedRole: string };
      invitationToken: string;
    };
    expect(body.invitation.email).toBe("invitee@x.com");
    expect(body.invitation.invitedRole).toBe("user");

    const row = await t.repos.invitations.findByHash(
      hashToken(body.invitationToken),
    );
    expect(row?.email).toBe("invitee@x.com");
    expect(row?.acceptedAt).toBeNull();
  });

  it("rejects a non-admin caller (403)", async () => {
    const u = await t.repos.users.create(regularUser());
    const { token } = await createSession(t.handle, u.id, 3600);
    const res = await t.app.request("/admin/invitations", {
      method: "POST",
      headers: {
        authorization: `Bearer ${token}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({ email: "z@x.com" }),
    });
    expect(res.status).toBe(403);
  });

  it("rejects an email already registered (409)", async () => {
    const res = await createInvite({ email: "root@x.com" });
    expect(res.status).toBe(409);
  });

  it("accept creates the user with the invited role and consumes the link", async () => {
    const created = await createInvite({
      email: "alice@x.com",
      invitedRole: "admin",
    });
    const { invitationToken } = (await created.json()) as {
      invitationToken: string;
    };

    const res = await expectAuditDelta(
      t.handle,
      { action: "invitation.accepted" },
      () =>
        accept({
          token: invitationToken,
          displayName: "Alice",
          password: "password12345",
        }),
    );
    expect(res.status).toBe(201);
    const { user } = (await res.json()) as {
      user: { email: string; role: string; displayName: string };
    };
    expect(user.email).toBe("alice@x.com");
    expect(user.role).toBe("admin");
    expect(user.displayName).toBe("Alice");

    const stored = await t.repos.users.findByEmail("alice@x.com");
    expect(stored?.passwordHash).not.toBeNull();
    expect(stored?.emailVerifiedAt).toBeInstanceOf(Date);

    const invitationRow = await t.repos.invitations.findByHash(
      hashToken(invitationToken),
    );
    expect(invitationRow?.acceptedAt).toBeInstanceOf(Date);
    expect(invitationRow?.acceptedUserId).toBe(stored?.id);

    // The same link cannot be used twice.
    const again = await accept({
      token: invitationToken,
      displayName: "Alice Again",
      password: "password12345",
    });
    expect(again.status).toBe(409);
    const body = (await again.json()) as { code: string };
    expect(body.code).toBe("invitation_consumed");
  });

  it("rejects an unknown token (409 invitation_consumed)", async () => {
    const res = await accept({
      token: "not-a-real-token",
      displayName: "Nobody",
      password: "password12345",
    });
    expect(res.status).toBe(409);
    const body = (await res.json()) as { code: string };
    expect(body.code).toBe("invitation_consumed");
  });

  it("rejects an expired invitation (409 invitation_consumed)", async () => {
    const admin = (await t.repos.users.findByEmail("root@x.com"))!;
    await t.repos.invitations.issue({
      id: newId(),
      email: "late@x.com",
      tokenHash: hashToken("expired-token"),
      invitedRole: "user",
      createdBy: admin.id,
      expiresAt: new Date(Date.now() - 60_000),
    });

    const res = await accept({
      token: "expired-token",
      displayName: "Late",
      password: "password12345",
    });
    expect(res.status).toBe(409);
    const body = (await res.json()) as { code: string };
    expect(body.code).toBe("invitation_consumed");
  });

  it("re-inviting an email replaces the earlier pending invitation", async () => {
    const first = await createInvite({ email: "dupe@x.com" });
    const { invitationToken: firstToken } = (await first.json()) as {
      invitationToken: string;
    };
    await createInvite({ email: "dupe@x.com" });

    const res = await accept({
      token: firstToken,
      displayName: "Late Comer",
      password: "password12345",
    });
    expect(res.status).toBe(409);
  });
});
