import { makeRepos } from "../db/repositories";
import type { DbHandle } from "../db/index";
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
