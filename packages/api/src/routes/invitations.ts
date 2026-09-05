import { Hono } from "hono";
import { z } from "zod";

import { hashPassword } from "../auth/password";
import { hashToken } from "../auth/tokens";
import {
  consumeInvitationInTx,
  insertUserInTx,
  writeAuditInTx,
} from "../db/repositories";
import { makeUnitOfWork, runTxSteps } from "../db/uow";
import { err } from "../domain/errors";
import { newId } from "../domain/id";
import type { AppDeps, AppHono } from "../http/context";
import { parseJson } from "../http/validate";
import type { UserRow } from "../db/schema/types";

export const InvitationAcceptBody = z.object({
  token: z.string().min(1),
  displayName: z.string().trim().min(1).max(100),
  // Every M1 invitation resolves to a password account; OIDC-only
  // deployments are out of scope until slice 7 (FR-3.3, FR-9.2).
  password: z.string().min(8),
});

function publicUser(u: UserRow) {
  return {
    id: u.id,
    email: u.email,
    displayName: u.displayName,
    role: u.role,
    mustChangePassword: u.mustChangePassword,
  };
}

/** Public invitation-accept endpoint (FR-3.3, FR-3.4). No auth required. */
export function invitationRoutes(deps: AppDeps): Hono<AppHono> {
  const r = new Hono<AppHono>();
  const uow = makeUnitOfWork(deps.handle);

  // POST /invitations/accept — set a display name and password, consume.
  r.post("/accept", async (c) => {
    const body = await parseJson(c, InvitationAcceptBody);
    const now = new Date();

    const invitation = await deps.repos.invitations.findByHash(
      hashToken(body.token),
    );
    // FR-3.4: expired, unknown, or already-accepted all share one code so a
    // caller cannot distinguish "no such invitation" from "already used".
    if (
      invitation == null ||
      invitation.acceptedAt != null ||
      invitation.expiresAt.getTime() <= now.getTime()
    ) {
      throw err.invitationConsumed();
    }
    if ((await deps.repos.users.findByEmail(invitation.email)) != null) {
      throw err.emailTaken();
    }

    const settings = await deps.repos.settings.get();
    const row: UserRow = {
      id: newId(),
      email: invitation.email,
      // Accepting a personal invite link is evidence of email control.
      emailVerifiedAt: now,
      displayName: body.displayName,
      role: invitation.invitedRole,
      status: "active",
      passwordHash: await hashPassword(body.password),
      mustChangePassword: false,
      unitSystem: settings?.defaultUnitSystem ?? "imperial",
      currencyCode: settings?.defaultCurrencyCode ?? "USD",
      timeZone: settings?.defaultTimeZone ?? "America/New_York",
      createdAt: now,
      updatedAt: now,
      deactivatedAt: null,
    };

    await runTxSteps(uow, {}, [
      (tx) => insertUserInTx(tx, row),
      (tx) => consumeInvitationInTx(tx, invitation.id, row.id, now),
      (tx) =>
        writeAuditInTx(tx, {
          actorUserId: invitation.createdBy,
          ip: null,
          action: "invitation.accepted",
          targetType: "user",
          targetId: row.id,
          summary: `An invitation was accepted, creating a ${invitation.invitedRole}`,
          metadata: null,
        }),
    ]);

    return c.json({ user: publicUser(row) }, 201);
  });

  return r;
}
