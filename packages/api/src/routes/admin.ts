import { Hono } from "hono";
import type { Context } from "hono";
import { z } from "zod";

import { hashPassword } from "../auth/password";
import { generateLinkToken, hashToken } from "../auth/tokens";
import {
  deleteUserInTx,
  guardLastAdminInTx,
  insertUserInTx,
  issueInvitationInTx,
  issueUserTokenInTx,
  revokeUserApiTokensInTx,
  revokeUserSessionsInTx,
  updateSettingsInTx,
  updateUserInTx,
  writeAuditInTx,
} from "../db/repositories";
import { makeUnitOfWork, runTxSteps } from "../db/uow";
import { err } from "../domain/errors";
import { isValidTimeZone } from "../domain/time-zone";
import { newId } from "../domain/id";
import type { AppDeps, AppHono } from "../http/context";
import { parseJson } from "../http/validate";
import { protectAdmin } from "../middleware/admin";
import { clientIp } from "../middleware/rate-limit";
import type { Tx } from "../db/uow";
import type {
  DeploymentSettingsRow,
  InvitationRow,
  UserRow,
} from "../db/schema/types";

type TxStep = (tx: Tx) => unknown;

const LINK_TTL_MS = 1000 * 60 * 60 * 24;
const INVITATION_TTL_SECONDS = 60 * 60 * 24 * 7;
const MAX_INVITATION_TTL_SECONDS = 60 * 60 * 24 * 30;

/**
 * Admin read + mutation surface (FR-8). Accounts, roles, status, and security
 * metadata only. An admin never sees a user's vehicles or fuel entries here —
 * data-model INV-9. Every mutation writes one `audit_log` row in the same
 * transaction (AC-9). Any change that would drop the last active admin is
 * refused with `last_admin` under a `deployment_settings` lock (INV-6).
 */
function userListItem(u: UserRow, vehicleCount = 0) {
  return {
    id: u.id,
    email: u.email,
    displayName: u.displayName,
    role: u.role,
    status: u.status,
    createdAt: u.createdAt.toISOString(),
    vehicleCount,
  };
}

export const AdminCreateUserBody = z.object({
  email: z.string().email(),
  displayName: z.string().trim().min(1).max(100),
  role: z.enum(["user", "admin"]).default("user"),
  // Omit to issue a one-time set-password link instead.
  password: z.string().min(8).optional(),
});

export const AdminDeleteUserBody = z.object({
  // Must equal the target's email — an explicit confirmation (FR-8.6).
  confirmEmail: z.string().email(),
});

export const AdminCreateInvitationBody = z.object({
  email: z.string().email(),
  invitedRole: z.enum(["user", "admin"]).default("user"),
  expiresInSeconds: z
    .number()
    .int()
    .min(1)
    .max(MAX_INVITATION_TTL_SECONDS)
    .optional(),
});

// FR-9.1: deployment_settings, minus default_currency_code (fixed USD in M1).
export const AdminUpdateSettingsBody = z
  .object({
    deploymentName: z.string().trim().min(1).max(200),
    registrationPolicy: z.enum(["invite_only", "open", "sso_auto"]),
    allowedAuthMethods: z.array(z.enum(["password", "oidc"])).min(1),
    defaultUnitSystem: z.enum(["imperial", "metric"]),
    defaultTimeZone: z
      .string()
      .trim()
      .min(1)
      .refine(isValidTimeZone, { message: "Unknown IANA time zone" }),
    fuelVolumePrecision: z.number().int().min(1).max(3),
    sessionTtlSeconds: z.number().int().min(60),
    apiTokenTtlSeconds: z.number().int().min(60).nullable(),
  })
  .partial()
  .refine((b) => Object.keys(b).length > 0, {
    message: "Provide at least one field to change",
  });

function publicSettings(s: DeploymentSettingsRow) {
  return {
    deploymentName: s.deploymentName,
    registrationPolicy: s.registrationPolicy,
    allowedAuthMethods: s.allowedAuthMethods,
    defaultUnitSystem: s.defaultUnitSystem,
    defaultCurrencyCode: s.defaultCurrencyCode,
    defaultTimeZone: s.defaultTimeZone,
    fuelVolumePrecision: s.fuelVolumePrecision,
    sessionTtlSeconds: s.sessionTtlSeconds,
    apiTokenTtlSeconds: s.apiTokenTtlSeconds,
  };
}

