import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

/** Prefixes so the auth middleware can tell a session id from an API token. */
export const SESSION_PREFIX = "chs_";
export const API_TOKEN_PREFIX = "cht_";

/** Name of the browser session cookie. */
export const SESSION_COOKIE = "chotu_session";

/** A prefixed, URL-safe, 256-bit random credential. Shown once, stored hashed. */
export function generateCredential(prefix: string): string {
  return `${prefix}${randomBytes(32).toString("base64url")}`;
}

/** A bare 256-bit URL-safe token for email links (reset / verify / set-password). */
export function generateLinkToken(): string {
  return randomBytes(32).toString("base64url");
}

export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export function tokensMatch(a: string, b: string): boolean {
  const ba = Buffer.from(a);
  const bb = Buffer.from(b);
  return ba.length === bb.length && timingSafeEqual(ba, bb);
}
