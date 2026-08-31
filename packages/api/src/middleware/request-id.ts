import { randomUUID } from "node:crypto";

import { createMiddleware } from "hono/factory";

import type { AppHono } from "../http/context";

/** Assign a request id (honouring an inbound `x-request-id`) and echo it. */
export const requestId = createMiddleware<AppHono>(async (c, next) => {
  const incoming = c.req.header("x-request-id");
  const id = incoming != null && incoming.length <= 200 ? incoming : randomUUID();
  c.set("requestId", id);
  c.header("x-request-id", id);
  await next();
});
