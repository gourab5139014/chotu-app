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
 * Resolve a session cookie or an `Authorization: Bearer` credential (session or
 * API token, by prefix) to a live user. Rejects a missing, invalid, expired,
 * revoked, or deactivated credential with `401` (FR-2.2, FR-2.5). On success
 * sets `c.get("user")` and `c.get("authKind")`.
 */
export function authMiddleware(deps: AppDeps) {
  return createMiddleware<AppHono>(async (c, next) => {
    const credential =
      bearer(c.req.header("authorization")) ?? getCookie(c, SESSION_COOKIE) ?? null;
    if (credential == null) throw err.unauthorized();

    if (credential.startsWith(API_TOKEN_PREFIX)) {
      const hit = await resolveApiToken(deps.handle, credential);
      if (hit == null) throw err.unauthorized();
      c.set("user", hit.user);
      c.set("authKind", "token");
      // FR-5.2: last-used, outside the request's critical path.
      void makeRepos(deps.handle)
        .apiTokens.touch(hit.tokenId, new Date())
        .catch(() => undefined);
      await next();
      return;
    }

    // A session credential, whether it carried the chs_ prefix or came from
    // the cookie.
    if (credential.startsWith(SESSION_PREFIX) || getCookie(c, SESSION_COOKIE)) {
      const hit = await resolveSession(deps.handle, credential);
      if (hit == null) throw err.unauthorized();
      c.set("user", hit.user);
      c.set("authKind", "session");
      await next();
      return;
    }

    throw err.unauthorized();
  });
}
