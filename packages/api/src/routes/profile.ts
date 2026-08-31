import { Hono } from "hono";
import { deleteCookie } from "hono/cookie";
import { z } from "zod";

import { SESSION_COOKIE } from "../auth/tokens";
import {
  countActiveAdminsInTx,
  deleteUserInTx,
  writeAuditInTx,
} from "../db/repositories";
import { makeUnitOfWork } from "../db/uow";
import { err } from "../domain/errors";
import type { AppDeps, AppHono } from "../http/context";
import { parseJson } from "../http/validate";
import { protect } from "../middleware/protect";
import type { UserRow } from "../db/schema/types";

/** True when `tz` is an IANA zone the runtime accepts. */
function isValidTimeZone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

export const ProfileUpdateBody = z
  .object({
    displayName: z.string().trim().min(1).max(100),
    unitSystem: z.enum(["imperial", "metric"]),
    timeZone: z
      .string()
      .trim()
      .min(1)
      .refine(isValidTimeZone, { message: "Unknown IANA time zone" }),
  })
  .partial()
  .refine((b) => Object.keys(b).length > 0, {
    message: "Provide at least one field to change",
  });

function publicProfile(u: UserRow) {
  return {
    id: u.id,
    email: u.email,
    displayName: u.displayName,
    role: u.role,
    unitSystem: u.unitSystem,
    timeZone: u.timeZone,
    currencyCode: u.currencyCode,
    mustChangePassword: u.mustChangePassword,
  };
}

/**
 * The caller's own profile (FR-7.1, FR-7.2). `currency_code` is read-only USD
 * in M1. A unit-system change never rewrites stored data — canonical values do
 * not move, only the display preference.
 */
export function profileRoutes(deps: AppDeps): Hono<AppHono> {
  const r = new Hono<AppHono>();
  r.use("*", ...protect(deps));

  r.get("/", (c) => {
    const user = c.get("user");
    if (user == null) throw err.unauthorized();
    return c.json({ profile: publicProfile(user) });
  });

  r.patch("/", async (c) => {
    const user = c.get("user");
    if (user == null) throw err.unauthorized();
    const body = await parseJson(c, ProfileUpdateBody);

    const patch: Partial<Pick<UserRow, "displayName" | "unitSystem" | "timeZone">> =
      {};
    if (body.displayName !== undefined) patch.displayName = body.displayName;
    if (body.unitSystem !== undefined) patch.unitSystem = body.unitSystem;
    if (body.timeZone !== undefined) patch.timeZone = body.timeZone;

    const updated = await deps.repos.users.update(user.id, patch);
    return c.json({ profile: publicProfile(updated) });
  });

  // DELETE /profile — delete the caller's own account (FR-7.3, FR-7.4).
  // FK cascades remove the user's tokens and sessions. Vehicles, entries, and
  // identities cascade the same way once those tables land (slices 7-9).
  r.delete("/", async (c) => {
    const user = c.get("user");
    if (user == null) throw err.unauthorized();

    const isAdmin = user.role === "admin";
    const uow = makeUnitOfWork(deps.handle);

    const auditEntry = {
      actorUserId: null,
      action: "user.self_deleted",
      targetType: "user",
      targetId: user.id,
      summary: "A user deleted their own account",
      metadata: null,
      ip: null,
    } as const;

    await uow.run({ settings: isAdmin }, (tx) => {
      if (tx.dialect === "postgres") {
        return (async () => {
          if (isAdmin && (await countActiveAdminsInTx(tx)) <= 1) {
            throw err.lastAdmin();
          }
          await deleteUserInTx(tx, user.id);
          await writeAuditInTx(tx, auditEntry);
        })();
      }
      // SQLite: the uow callback must be synchronous.
      if (isAdmin && (countActiveAdminsInTx(tx) as number) <= 1) {
        throw err.lastAdmin();
      }
      void deleteUserInTx(tx, user.id);
      void writeAuditInTx(tx, auditEntry);
    });

    deleteCookie(c, SESSION_COOKIE, { path: "/" });
    return c.body(null, 204);
  });

  return r;
}
