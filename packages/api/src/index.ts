import { serve } from "@hono/node-server";

import { buildApp } from "./app.js";

/**
 * Process entry point. Startup guards (production vs SQLite, seeded-admin
 * password check) are added in slice 3 — see plan.md section 7.
 */
function main(): void {
  const app = buildApp();
  const port = Number.parseInt(process.env["PORT"] ?? "8787", 10);

  serve({ fetch: app.fetch, port }, (info) => {
    console.log(`chotu api listening on :${info.port}`);
  });
}

main();
