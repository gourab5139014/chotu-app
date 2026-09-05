import * as client from "openid-client";

import type { OidcProviderRow } from "../db/schema/types";

/**
 * Resolve `provider.clientSecretRef` to the plaintext secret. M1 supports only
 * an environment reference (D-5, R-3): `"env:NAME"` reads `process.env.NAME`.
 * DB-encrypted storage is a later option.
 */
export function resolveClientSecret(ref: string): string {
  const m = /^env:([A-Za-z_][A-Za-z0-9_]*)$/.exec(ref);
  if (m == null) {
    throw new Error(`Unrecognised client_secret_ref format: "${ref}"`);
  }
  const name = m[1]!;
  const value = process.env[name];
  if (value == null || value.length === 0) {
    throw new Error(
      `client_secret_ref "${ref}" names an environment variable that is not set.`,
    );
  }
  return value;
}

interface CacheEntry {
  readonly config: client.Configuration;
  readonly updatedAt: number;
}

const configCache = new Map<string, CacheEntry>();

/** Drop a cached discovery result, e.g. after an admin edits the provider. */
export function forgetOidcConfiguration(providerKey: string): void {
  configCache.delete(providerKey);
}

/**
 * Discover (or reuse a cached) `openid-client` Configuration for a provider.
 * Cached per provider key, invalidated when `updatedAt` moves.
 */
export async function getOidcConfiguration(
  provider: OidcProviderRow,
  opts: { allowInsecureRequests: boolean },
): Promise<client.Configuration> {
  const cached = configCache.get(provider.key);
  const updatedAt = provider.updatedAt.getTime();
  if (cached != null && cached.updatedAt === updatedAt) {
    return cached.config;
  }

  const secret = resolveClientSecret(provider.clientSecretRef);
  const config = await client.discovery(
    new URL(provider.issuerUrl),
    provider.clientId,
    secret,
    undefined,
    opts.allowInsecureRequests
      ? { execute: [client.allowInsecureRequests] }
      : {},
  );
  configCache.set(provider.key, { config, updatedAt });
  return config;
}
