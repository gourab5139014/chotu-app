import { Hono } from "hono";

import { deleteIdentityInTx, writeAuditInTx } from "../db/repositories";
import { makeUnitOfWork, runTxSteps } from "../db/uow";
import { err } from "../domain/errors";
import type { AppDeps, AppHono } from "../http/context";
import { clientIp } from "../middleware/rate-limit";
import { protect } from "../middleware/protect";
import type { IdentityRow } from "../db/schema/types";

function publicIdentity(i: IdentityRow) {
  return {
    id: i.id,
    providerKey: i.providerKey,
    subject: i.subject,
    createdAt: i.createdAt.toISOString(),
    lastLoginAt: i.lastLoginAt?.toISOString() ?? null,
  };
}

/**
 * The caller's own linked OIDC identities (T7.4). Linking happens through
 * `GET /auth/oidc/:key/link/start`; this router only lists and unlinks.
 */
export function identityRoutes(deps: AppDeps): Hono<AppHono> {
  const r = new Hono<AppHono>();
  r.use("*", ...protect(deps));
  const uow = makeUnitOfWork(deps.handle);

  // GET /identities
  r.get("/", async (c) => {
    const user = c.get("user")!;
    const identities = await deps.repos.identities.listForUser(user.id);
    return c.json({ identities: identities.map(publicIdentity) });
  });

  // DELETE /identities/:id — unlink (FR-6.3).
  r.delete("/:id", async (c) => {
    const user = c.get("user")!;
    const identity = await deps.repos.identities.findById(c.req.param("id"));
    if (identity == null || identity.userId !== user.id) {
      throw err.notFound("Identity not found");
    }

    const others = await deps.repos.identities.listForUser(user.id);
    const hasOtherIdentity = others.some((i) => i.id !== identity.id);
    if (user.passwordHash == null && !hasOtherIdentity) {
      throw err.authMethodRequired(
        "This is your only sign-in method. Set a password or link another identity first.",
      );
    }

    await runTxSteps(uow, {}, [
      (tx) => deleteIdentityInTx(tx, identity.id),
      (tx) =>
        writeAuditInTx(tx, {
          actorUserId: user.id,
          ip: clientIp(c, deps.env.TRUSTED_PROXY),
          action: "identity.unlinked",
          targetType: "user",
          targetId: user.id,
          summary: `Unlinked an OIDC identity from provider ${identity.providerKey}`,
          metadata: { providerKey: identity.providerKey },
        }),
    ]);

    return c.body(null, 204);
  });

  return r;
}
