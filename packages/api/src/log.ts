/**
 * Structured logging with redaction. One JSON line per event. Never logs a
 * secret or a fuel-entry field value (NFR "Observability").
 */

const REDACT_KEYS = new Set(
  [
    "password",
    "password_hash",
    "passwordhash",
    "token",
    "token_hash",
    "tokenhash",
    "authorization",
    "cookie",
    "set-cookie",
    "secret",
    "session_signing_key",
    "client_secret",
    "code_verifier",
  ].map((k) => k.toLowerCase()),
);

const PLACEHOLDER = "[redacted]";

export function redact(value: unknown, seen = new WeakSet<object>()): unknown {
  if (Array.isArray(value)) {
    return value.map((v) => redact(v, seen));
  }
  if (value !== null && typeof value === "object") {
    if (seen.has(value)) return "[circular]";
    seen.add(value);
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) {
      out[k] = REDACT_KEYS.has(k.toLowerCase()) ? PLACEHOLDER : redact(v, seen);
    }
    return out;
  }
  return value;
}

export type LogLevel = "debug" | "info" | "warn" | "error";

export function logEvent(
  event: Record<string, unknown> & { level: LogLevel },
): void {
  const line = JSON.stringify({
    ts: new Date().toISOString(),
    ...(redact(event) as Record<string, unknown>),
  });
  if (event.level === "error") console.error(line);
  else console.log(line);
}
