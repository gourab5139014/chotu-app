import { makeRepos } from "../db/repositories";
import type { DbHandle } from "../db/index";
import type { UserRow } from "../db/schema/types";
import { err } from "../domain/errors";

import { hashPassword, verifyPassword } from "./password";
import { createSession } from "./session";

export interface SignInResult {
  user: UserRow;
  sessionToken: string;
  expiresAt: Date;
}

/**
 * A fixed Argon2id hash used to burn roughly the same CPU on a miss as on a
 * hit, so sign-in latency does not reveal whether an email exists (FR-2.3).
 * Computed lazily once per process.
 */
let dummyHash: Promise<string> | undefined;
function dummyPasswordHash(): Promise<string> {
  dummyHash ??= hashPassword("chotu-no-such-account-constant");
  return dummyHash;
}

/**
 * Verify an email + password and open a session (FR-2.1, FR-2.3). Every failure
 * returns the same generic `unauthorized`, and a missing account still runs one
 * password verification, so timing cannot be used to enumerate emails.
 */
export async function signIn(
  handle: DbHandle,
  input: { email: string; password: string },
  opts: {
    sessionTtlSeconds: number;
    userAgent?: string | null;
    ip?: string | null;
  },
): Promise<SignInResult> {
  const generic = err.unauthorized("Wrong email or password.");
  const user = await makeRepos(handle).users.findByEmail(input.email);

  const phc = user?.passwordHash ?? (await dummyPasswordHash());
  const passwordOk = await verifyPassword(phc, input.password);

  if (user == null || user.status !== "active" || user.passwordHash == null || !passwordOk) {
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
