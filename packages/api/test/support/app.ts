import type { Hono } from "hono";

import { buildApp } from "../../src/app";
import { makeRepos } from "../../src/db/repositories";
import { createRateLimiter, type RateLimiter } from "../../src/middleware/rate-limit";
import { parseEnv, type Env } from "../../src/env";
import type { AppHono } from "../../src/http/context";
import type { DbHandle } from "../../src/db/index";
import type { Repos } from "../../src/domain/ports";

import { openMigratedSqlite } from "./sqlite";

export interface TestApp {
  readonly app: Hono<AppHono>;
  readonly handle: DbHandle;
  readonly repos: Repos;
  readonly env: Env;
  readonly rateLimiter: RateLimiter;
  cleanup(): Promise<void>;
}

/** A running app backed by a fresh migrated SQLite database. */
export function makeTestApp(over: Partial<Record<keyof Env, string>> = {}): TestApp {
  const mig = openMigratedSqlite();
  const env = parseEnv({
    DATABASE_URL: "file:./test.db",
    SESSION_SIGNING_KEY: "test-signing-key-0123456789",
    ...over,
  });
  const repos = makeRepos(mig.handle);
  const rateLimiter = createRateLimiter();
  return {
    app: buildApp({ env, handle: mig.handle, repos, rateLimiter }),
    handle: mig.handle,
    repos,
    env,
    rateLimiter,
    cleanup: () => mig.cleanup(),
  };
}
