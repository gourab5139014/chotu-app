import { Hono } from "hono";
import { z } from "zod";

import {
  deleteIdentityInTx,
  deleteOidcProviderInTx,
  insertOidcProviderInTx,
  updateOidcProviderInTx,
  writeAuditInTx,
} from "../db/repositories";
import { makeUnitOfWork, runTxSteps } from "../db/uow";
import { err } from "../domain/errors";
import { newId } from "../domain/id";
import type { AppDeps, AppHono } from "../http/context";
import { parseJson } from "../http/validate";
import { protectAdmin } from "../middleware/admin";
import { clientIp } from "../middleware/rate-limit";
import type { Tx } from "../db/uow";
import type { OidcProviderRow } from "../db/schema/types";

const KEY_RE = /^[a-z0-9-]{1,40}$/;
// D-5 / R-3: M1 stores the client secret only as an environment reference,
// resolved at runtime by auth/oidc.ts. DB-encrypted storage is a later option.
const SECRET_REF_RE = /^env:[A-Za-z_][A-Za-z0-9_]*$/;

export const OidcProviderCreateBody = z.object({
  key: z.string().regex(KEY_RE, { message: "Must match ^[a-z0-9-]{1,40}$" }),
  displayName: z.string().trim().min(1).max(100),
  issuerUrl: z.string().url(),
  clientId: z.string().trim().min(1).max(200),
  clientSecretRef: z
    .string()
    .regex(SECRET_REF_RE, { message: 'Must look like "env:VAR_NAME"' }),
  scopes: z
    .array(z.string().min(1))
    .min(1)
    .default(["openid", "email", "profile"]),
  allowedEmailDomains: z.array(z.string().min(1)).nullable().default(null),
  allowedGroups: z.array(z.string().min(1)).nullable().default(null),
  autoProvision: z.boolean().default(false),
  enabled: z.boolean().default(true),
});

export const OidcProviderUpdateBody = OidcProviderCreateBody.omit({
  key: true,
})
  .partial()
  .refine((b) => Object.keys(b).length > 0, {
    message: "Provide at least one field to change",
  });

function publicProvider(p: OidcProviderRow) {
  return {
    id: p.id,
    key: p.key,
    displayName: p.displayName,
    issuerUrl: p.issuerUrl,
    clientId: p.clientId,
    // clientSecretRef is write-only over the API (FR-9.3) — never returned.
    secretConfigured: true,
    scopes: p.scopes,
    allowedEmailDomains: p.allowedEmailDomains,
    allowedGroups: p.allowedGroups,
    autoProvision: p.autoProvision,
    enabled: p.enabled,
    createdAt: p.createdAt.toISOString(),
    updatedAt: p.updatedAt.toISOString(),
  };
}

/**
 * Admin CRUD for OIDC providers (FR-6.1, FR-9.3). Deleting a provider with
 * linked identities is refused (`provider_in_use`) unless the caller passes
 * `?force=true`, which unlinks every affected identity first and re-checks
 * FR-6.3 (at least one sign-in method) for each affected user before
 * committing anything.
 */
