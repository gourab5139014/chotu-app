import { Hono } from "hono";

import { err } from "../domain/errors";
import type { AppDeps, AppHono } from "../http/context";
import { protectAdmin } from "../middleware/admin";
import type { UserRow } from "../db/schema/types";

/**
 * Admin read surface (FR-8.1, FR-8.2). Accounts, roles, status, and security
 * metadata only. An admin never sees a user's vehicles or fuel entries here —
 * data-model INV-9. No fuel-entry field appears in any response on this router.
 */
function userListItem(u: UserRow) {
  return {
    id: u.id,
    email: u.email,
    displayName: u.displayName,
    role: u.role,
    status: u.status,
    createdAt: u.createdAt.toISOString(),
    // Real count lands with the vehicle table (slice 8, T8.1).
    vehicleCount: 0,
  };
}

export function adminRoutes(deps: AppDeps): Hono<AppHono> {
  const r = new Hono<AppHono>();
  r.use("*", ...protectAdmin(deps));

  // GET /admin/users — every account, newest first.
  r.get("/users", async (c) => {
    const users = await deps.repos.users.list();
    users.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
    return c.json({ users: users.map(userListItem) });
  });

  // GET /admin/users/:id — one account plus last sign-in, linked identities,
  // and active API-token count.
  r.get("/users/:id", async (c) => {
    const u = await deps.repos.users.findById(c.req.param("id"));
    if (u == null) throw err.notFound("User not found");

    const [lastSeenAt, tokens] = await Promise.all([
      deps.repos.sessions.latestActivityForUser(u.id),
      deps.repos.apiTokens.listForUser(u.id),
    ]);
    const now = Date.now();
    const activeTokenCount = tokens.filter(
      (t) =>
        t.revokedAt == null &&
        (t.expiresAt == null || t.expiresAt.getTime() > now),
    ).length;

    return c.json({
      user: {
        ...userListItem(u),
        lastSignInAt: lastSeenAt?.toISOString() ?? null,
        // The identity table lands in slice 7 (T7.1); shape is stable.
        linkedIdentities: [] as string[],
        activeTokenCount,
      },
    });
  });

  return r;
}
