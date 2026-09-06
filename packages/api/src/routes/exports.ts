import { Hono } from "hono";

import { buildUserExport } from "../export";
import type { AppDeps, AppHono } from "../http/context";
import { protect } from "../middleware/protect";

/** `GET /export` — the caller's own data as one schema-versioned JSON doc (FR-16). */
export function exportRoutes(deps: AppDeps): Hono<AppHono> {
  const r = new Hono<AppHono>();
  r.use("*", ...protect(deps));

  r.get("/", async (c) => {
    const user = c.get("user")!;
    return c.json(await buildUserExport(deps.repos, user));
  });

  return r;
}