export function oidcAdminRoutes(deps: AppDeps): Hono<AppHono> {
  const r = new Hono<AppHono>();
  r.use("*", ...protectAdmin(deps));
  const uow = makeUnitOfWork(deps.handle);

  r.get("/", async (c) => {
    const providers = await deps.repos.oidcProviders.list();
    return c.json({ providers: providers.map(publicProvider) });
  });

  r.get("/:key", async (c) => {
    const p = await deps.repos.oidcProviders.findByKey(c.req.param("key"));
    if (p == null) throw err.notFound("Provider not found");
    return c.json({ provider: publicProvider(p) });
  });

  r.post("/", async (c) => {
    const actor = c.get("user")!;
    const body = await parseJson(c, OidcProviderCreateBody);

    if ((await deps.repos.oidcProviders.findByKey(body.key)) != null) {
      throw err.conflict("That provider key is already in use.");
    }

    const now = new Date();
    const row: OidcProviderRow = {
      ...body,
      id: newId(),
      createdAt: now,
      updatedAt: now,
    };

    await runTxSteps(uow, {}, [
      (tx) => insertOidcProviderInTx(tx, row),
      (tx) =>
        writeAuditInTx(tx, {
          actorUserId: actor.id,
          ip: clientIp(c, deps.env.TRUSTED_PROXY),
          action: "oidc_provider.created",
          targetType: "oidc_provider",
          targetId: row.key,
          summary: `Added OIDC provider ${row.key}`,
          metadata: { issuerUrl: row.issuerUrl },
        }),
    ]);

    return c.json({ provider: publicProvider(row) }, 201);
  });

  r.patch("/:key", async (c) => {
    const actor = c.get("user")!;
    const key = c.req.param("key");
    const current = await deps.repos.oidcProviders.findByKey(key);
    if (current == null) throw err.notFound("Provider not found");
    const body = await parseJson(c, OidcProviderUpdateBody);

    // exactOptionalPropertyTypes: copy only the fields the caller sent.
    const patch: Partial<Omit<OidcProviderRow, "id" | "key" | "createdAt">> = {};
    if (body.displayName !== undefined) patch.displayName = body.displayName;
    if (body.issuerUrl !== undefined) patch.issuerUrl = body.issuerUrl;
    if (body.clientId !== undefined) patch.clientId = body.clientId;
    if (body.clientSecretRef !== undefined) {
      patch.clientSecretRef = body.clientSecretRef;
    }
    if (body.scopes !== undefined) patch.scopes = body.scopes;
    if (body.allowedEmailDomains !== undefined) {
      patch.allowedEmailDomains = body.allowedEmailDomains;
    }
    if (body.allowedGroups !== undefined) patch.allowedGroups = body.allowedGroups;
    if (body.autoProvision !== undefined) patch.autoProvision = body.autoProvision;
    if (body.enabled !== undefined) patch.enabled = body.enabled;

    await runTxSteps(uow, {}, [
      (tx) => updateOidcProviderInTx(tx, key, patch),
      (tx) =>
        writeAuditInTx(tx, {
          actorUserId: actor.id,
          ip: clientIp(c, deps.env.TRUSTED_PROXY),
          action: "oidc_provider.updated",
          targetType: "oidc_provider",
          targetId: key,
          summary: `Updated OIDC provider ${key}`,
          metadata: { fields: Object.keys(patch) },
        }),
    ]);

    const updated = await deps.repos.oidcProviders.findByKey(key);
    return c.json({ provider: publicProvider(updated!) });
  });

  r.delete("/:key", async (c) => {
    const actor = c.get("user")!;
    const key = c.req.param("key");
    const current = await deps.repos.oidcProviders.findByKey(key);
    if (current == null) throw err.notFound("Provider not found");

    const force = c.req.query("force") === "true";
    const linked = await deps.repos.identities.listForProvider(key);

    if (linked.length > 0 && !force) throw err.providerInUse();

    if (linked.length > 0) {
      // FR-6.3: check every affected user *before* unlinking anything, so the
      // whole delete is all-or-nothing.
      const affectedUserIds = [...new Set(linked.map((i) => i.userId))];
      for (const userId of affectedUserIds) {
        const u = await deps.repos.users.findById(userId);
        if (u == null) continue;
        const others = await deps.repos.identities.listForUser(userId);
        const hasOtherIdentity = others.some((i) => i.providerKey !== key);
        if (u.passwordHash == null && !hasOtherIdentity) {
          throw err.authMethodRequired(
            `Deleting this provider would leave ${u.email} with no sign-in method.`,
          );
        }
      }
    }

    await runTxSteps(uow, {}, [
      ...linked.map((i) => (tx: Tx) => deleteIdentityInTx(tx, i.id)),
      (tx) => deleteOidcProviderInTx(tx, key),
      (tx) =>
        writeAuditInTx(tx, {
          actorUserId: actor.id,
          ip: clientIp(c, deps.env.TRUSTED_PROXY),
          action: "oidc_provider.deleted",
          targetType: "oidc_provider",
          targetId: key,
          summary:
            linked.length > 0
              ? `Deleted OIDC provider ${key} and unlinked ${linked.length} identities (force)`
              : `Deleted OIDC provider ${key}`,
          metadata: { unlinkedCount: linked.length },
        }),
    ]);

    return c.body(null, 204);
  });

  return r;
}
