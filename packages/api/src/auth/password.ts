import { hash, verify } from "@node-rs/argon2";

/**
 * Argon2id parameters, fixed so every hash is comparable. `algorithm: 2` is
 * `Algorithm.Argon2id` — the enum is an ambient const enum, unusable under
 * `verbatimModuleSyntax`, so the value is inlined.
 */
const OPTIONS = {
  algorithm: 2,
  memoryCost: 19_456,
  timeCost: 2,
  parallelism: 1,
} as const;

export function hashPassword(plaintext: string): Promise<string> {
  return hash(plaintext, OPTIONS);
}

export async function verifyPassword(
  phc: string,
  plaintext: string,
): Promise<boolean> {
  try {
    return await verify(phc, plaintext);
  } catch {
    return false;
  }
}
