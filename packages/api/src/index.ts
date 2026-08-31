import { serve } from "@hono/node-server";

import { buildApp } from "./app";
import { assertSchemaSupported } from "./db/bootstrap";
import { makeDb } from "./db/index";
import { makeRepos } from "./db/repositories";
import { parseEnv } from "./env";
import { assertStartupSafe } from "./startup";

async function main(): Promise<void> {
  const env = parseEnv();
  const handle = makeDb(env.DATABASE_URL);

  // FR-1.3, FR-1.6, FR-1.10 — refuse to serve on an unsupported schema, on
  // SQLite in production, or while a seeded default admin is unchanged.
  await assertSchemaSupported(handle);
  await assertStartupSafe(env, handle);

  const app = buildApp({ env, handle, repos: makeRepos(handle) });
  serve({ fetch: app.fetch, port: env.PORT }, (info) => {
    console.log(`chotu api listening on :${info.port} (${env.CHOTU_ENV})`);
  });
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exitCode = 1;
});
