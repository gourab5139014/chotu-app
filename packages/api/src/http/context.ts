import type { Env } from "../env";
import type { DbHandle } from "../db/index";
import type { Repos } from "../domain/ports";
import type { UserRow } from "../db/schema/types";
import type { RateLimiter } from "../middleware/rate-limit";

/** What `buildApp` needs to serve. */
export interface AppDeps {
  readonly env: Env;
  readonly handle: DbHandle;
  readonly repos: Repos;
  readonly rateLimiter: RateLimiter;
}

/** Hono context variables set by middleware. */
export interface AppVariables {
  requestId: string;
  /** Set by the auth middleware once a caller is identified. */
  user?: UserRow;
  authKind?: "session" | "token";
}

export type AppHono = {
  Variables: AppVariables;
};
