import type { Context } from "hono";
import { createMiddleware } from "hono/factory";

import { err } from "../domain/errors";
import type { AppHono } from "../http/context";

interface Bucket {
  count: number;
  resetAt: number;
}

export interface RateLimiter {
  /**
   * Middleware that counts a hit against one or more keys. If any key is over
   * its limit in the current window, respond `429` with `Retry-After`.
   */
  limit(opts: {
    limit: number;
    windowMs: number;
    keys: (c: Context<AppHono>) => string[] | Promise<string[]>;
  }): ReturnType<typeof createMiddleware<AppHono>>;
  /** Clear all buckets (tests). */
  reset(): void;
}

export function createRateLimiter(now: () => number = Date.now): RateLimiter {
  const buckets = new Map<string, Bucket>();

  function hit(key: string, limit: number, windowMs: number): number {
    const t = now();
    const b = buckets.get(key);
    if (b == null || b.resetAt <= t) {
      buckets.set(key, { count: 1, resetAt: t + windowMs });
      return 0;
    }
    b.count += 1;
    return b.count > limit ? Math.ceil((b.resetAt - t) / 1000) : 0;
  }

  return {
    limit: ({ limit, windowMs, keys }) =>
      createMiddleware<AppHono>(async (c, next) => {
        const list = await keys(c);
        let retryAfter = 0;
        for (const k of list) {
          retryAfter = Math.max(retryAfter, hit(k, limit, windowMs));
        }
        if (retryAfter > 0) {
          c.header("Retry-After", String(retryAfter));
          throw err.rateLimited();
        }
        await next();
      }),
    reset: () => buckets.clear(),
  };
}

/**
 * The caller's IP. Only trusts `X-Forwarded-For` when `TRUSTED_PROXY` is set;
 * otherwise the socket peer (or `unknown` in tests).
 */
export function clientIp(c: Context<AppHono>, trustedProxy: boolean): string {
  if (trustedProxy) {
    const xff = c.req.header("x-forwarded-for");
    if (xff != null && xff.length > 0) {
      const parts = xff.split(",");
      return (parts[parts.length - 1] ?? "").trim() || "unknown";
    }
  }
  const env = (c.env ?? {}) as {
    incoming?: { socket?: { remoteAddress?: string } };
  };
  return env.incoming?.socket?.remoteAddress ?? "unknown";
}
