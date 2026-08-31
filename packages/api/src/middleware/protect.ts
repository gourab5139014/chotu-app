import type { MiddlewareHandler } from "hono";

import type { AppDeps, AppHono } from "../http/context";

import { authMiddleware } from "./auth";
import { mustChangePasswordGate } from "./must-change-password";

/**
 * The standard chain for a protected route: authenticate, then enforce the
 * must-change-password gate. Spread into a route definition:
 *   r.get("/x", ...protect(deps), handler)
 */
export function protect(deps: AppDeps): MiddlewareHandler<AppHono>[] {
  return [authMiddleware(deps), mustChangePasswordGate];
}
