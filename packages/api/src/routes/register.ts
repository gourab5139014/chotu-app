import { Hono } from "hono";
import { z } from "zod";

import { hashPassword } from "../auth/password";
import { generateLinkToken, hashToken } from "../auth/tokens";
import {
  consumeUserTokenInTx,
  insertUserInTx,
  issueUserTokenInTx,
  updateUserInTx,
  writeAuditInTx,
} from "../db/repositories";
import { makeUnitOfWork, runTxSteps } from "../db/uow";
import { err } from "../domain/errors";
import { newId } from "../domain/id";
import type { AppDeps, AppHono } from "../http/context";
import { parseJson } from "../http/validate";
import { clientIp } from "../middleware/rate-limit";
import type { UserRow } from "../db/schema/types";

const VERIFY_TTL_MS = 1000 * 60 * 60 * 24;

export const RegisterBody = z.object({
  email: z.string().email(),
  displayName: z.string().trim().min(1).max(100),
  password: z.string().min(8),
});

export const VerifyBody = z.object({
  token: z.string().min(1),
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

/**
 * Open self-registration (FR-3.5). Only active while
 * `deployment_settings.registration_policy` is `open`. A registered account
 * cannot sign in until it verifies its email (`auth/signin.ts`).
 */
export function registerRoutes(deps: AppDeps): Hono<AppHono> {
  const r = new Hono<AppHono>();
  const uow = makeUnitOfWork(deps.handle);

  // POST /register
  r.post(
    "/register",
    deps.rateLimiter.limit({
      limit: deps.env.RATE_LIMIT_REGISTER_PER_MIN_IP ?? 5,
      windowMs: 60_000,
      keys: (c) => [`register:${clientIp(c, deps.env.TRUSTED_PROXY)}`],
    }),
    async (c) => {
      const body = await parseJson(c, RegisterBody);
      const email = body.email.toLowerCase();

      const settings = await deps.repos.settings.get();
      if (settings?.registrationPolicy !== "open") {
        throw err.forbidden("Self-registration is not enabled for this deployment.");
      }
      if ((await deps.repos.users.findByEmail(email)) != null) {
        throw err.emailTaken();
      }

      const now = new Date();
      const row: UserRow = {
        id: newId(),
        email,
        // Unverified until POST /verify consumes the token below (FR-3.5).
        emailVerifiedAt: null,
        displayName: body.displayName,
        role: "user",
        status: "active",
        passwordHash: await hashPassword(body.password),
        mustChangePassword: false,
        unitSystem: settings.defaultUnitSystem,
        currencyCode: settings.defaultCurrencyCode,
        timeZone: settings.defaultTimeZone,
        createdAt: now,
        updatedAt: now,
        deactivatedAt: null,
      };

      const link = generateLinkToken();
      await runTxSteps(uow, {}, [
        (tx) => insertUserInTx(tx, row),
        (tx) =>
          issueUserTokenInTx(tx, {
            id: newId(),
            userId: row.id,
            purpose: "verify",
            tokenHash: hashToken(link),
            expiresAt: new Date(now.getTime() + VERIFY_TTL_MS),
            usedAt: null,
            createdAt: now,
          }),
        (tx) =>
          writeAuditInTx(tx, {
            actorUserId: null,
            ip: clientIp(c, deps.env.TRUSTED_PROXY),
            action: "user.registered",
            targetType: "user",
            targetId: row.id,
            summary: "A user self-registered and is pending verification",
            metadata: null,
          }),
      ]);

      const emailConfigured = deps.env.EMAIL_SMTP_URL != null;
      return c.json(
        {
          user: publicUser(row),
          ...(emailConfigured
            ? {}
            : { verifyToken: link, note: "email is not configured" }),
        },
        201,
      );
    },
  );

  // POST /verify
  r.post(
    "/verify",
    deps.rateLimiter.limit({
      limit: deps.env.RATE_LIMIT_VERIFY_PER_MIN_IP ?? 10,
      windowMs: 60_000,
      keys: (c) => [`verify:${clientIp(c, deps.env.TRUSTED_PROXY)}`],
    }),
    async (c) => {
      const body = await parseJson(c, VerifyBody);
      const now = new Date();

      const tokenRow = await deps.repos.userTokens.findByHash(
        hashToken(body.token),
      );
      if (
        tokenRow == null ||
        tokenRow.purpose !== "verify" ||
        tokenRow.usedAt != null ||
        tokenRow.expiresAt.getTime() <= now.getTime()
      ) {
        throw err.notFound(
          "This verification link is invalid, expired, or already used.",
        );
      }

      await runTxSteps(uow, {}, [
        (tx) => consumeUserTokenInTx(tx, tokenRow.id, now),
        (tx) => updateUserInTx(tx, tokenRow.userId, { emailVerifiedAt: now }),
      ]);

      const user = await deps.repos.users.findById(tokenRow.userId);
      if (user == null) throw err.notFound("User not found");
      return c.json({ user: publicUser(user) });
    },
  );

  return r;
}
