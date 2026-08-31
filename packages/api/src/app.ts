import { Hono } from "hono";
import { cors } from "hono/cors";

import { CURRENT_SCHEMA_VERSION } from "./db/schema/version";
import type { AppDeps, AppHono } from "./http/context";
import { onError, onNotFound } from "./middleware/error";
import { logging } from "./middleware/logging";
import { requestId } from "./middleware/request-id";

/**
 * Build the Chotu HTTP app. Resource routes are added slice by slice; this
 * wires the cross-cutting middleware (plan section 3) and the two public
 * endpoints.
 */
export function buildApp(deps: AppDeps): Hono<AppHono> {
  const app = new Hono<AppHono>();

  app.onError(onError);
  app.notFound(onNotFound);

  app.use("*", requestId);
  app.use("*", logging);
  if (deps.env.CORS_ALLOWED_ORIGINS.length > 0) {
    app.use(
      "*",
      cors({ origin: [...deps.env.CORS_ALLOWED_ORIGINS], credentials: true }),
    );
  }

  app.get("/healthz", (c) =>
    c.json({ status: "ok", schemaVersion: CURRENT_SCHEMA_VERSION }),
  );

  return app;
}
