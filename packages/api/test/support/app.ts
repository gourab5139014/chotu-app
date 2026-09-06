import type { AddressInfo } from "node:net";

import { serve } from "@hono/node-server";
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

/**
 * Serve `buildApp` on a real loopback socket for a given adapter handle, for
 * tests that must exercise the app over HTTP (the AC-5 journey). Returns the
 * base URL and a close function.
 */
export async function serveApp(
  handle: DbHandle,
  over: Partial<Record<keyof Env, string>> = {},
): Promise<{ baseUrl: string; close: () => Promise<void> }> {
  const env = parseEnv({
    DATABASE_URL: "file:./test.db",
    SESSION_SIGNING_KEY: "test-signing-key-0123456789",
    ...over,
  });
  const app = buildApp({
    env,
    handle,
    repos: makeRepos(handle),
    rateLimiter: createRateLimiter(),
  });
  const server = await new Promise<ReturnType<typeof serve>>((resolve) => {
    const s = serve(
      { fetch: app.fetch, port: 0, hostname: "127.0.0.1" },
      () => resolve(s),
    );
  });
  const { port } = server.address() as AddressInfo;
  return {
    baseUrl: `http://127.0.0.1:${port}`,
    close: () =>
      new Promise<void>((resolve, reject) =>
        server.close((e) => (e != null ? reject(e) : resolve())),
      ),
  };
}
