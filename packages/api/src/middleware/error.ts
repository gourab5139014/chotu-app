import type { Context } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";

import { AppError } from "../domain/errors";
import { logEvent } from "../log";
import type { AppHono } from "../http/context";

/** Map any thrown error to the standard `{ code, message, details? }` body. */
export function onError(e: Error, c: Context<AppHono>): Response {
  if (e instanceof AppError) {
    return c.json(e.toBody(), e.status as ContentfulStatusCode);
  }
  logEvent({
    level: "error",
    requestId: c.get("requestId"),
    msg: "unhandled error",
    error: e.message,
    stack: e.stack,
  });
  return c.json(
    { code: "internal_error" as const, message: "Internal error" },
    500,
  );
}

export function onNotFound(c: Context<AppHono>): Response {
  return c.json({ code: "not_found" as const, message: "Not found" }, 404);
}
