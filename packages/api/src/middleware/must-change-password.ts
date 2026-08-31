import { createMiddleware } from "hono/factory";

import { err } from "../domain/errors";
import type { AppHono } from "../http/context";

/**
 * FR-4.5: a user flagged `must_change_password` may authenticate but every
 * request other than "change password" returns `403 password_change_required`.
 * Mount this after `authMiddleware`; do NOT mount it on the change-password
 * route.
 */
export const mustChangePasswordGate = createMiddleware<AppHono>(
  async (c, next) => {
    if (c.get("user")?.mustChangePassword === true) {
      throw err.passwordChangeRequired();
    }
    await next();
  },
);