export function adminRoutes(deps: AppDeps): Hono<AppHono> {
  const r = new Hono<AppHono>();
  r.use("*", ...protectAdmin(deps));

  const uow = makeUnitOfWork(deps.handle);
  const settings = deps.repos.settings;

  const auditActor = (c: Context<AppHono>, actorId: string) => ({
    actorUserId: actorId,
    ip: clientIp(c, deps.env.TRUSTED_PROXY),
  });

  // POST /admin/invitations — a single-use link (FR-3.2).
  r.post("/invitations", async (c) => {
    const actor = c.get("user")!;
    const body = await parseJson(c, AdminCreateInvitationBody);
    const email = body.email.toLowerCase();

    if ((await deps.repos.users.findByEmail(email)) != null) {
      throw err.emailTaken();
    }

    const link = generateLinkToken();
    const now = new Date();
    const row: InvitationRow = {
      id: newId(),
      email,
      tokenHash: hashToken(link),
      invitedRole: body.invitedRole,
      createdBy: actor.id,
      expiresAt: new Date(
        now.getTime() +
          (body.expiresInSeconds ?? INVITATION_TTL_SECONDS) * 1000,
      ),
      acceptedAt: null,
      acceptedUserId: null,
      createdAt: now,
    };

    await runTxSteps(uow, {}, [
      (tx) => issueInvitationInTx(tx, row),
      (tx) =>
        writeAuditInTx(tx, {
          ...auditActor(c, actor.id),
          action: "invitation.created",
          targetType: "invitation",
          targetId: row.id,
          summary: `Invited ${email} as ${body.invitedRole}`,
          metadata: { invitedRole: body.invitedRole },
        }),
    ]);

    return c.json(
      {
        invitation: {
          id: row.id,
          email,
          invitedRole: body.invitedRole,
          expiresAt: row.expiresAt.toISOString(),
        },
        invitationToken: link,
        note: "shown once",
      },
      201,
    );
  });

  // GET /admin/settings (FR-9.1).
  r.get("/settings", async (c) => {
    const current = await settings.get();
    if (current == null) throw err.notFound("Settings not found");
    return c.json({ settings: publicSettings(current) });
  });

  // PATCH /admin/settings (FR-9.1). FR-9.2: allowedAuthMethods must stay
  // non-empty, and dropping "password" is refused while any user could be
  // stranded by it.
  r.patch("/settings", async (c) => {
    const actor = c.get("user")!;
    const body = await parseJson(c, AdminUpdateSettingsBody);
    const current = await settings.get();
    if (current == null) throw err.notFound("Settings not found");

    const nextMethods = body.allowedAuthMethods ?? current.allowedAuthMethods;
    if (!nextMethods.includes("password")) {
      // The identity table lands in slice 7 (T7.1); until then no user can
      // have a linked OIDC identity, so removing password would strand every
      // account that has one. Re-check against real identities once that
      // table exists.
      const anyUsers = (await deps.repos.users.list()).length > 0;
      if (anyUsers) throw err.authMethodRequired();
    }

    // exactOptionalPropertyTypes: copy only the fields the caller sent.
    const patch: Partial<Omit<DeploymentSettingsRow, "id" | "createdAt">> = {};
    if (body.deploymentName !== undefined) patch.deploymentName = body.deploymentName;
    if (body.registrationPolicy !== undefined) {
      patch.registrationPolicy = body.registrationPolicy;
    }
    if (body.allowedAuthMethods !== undefined) {
      patch.allowedAuthMethods = body.allowedAuthMethods;
    }
    if (body.defaultUnitSystem !== undefined) {
      patch.defaultUnitSystem = body.defaultUnitSystem;
    }
    if (body.defaultTimeZone !== undefined) patch.defaultTimeZone = body.defaultTimeZone;
    if (body.fuelVolumePrecision !== undefined) {
      patch.fuelVolumePrecision = body.fuelVolumePrecision;
    }
    if (body.sessionTtlSeconds !== undefined) {
      patch.sessionTtlSeconds = body.sessionTtlSeconds;
    }
    if (body.apiTokenTtlSeconds !== undefined) {
      patch.apiTokenTtlSeconds = body.apiTokenTtlSeconds;
    }

    await runTxSteps(uow, {}, [
      (tx) => updateSettingsInTx(tx, patch),
      (tx) =>
        writeAuditInTx(tx, {
          ...auditActor(c, actor.id),
          action: "settings.updated",
          targetType: "deployment_settings",
          targetId: "singleton",
          summary: "Updated deployment settings",
          metadata: { fields: Object.keys(patch) },
        }),
    ]);

    const updated = await settings.get();
    return c.json({ settings: publicSettings(updated!) });
  });

  // GET /admin/users — every account, newest first.
  r.get("/users", async (c) => {
    const users = await deps.repos.users.list();
    users.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
    const counts = await Promise.all(
      users.map((u) => deps.repos.vehicles.countForUser(u.id)),
    );
    return c.json({
      users: users.map((u, i) => userListItem(u, counts[i])),
    });
  });

  // GET /admin/users/:id — one account plus last sign-in, linked identities,
  // and active API-token count.
  r.get("/users/:id", async (c) => {
    const u = await deps.repos.users.findById(c.req.param("id"));
    if (u == null) throw err.notFound("User not found");

    const [lastSeenAt, tokens, identities, vehicleCount] = await Promise.all([
      deps.repos.sessions.latestActivityForUser(u.id),
      deps.repos.apiTokens.listForUser(u.id),
      deps.repos.identities.listForUser(u.id),
      deps.repos.vehicles.countForUser(u.id),
    ]);
    const now = Date.now();
    const activeTokenCount = tokens.filter(
      (t) =>
        t.revokedAt == null &&
        (t.expiresAt == null || t.expiresAt.getTime() > now),
    ).length;

    return c.json({
      user: {
        ...userListItem(u, vehicleCount),
        lastSignInAt: lastSeenAt?.toISOString() ?? null,
        linkedIdentities: identities.map((i) => i.providerKey),
        activeTokenCount,
      },
    });
  });

  // POST /admin/users — create an account directly (FR-8.3).
  r.post("/users", async (c) => {
    const actor = c.get("user")!;
    const body = await parseJson(c, AdminCreateUserBody);

    if ((await deps.repos.users.findByEmail(body.email)) != null) {
      throw err.emailTaken();
    }

    const defaults = await settings.get();
    const now = new Date();
    const passwordHash =
      body.password != null ? await hashPassword(body.password) : null;

    const row: UserRow = {
      id: newId(),
      email: body.email,
      // An admin vouches for this email directly (FR-3.5 gates
      // self-registration only, not admin-created accounts).
      emailVerifiedAt: now,
      displayName: body.displayName,
      role: body.role,
      status: "active",
      passwordHash,
      mustChangePassword: false,
      unitSystem: defaults?.defaultUnitSystem ?? "imperial",
      currencyCode: defaults?.defaultCurrencyCode ?? "USD",
      timeZone: defaults?.defaultTimeZone ?? "America/New_York",
      createdAt: now,
      updatedAt: now,
      deactivatedAt: null,
    };

    let setPasswordToken: string | undefined;
    const steps: TxStep[] = [(tx) => insertUserInTx(tx, row)];
    if (passwordHash == null) {
      const link = generateLinkToken();
      setPasswordToken = link;
      steps.push((tx) =>
        issueUserTokenInTx(tx, {
          id: newId(),
          userId: row.id,
          purpose: "set_password",
          tokenHash: hashToken(link),
          expiresAt: new Date(Date.now() + LINK_TTL_MS),
          usedAt: null,
          createdAt: now,
        }),
      );
    }
    steps.push((tx) =>
      writeAuditInTx(tx, {
        ...auditActor(c, actor.id),
        action: "user.created",
        targetType: "user",
        targetId: row.id,
        summary: `Created ${body.role} ${body.email}`,
        metadata: { role: body.role, viaLink: passwordHash == null },
      }),
    );

    await runTxSteps(uow, {}, steps);

    return c.json(
      {
        user: userListItem(row),
        ...(setPasswordToken != null
          ? { setPasswordToken, note: "deliver this link; it is shown once" }
          : {}),
      },
      201,
    );
  });

  // Shared loader for the :id mutation routes.
  const loadTarget = async (id: string): Promise<UserRow> => {
    const u = await deps.repos.users.findById(id);
    if (u == null) throw err.notFound("User not found");
    return u;
  };

  // POST /admin/users/:id/deactivate (FR-8.4) — cut sessions and tokens now.
  r.post("/users/:id/deactivate", async (c) => {
    const actor = c.get("user")!;
    const target = await loadTarget(c.req.param("id"));
    if (target.status === "deactivated") return c.body(null, 204);
    const now = new Date();

    await runTxSteps(uow, { settings: true }, [
      (tx) => guardLastAdminInTx(tx, target),
      (tx) =>
        updateUserInTx(tx, target.id, {
          status: "deactivated",
          deactivatedAt: now,
        }),
      (tx) => revokeUserSessionsInTx(tx, target.id, now),
      (tx) => revokeUserApiTokensInTx(tx, target.id, now),
      (tx) =>
        writeAuditInTx(tx, {
          ...auditActor(c, actor.id),
          action: "user.deactivated",
          targetType: "user",
          targetId: target.id,
          summary: `Deactivated ${target.email}`,
          metadata: null,
        }),
    ]);

    return c.body(null, 204);
  });

  // POST /admin/users/:id/reactivate (FR-8.4).
  r.post("/users/:id/reactivate", async (c) => {
    const actor = c.get("user")!;
    const target = await loadTarget(c.req.param("id"));
    if (target.status === "active") return c.body(null, 204);

    await runTxSteps(uow, {}, [
      (tx) =>
        updateUserInTx(tx, target.id, {
          status: "active",
          deactivatedAt: null,
        }),
      (tx) =>
        writeAuditInTx(tx, {
          ...auditActor(c, actor.id),
          action: "user.reactivated",
          targetType: "user",
          targetId: target.id,
          summary: `Reactivated ${target.email}`,
          metadata: null,
        }),
    ]);

    return c.body(null, 204);
  });

  // POST /admin/users/:id/reset (FR-8.5, FR-4.4) — issue a password-reset link.
  r.post("/users/:id/reset", async (c) => {
    const actor = c.get("user")!;
    const target = await loadTarget(c.req.param("id"));
    const link = generateLinkToken();
    const now = new Date();

    await runTxSteps(uow, {}, [
      (tx) =>
        issueUserTokenInTx(tx, {
          id: newId(),
          userId: target.id,
          purpose: "reset",
          tokenHash: hashToken(link),
          expiresAt: new Date(Date.now() + LINK_TTL_MS),
          usedAt: null,
          createdAt: now,
        }),
      (tx) =>
        writeAuditInTx(tx, {
          ...auditActor(c, actor.id),
          action: "user.reset_triggered",
          targetType: "user",
          targetId: target.id,
          summary: `Triggered a password reset for ${target.email}`,
          metadata: null,
        }),
    ]);

    const emailConfigured = deps.env.EMAIL_SMTP_URL != null;
    return c.json(
      emailConfigured
        ? { sent: true }
        : { sent: false, resetToken: link, note: "email is not configured" },
    );
  });

  // POST /admin/users/:id/grant-admin (FR-8.7).
  r.post("/users/:id/grant-admin", async (c) => {
    const actor = c.get("user")!;
    const target = await loadTarget(c.req.param("id"));
    if (target.role === "admin") return c.body(null, 204);

    await runTxSteps(uow, {}, [
      (tx) => updateUserInTx(tx, target.id, { role: "admin" }),
      (tx) =>
        writeAuditInTx(tx, {
          ...auditActor(c, actor.id),
          action: "role.granted",
          targetType: "user",
          targetId: target.id,
          summary: `Granted admin to ${target.email}`,
          metadata: null,
        }),
    ]);

    return c.body(null, 204);
  });

  // POST /admin/users/:id/revoke-admin (FR-8.7) — INV-6 applies.
  r.post("/users/:id/revoke-admin", async (c) => {
    const actor = c.get("user")!;
    const target = await loadTarget(c.req.param("id"));
    if (target.role === "user") return c.body(null, 204);

    await runTxSteps(uow, { settings: true }, [
      (tx) => guardLastAdminInTx(tx, target),
      (tx) => updateUserInTx(tx, target.id, { role: "user" }),
      (tx) =>
        writeAuditInTx(tx, {
          ...auditActor(c, actor.id),
          action: "role.revoked",
          targetType: "user",
          targetId: target.id,
          summary: `Revoked admin from ${target.email}`,
          metadata: null,
        }),
    ]);

    return c.body(null, 204);
  });

  // DELETE /admin/users/:id (FR-8.6) — explicit confirm, cascade, INV-6.
  r.delete("/users/:id", async (c) => {
    const actor = c.get("user")!;
    const target = await loadTarget(c.req.param("id"));
    const body = await parseJson(c, AdminDeleteUserBody);
    if (body.confirmEmail.toLowerCase() !== target.email.toLowerCase()) {
      throw err.validation("confirmEmail does not match the target user");
    }

    await runTxSteps(uow, { settings: true }, [
      (tx) => guardLastAdminInTx(tx, target),
      (tx) => deleteUserInTx(tx, target.id),
      (tx) =>
        writeAuditInTx(tx, {
          actorUserId: actor.id === target.id ? null : actor.id,
          ip: clientIp(c, deps.env.TRUSTED_PROXY),
          action: "user.deleted",
          targetType: "user",
          targetId: target.id,
          summary: "An admin deleted a user account",
          metadata: null,
        }),
    ]);

    return c.body(null, 204);
  });

  return r;
}
