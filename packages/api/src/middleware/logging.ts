import { createMiddleware } from "hono/factory";

import { AppError, ERROR_STATUS, type ErrorCode } from "../domain/errors";
import { logEvent } from "../log";
import type { AppHono } from "../http/context";

/**
 * One structured line per request. No bodies, no headers, no secrets. Logs even
 * when the handler or a downstream middleware throws — a 401/403/429 from a
 * thrown `AppError` must still leave a trail (auth service).
 */
export const logging = createMiddleware<AppHono>(async (c, next) => {
  const start = Date.now();
  let errCode: ErrorCode | undefined;
  try {
    await next();
  } catch (e) {
    errCode = e instanceof AppError ? e.code : "internal_error";
    throw e;
  } finally {
    // Three cases:
    //  - normal response: errCode unset, c.res.status is right.
    //  - AppError caught by app.onError: it set c.res.status and c.get("errorCode");
    //    the middleware catch never ran, so errCode is unset.
    //  - error that escaped onError: errCode set here, c.res.status still 200.
    const code = errCode ?? c.get("errorCode");
    const status =
      errCode != null ? ERROR_STATUS[errCode] : c.res.status;
    logEvent({
      level: status >= 500 ? "error" : "info",
      requestId: c.get("requestId"),
      method: c.req.method,
      path: c.req.path,
      status,
      code,
      ms: Date.now() - start,
      userId: c.get("user")?.id,
    });
  }
});
