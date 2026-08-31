import { Hono } from "hono";
import { setCookie } from "hono/cookie";
import { z } from "zod";

import { signIn } from "../auth/signin";
import { SESSION_COOKIE } from "../auth/tokens";
import type { AppDeps, AppHono } from "../http/context";
import { parseJson } from "../http/validate";
import type { UserRow } from "../db/schema/types";

const SignInBody = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

/** Fields safe to return about the signed-in user. */
function publicUser(u: UserRow) {
  return {
    id: u.id,
    email: u.email,
    displayName: u.displayName,
    role: u.role,
    mustChangePassword: u.mustChangePassword,
  };
}

export function authRoutes(deps: AppDeps): Hono<AppHono> {
  const r = new Hono<AppHono>();

  const DEFAULT_TTL = 60 * 60 * 24 * 7;

  // POST /auth/sign-in — email + password (FR-2.1)
  r.post("/sign-in", async (c) => {
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
  });

  return r;
}
