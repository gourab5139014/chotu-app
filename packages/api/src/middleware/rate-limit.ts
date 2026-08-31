import type { Context } from "hono";
import { createMiddleware } from "hono/factory";

import { err } from "../domain/errors";
import type { AppHono } from "../http/context";

interface Bucket {
  count: number;
  resetAt: number;
}

/** Fixed-window buckets. Above this many keys, a write sweeps expired entries. */
const SWEEP_THRESHOLD = 5_000;
/** Hard cap: past this, the soonest-to-reset buckets are evicted on a write. */
const MAX_KEYS = 50_000;

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
  /** Seconds to wait if `key` is already over `limit`; 0 if not. No increment. */
  check(key: string, limit: number, windowMs: number): number;
  /** Count one hit against `key`. Call this only on the events you meter. */
  consume(key: string, windowMs: number): void;
  /** Clear all buckets (tests). */
  reset(): void;
}

export function createRateLimiter(now: () => number = Date.now): RateLimiter {
  const buckets = new Map<string, Bucket>();

  function maybeSweep(): void {
    if (buckets.size < SWEEP_THRESHOLD) return;
    const t = now();
    for (const [k, b] of buckets) {
      if (b.resetAt <= t) buckets.delete(k);
    }
    if (buckets.size > MAX_KEYS) {
      const oldest = [...buckets.entries()]
        .sort((a, b) => a[1].resetAt - b[1].resetAt)
        .slice(0, buckets.size - MAX_KEYS);
      for (const [k] of oldest) buckets.delete(k);
    }
  }

  /**
   * Seconds to wait, or 0. `atLimit` true (a pre-check: a further hit would
   * exceed) blocks when count >= limit; false (called right after a bump)
   * blocks when count > limit.
   */
  function retryAfter(key: string, limit: number, atLimit: boolean): number {
    const b = buckets.get(key);
    if (b == null || b.resetAt <= now()) return 0;
    const over = atLimit ? b.count >= limit : b.count > limit;
    return over ? Math.ceil((b.resetAt - now()) / 1000) : 0;
  }

  function bump(key: string, windowMs: number): void {
    maybeSweep();
    const t = now();
    const b = buckets.get(key);
    if (b == null || b.resetAt <= t) {
      buckets.set(key, { count: 1, resetAt: t + windowMs });
    } else {
      b.count += 1;
    }
  }

  return {
    limit: ({ limit, windowMs, keys }) =>
      createMiddleware<AppHono>(async (c, next) => {
        const list = await keys(c);
        let wait = 0;
        for (const k of list) {
          bump(k, windowMs);
          wait = Math.max(wait, retryAfter(k, limit, false));
        }
        if (wait > 0) {
          c.header("Retry-After", String(wait));
          throw err.rateLimited();
        }
        await next();
      }),
    check: (key, limit) => retryAfter(key, limit, true),
    consume: (key, windowMs) => bump(key, windowMs),
    reset: () => buckets.clear(),
  };
}

/**
 * The caller's IP. Only trusts `X-Forwarded-For` when `TRUSTED_PROXY` is set;
 * otherwise the socket peer (or `unknown` in tests).
 *
 * NOTE: behind a reverse proxy with `TRUSTED_PROXY=false`, every request's peer
 * is the proxy, so a per-IP limiter degrades to one shared bucket. Set
 * `TRUSTED_PROXY=true` in that deployment. The per-account failure limiter is
 * the real per-target defence regardless.
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
