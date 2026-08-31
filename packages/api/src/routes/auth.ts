import { Hono } from "hono";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";
import { z } from "zod";

import { hashPassword, verifyPassword } from "../auth/password";
import {
  revokeSessionByToken,
} from "../auth/session";
import { signIn } from "../auth/signin";
import { SESSION_COOKIE } from "../auth/tokens";
import { err } from "../domain/errors";
import type { AppDeps, AppHono } from "../http/context";
import { parseJson } from "../http/validate";
import { authMiddleware } from "../middleware/auth";
import { protect } from "../middleware/protect";
import { clientIp } from "../middleware/rate-limit";
import type { UserRow } from "../db/schema/types";

export const SignInBody = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

export const ChangePasswordBody = z.object({
  currentPassword: z.string().min(1),
  newPassword: z.string().min(8),
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

function bearerOrCookie(c: {
  req: { header(n: string): string | undefined };
}): string | null {
  const h = c.req.header("authorization");
  const m = h != null ? /^Bearer\s+(.+)$/i.exec(h.trim()) : null;
  return m?.[1] ?? null;
}

export function authRoutes(deps: AppDeps): Hono<AppHono> {
  const r = new Hono<AppHono>();
  const DEFAULT_TTL = 60 * 60 * 24 * 7;

  const ipPerMin = deps.env.RATE_LIMIT_SIGNIN_PER_MIN_IP ?? 10;
  const acctPerMin = deps.env.RATE_LIMIT_SIGNIN_PER_MIN_ACCOUNT ?? 5;

  // POST /auth/sign-in — email + password (FR-2.1), rate limited per IP + per
  // account (FR-2.6, NFR auth hardening).
  r.post(
    "/sign-in",
    deps.rateLimiter.limit({
      limit: ipPerMin,
      windowMs: 60_000,
      keys: (c) => [`signin:ip:${clientIp(c, deps.env.TRUSTED_PROXY)}`],
    }),
    deps.rateLimiter.limit({
      limit: acctPerMin,
      windowMs: 60_000,
      keys: async (c) => {
        const raw = (await c.req.json().catch(() => ({}))) as {
          email?: unknown;
        };
        const email =
          typeof raw.email === "string" ? raw.email.toLowerCase() : "?";
        return [`signin:acct:${email}`];
      },
    }),
    async (c) => {
      const body = await parseJson(c, SignInBody);
    const settings = await deps.repos.settings.get();
    const result = await signIn(
      deps.handle,
      { email: body.email, password: body.password },
      {
        sessionTtlSeconds: settings?.sessionTtlSeconds ?? DEFAULT_TTL,
        userAgent: c.req.header("user-agent") ?? null,
        ip: c.req.header("x-forwarded-for") ?? null,
      },
    );

    setCookie(c, SESSION_COOKIE, result.sessionToken, {
      httpOnly: true,
      secure: deps.env.CHOTU_ENV === "production",
      sameSite: "Lax",
      path: "/",
      expires: result.expiresAt,
    });

      return c.json({
        user: publicUser(result.user),
        session: result.sessionToken,
        expiresAt: result.expiresAt.toISOString(),
      });
    },
  );

  // POST /auth/sign-out — revoke the current session (FR-2.4)
  r.post("/sign-out", authMiddleware(deps), async (c) => {
    const credential =
      bearerOrCookie(c) ?? getCookie(c, SESSION_COOKIE) ?? null;
    if (credential != null) {
      await revokeSessionByToken(deps.handle, credential);
    }
    deleteCookie(c, SESSION_COOKIE, { path: "/" });
    return c.body(null, 204);
  });

  // POST /auth/change-password — supply the current one (FR-4.1, FR-4.5)
  r.post("/change-password", authMiddleware(deps), async (c) => {
    const user = c.get("user");
    if (user == null) throw err.unauthorized();
    const body = await parseJson(c, ChangePasswordBody);

    if (
      user.passwordHash == null ||
      !(await verifyPassword(user.passwordHash, body.currentPassword))
    ) {
      throw err.unauthorized("Current password is wrong.");
    }

    await deps.repos.users.update(user.id, {
      passwordHash: await hashPassword(body.newPassword),
      mustChangePassword: false,
    });
    return c.body(null, 204);
  });

  // GET /auth/me — the signed-in user (protected)
  r.get("/me", ...protect(deps), (c) => {
    const user = c.get("user");
    if (user == null) throw err.unauthorized();
    return c.json({ user: publicUser(user) });
  });

  return r;
}
