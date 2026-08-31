import { getCookie } from "hono/cookie";
import { createMiddleware } from "hono/factory";

import { resolveApiToken } from "../auth/api-tokens";
import { resolveSession } from "../auth/session";
import {
  API_TOKEN_PREFIX,
  SESSION_COOKIE,
  SESSION_PREFIX,
} from "../auth/tokens";
import { makeRepos } from "../db/repositories";
import { err } from "../domain/errors";
import type { AppDeps, AppHono } from "../http/context";

function bearer(header: string | undefined): string | null {
  if (header == null) return null;
  const m = /^Bearer\s+(.+)$/i.exec(header.trim());
  return m?.[1] ?? null;
}

/**
 * Resolve a credential to a live user (FR-2.2, FR-2.5). Precedence:
 *   1. `Authorization: Bearer cht_...`  -> API token
 *   2. `Authorization: Bearer chs_...`  -> session (headless, Q-11)
 *   3. the `chotu_session` cookie       -> session
 * A bearer value with no known prefix is rejected outright; it never falls
 * through to the cookie. Missing/invalid/expired/revoked/deactivated -> 401.
 */
export function authMiddleware(deps: AppDeps) {
  return createMiddleware<AppHono>(async (c, next) => {
    const bearerValue = bearer(c.req.header("authorization"));

    if (bearerValue != null) {
      if (bearerValue.startsWith(API_TOKEN_PREFIX)) {
        const hit = await resolveApiToken(deps.handle, bearerValue);
        if (hit == null) throw err.unauthorized();
        c.set("user", hit.user);
        c.set("authKind", "token");
        void makeRepos(deps.handle)
          .apiTokens.touch(hit.tokenId, new Date())
          .catch(() => undefined);
        await next();
        return;
      }
      if (bearerValue.startsWith(SESSION_PREFIX)) {
        const hit = await resolveSession(deps.handle, bearerValue);
        if (hit == null) throw err.unauthorized();
        c.set("user", hit.user);
        c.set("authKind", "session");
        await next();
        return;
      }
      throw err.unauthorized();
    }

    const cookie = getCookie(c, SESSION_COOKIE);
    if (cookie != null && cookie.length > 0) {
      const hit = await resolveSession(deps.handle, cookie);
      if (hit == null) throw err.unauthorized();
      c.set("user", hit.user);
      c.set("authKind", "session");
      await next();
      return;
    }

    throw err.unauthorized();
  });
}
