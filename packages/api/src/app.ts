import { Hono } from "hono";
import { cors } from "hono/cors";

import { stringify } from "yaml";

import { buildOpenApiDocument } from "./contract/build";
import { CURRENT_SCHEMA_VERSION } from "./db/schema/version";
import type { AppDeps, AppHono } from "./http/context";
import { onError, onNotFound } from "./middleware/error";
import { logging } from "./middleware/logging";
import { requestId } from "./middleware/request-id";
import { authRoutes } from "./routes/auth";
import { tokenRoutes } from "./routes/tokens";

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

  const openApiYaml = stringify(buildOpenApiDocument());
  app.get("/openapi.yaml", (c) =>
    c.body(openApiYaml, 200, { "content-type": "application/yaml" }),
  );

  app.route("/auth", authRoutes(deps));
  app.route("/tokens", tokenRoutes(deps));

  return app;
}
