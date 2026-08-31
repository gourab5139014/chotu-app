import type { MiddlewareHandler } from "hono";
import { createMiddleware } from "hono/factory";

import type { AppDeps, AppHono } from "../http/context";
import { err } from "../domain/errors";

import { protect } from "./protect";

/**
 * Role check for `/admin` routes. A valid credential is not enough — the user
 * must have the `admin` role, else `403 forbidden`. Mount it after
 * `authMiddleware` so `c.get("user")` is set.
 */
export const adminGate = createMiddleware<AppHono>(async (c, next) => {
  const user = c.get("user");
  if (user == null) throw err.unauthorized();
  if (user.role !== "admin") throw err.forbidden("Admin role required.");
  await next();
});

/**
 * The standard chain for an admin route: authenticate, enforce the
 * must-change-password gate, then require the admin role.
 *   r.get("/x", ...protectAdmin(deps), handler)
 */
export function protectAdmin(deps: AppDeps): MiddlewareHandler<AppHono>[] {
  return [...protect(deps), adminGate];
}
