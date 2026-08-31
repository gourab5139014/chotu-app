import { Hono } from "hono";

/**
 * Build the Chotu HTTP app.
 *
 * This is a skeleton. Middleware (request-id, logging, cors, rate-limit, auth,
 * must-change-password, admin) and the resource routes are added in later
 * slices. See specs/0001-m1-trusted-fuel-logging/plan.md sections 3 and 11.
 */
export function buildApp(): Hono {
  const app = new Hono();

  // Liveness only for now. FR-19.4 adds the applied schema version once the
  // schema and bootstrap land (slice 2 and 3).
  app.get("/healthz", (c) => c.json({ status: "ok" }));

  return app;
}
