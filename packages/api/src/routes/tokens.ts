import { Hono } from "hono";
import { z } from "zod";

import { issueApiToken } from "../auth/api-tokens";
import { err } from "../domain/errors";
import type { AppDeps, AppHono } from "../http/context";
import { parseJson } from "../http/validate";
import { protect } from "../middleware/protect";
import type { ApiTokenRow } from "../db/schema/types";

const CreateBody = z.object({ label: z.string().max(100).optional() });

function publicToken(t: ApiTokenRow) {
  return {
    id: t.id,
    label: t.label,
    createdAt: t.createdAt.toISOString(),
    lastUsedAt: t.lastUsedAt?.toISOString() ?? null,
    expiresAt: t.expiresAt?.toISOString() ?? null,
    revokedAt: t.revokedAt?.toISOString() ?? null,
  };
}

/** Per-user API tokens — several active at once (FR-5). */
export function tokenRoutes(deps: AppDeps): Hono<AppHono> {
  const r = new Hono<AppHono>();
  r.use("*", ...protect(deps));

  // POST /tokens -> plaintext shown once
  r.post("/", async (c) => {
    const user = c.get("user");
    if (user == null) throw err.unauthorized();
    const { label } = await parseJson(c, CreateBody);
    const { token } = await issueApiToken(deps.handle, {
      userEmail: user.email,
      ...(label != null ? { label } : {}),
    });
    return c.json({ token, note: "shown once" }, 201);
  });

  // GET /tokens
  r.get("/", async (c) => {
    const user = c.get("user");
    if (user == null) throw err.unauthorized();
    const rows = await deps.repos.apiTokens.listForUser(user.id);
    return c.json({ tokens: rows.map(publicToken) });
  });

  // DELETE /tokens/:id
  r.delete("/:id", async (c) => {
    const user = c.get("user");
    if (user == null) throw err.unauthorized();
    const row = await deps.repos.apiTokens.findById(c.req.param("id"));
    if (row == null || row.userId !== user.id) throw err.notFound("Token not found");
    if (row.revokedAt == null) {
      await deps.repos.apiTokens.revoke(row.id, new Date());
    }
    return c.body(null, 204);
  });

  return r;
}
