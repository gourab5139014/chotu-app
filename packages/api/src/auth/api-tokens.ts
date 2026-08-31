import { makeRepos } from "../db/repositories";
import type { DbHandle } from "../db/index";
import type { UserRow } from "../db/schema/types";
import { newId } from "../domain/id";

import { API_TOKEN_PREFIX, generateCredential, hashToken } from "./tokens";

export class UserNotFoundError extends Error {
  constructor(email: string) {
    super(`No user with email ${email}.`);
    this.name = "UserNotFoundError";
  }
}

/** Issue a personal API token for a user. Returns the plaintext once. */
export async function issueApiToken(
  handle: DbHandle,
  opts: { userEmail: string; label?: string },
): Promise<{ token: string }> {
  const repos = makeRepos(handle);
  const user = await repos.users.findByEmail(opts.userEmail);
  if (user == null) throw new UserNotFoundError(opts.userEmail);

  const token = generateCredential(API_TOKEN_PREFIX);
  await repos.apiTokens.create({
    id: newId(),
    userId: user.id,
    tokenHash: hashToken(token),
    label: opts.label ?? null,
    expiresAt: null,
  });
  return { token };
}

/** Resolve an API token to a live user, or null. Also returns the token id. */
export async function resolveApiToken(
  handle: DbHandle,
  token: string,
): Promise<{ user: UserRow; tokenId: string } | null> {
  const repos = makeRepos(handle);
  const row = await repos.apiTokens.findByHash(hashToken(token));
  if (row == null || row.revokedAt != null) return null;
  if (row.expiresAt != null && row.expiresAt.getTime() <= Date.now()) {
    return null;
  }
  const user = await repos.users.findById(row.userId);
  if (user == null || user.status !== "active") return null;
  return { user, tokenId: row.id };
}

/** Revoke an API token by its plaintext value. */
export async function revokeApiToken(
  handle: DbHandle,
  opts: { token: string },
): Promise<{ revoked: boolean }> {
  const repos = makeRepos(handle);
  const row = await repos.apiTokens.findByHash(hashToken(opts.token));
  if (row == null || row.revokedAt != null) return { revoked: false };
  await repos.apiTokens.revoke(row.id, new Date());
  return { revoked: true };
}
