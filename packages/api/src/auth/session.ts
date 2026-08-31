import { makeRepos } from "../db/repositories";
import type { DbHandle } from "../db/index";
import type { SessionRow, UserRow } from "../db/schema/types";
import { newId } from "../domain/id";

import { generateCredential, hashToken, SESSION_PREFIX } from "./tokens";

export interface NewSessionMeta {
  userAgent?: string | null;
  ip?: string | null;
}

/** Create a server-side session. Returns the opaque credential (shown once). */
export async function createSession(
  handle: DbHandle,
  userId: string,
  ttlSeconds: number,
  meta: NewSessionMeta = {},
): Promise<{ token: string; row: SessionRow }> {
  const token = generateCredential(SESSION_PREFIX);
  const row = await makeRepos(handle).sessions.create({
    id: newId(),
    tokenHash: hashToken(token),
    userId,
    expiresAt: new Date(Date.now() + ttlSeconds * 1000),
    revokedAt: null,
    userAgent: meta.userAgent ?? null,
    ip: meta.ip ?? null,
  });
  return { token, row };
}

export async function revokeSessionByToken(
  handle: DbHandle,
  token: string,
): Promise<void> {
  const repos = makeRepos(handle);
  const row = await repos.sessions.findByHash(hashToken(token));
  if (row != null && row.revokedAt == null) {
    await repos.sessions.revoke(row.id, new Date());
  }
}

/** Resolve a session credential to a live user, or null. */
export async function resolveSession(
  handle: DbHandle,
  token: string,
): Promise<{ session: SessionRow; user: UserRow } | null> {
  const repos = makeRepos(handle);
  const session = await repos.sessions.findByHash(hashToken(token));
  if (session == null) return null;
  if (session.revokedAt != null) return null;
  if (session.expiresAt.getTime() <= Date.now()) return null;

  const user = await repos.users.findById(session.userId);
  if (user == null || user.status !== "active") return null;
  return { session, user };
}
