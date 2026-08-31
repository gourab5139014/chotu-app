import { createMiddleware } from "hono/factory";

import { logEvent } from "../log";
import type { AppHono } from "../http/context";

/** One structured line per request. No bodies, no headers, no secrets. */
export const logging = createMiddleware<AppHono>(async (c, next) => {
  const start = Date.now();
  await next();
  logEvent({
    level: c.res.status >= 500 ? "error" : "info",
    requestId: c.get("requestId"),
    method: c.req.method,
    path: c.req.path,
    status: c.res.status,
    ms: Date.now() - start,
    userId: c.get("user")?.id,
  });
});
