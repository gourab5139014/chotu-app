import { z } from "zod";

/**
 * Process configuration. One schema, parsed once at startup.
 * See specs/0001-m1-trusted-fuel-logging/plan.md section 16 for the surface.
 */

const csv = z
  .string()
  .transform((s) =>
    s
      .split(",")
      .map((v) => v.trim())
      .filter((v) => v.length > 0),
  );

const boolish = z
  .string()
  .transform((s) => s.trim().toLowerCase())
  .pipe(z.enum(["true", "false", "1", "0"]))
  .transform((s) => s === "true" || s === "1");

export const envSchema = z.object({
  /** `development` gates SQLite and relaxes the seeded-admin guard. */
  CHOTU_ENV: z.enum(["development", "production"]).default("development"),

  /** Runtime connection, API role. Scheme picks the adapter. */
  DATABASE_URL: z.string().min(1),
  /** Bootstrap connection, DDL role. */
  DATABASE_BOOTSTRAP_URL: z.string().min(1).optional(),

  PORT: z.coerce.number().int().positive().max(65535).default(8787),

  /** Public base URL, for OIDC redirect URIs and links. */
  CHOTU_BASE_URL: z.string().url().default("http://localhost:8787"),

  /** HMAC key for the session cookie. Required. */
  SESSION_SIGNING_KEY: z.string().min(16),

  /** Browser origins allowed to call the API. Empty in an API-only deployment. */
  CORS_ALLOWED_ORIGINS: csv.default(""),

  /** Read the client IP from the last X-Forwarded-For hop for rate limiting. */
  TRUSTED_PROXY: boolish.default("false"),

  /** Optional overrides for the draft rate-limit thresholds (requests/window). */
  RATE_LIMIT_SIGNIN_PER_MIN_IP: z.coerce.number().int().positive().optional(),
  RATE_LIMIT_SIGNIN_PER_MIN_ACCOUNT: z.coerce.number().int().positive().optional(),

  /** Optional SMTP. When unset, link tokens are returned in the API response. */
  EMAIL_SMTP_URL: z.string().optional(),
  EMAIL_FROM: z.string().optional(),
});

export type Env = z.infer<typeof envSchema>;

export class EnvError extends Error {
  constructor(public readonly issues: z.ZodIssue[]) {
    super(
      "Invalid configuration:\n" +
        issues.map((i) => `  ${i.path.join(".") || "(root)"}: ${i.message}`).join("\n"),
    );
    this.name = "EnvError";
  }
}

export function parseEnv(source: NodeJS.ProcessEnv = process.env): Env {
  const result = envSchema.safeParse(source);
  if (!result.success) {
    throw new EnvError(result.error.issues);
  }
  return result.data;
}
