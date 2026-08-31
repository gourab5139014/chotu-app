import { makeRepos } from "../db/repositories";
import type { DbHandle } from "../db/index";
import type { UserRow } from "../db/schema/types";
import { err } from "../domain/errors";

import { verifyPassword } from "./password";
import { createSession } from "./session";

export interface SignInResult {
  user: UserRow;
  sessionToken: string;
  expiresAt: Date;
}

/**
 * Verify an email + password and open a session (FR-2.1, FR-2.3). Every failure
 * returns the same generic `unauthorized` so it cannot be used to probe which
 * emails exist.
 */
export async function signIn(
  handle: DbHandle,
  input: { email: string; password: string },
  opts: { sessionTtlSeconds: number; userAgent?: string | null; ip?: string | null },
): Promise<SignInResult> {
  const generic = err.unauthorized("Wrong email or password.");
  const user = await makeRepos(handle).users.findByEmail(input.email);

  if (
    user == null ||
    user.status !== "active" ||
    user.passwordHash == null ||
    !(await verifyPassword(user.passwordHash, input.password))
  ) {
    throw generic;
  }

  const { token, row } = await createSession(
    handle,
    user.id,
    opts.sessionTtlSeconds,
    { userAgent: opts.userAgent ?? null, ip: opts.ip ?? null },
  );
  return { user, sessionToken: token, expiresAt: row.expiresAt };
}
