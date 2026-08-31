import { randomUUID } from "node:crypto";

import { createMiddleware } from "hono/factory";

import type { AppHono } from "../http/context";

/** Safe to echo into a response header: no CR/LF, bounded length. */
const SAFE_REQUEST_ID = /^[A-Za-z0-9._-]{1,200}$/;

/** Assign a request id (honouring a well-formed inbound `x-request-id`). */
export const requestId = createMiddleware<AppHono>(async (c, next) => {
  const incoming = c.req.header("x-request-id");
  const id =
    incoming != null && SAFE_REQUEST_ID.test(incoming) ? incoming : randomUUID();
  c.set("requestId", id);
  c.header("x-request-id", id);
  await next();
});
