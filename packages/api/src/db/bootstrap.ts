import { fileURLToPath } from "node:url";

import { sql } from "drizzle-orm";
import { migrate as migrateSqlite } from "drizzle-orm/better-sqlite3/migrator";
import { migrate as migratePostgres } from "drizzle-orm/postgres-js/migrator";

import { hashPassword } from "../auth/password";
import {
  API_TOKEN_PREFIX,
  generateCredential,
  generateLinkToken,
  hashToken,
} from "../auth/tokens";
import { newId } from "../domain/id";

import { makeRepos } from "./repositories";
import type { DeploymentSettingsRow } from "./schema/types";
import { CURRENT_SCHEMA_VERSION, isSchemaSupported } from "./schema/version";
import { sqlQuery, sqlRun, type DbHandle } from "./index";

/**
 * Bootstrap: create or upgrade Chotu's own schema, validate the schema version,
 * seed the deployment. FR-1. This file grows across T3.1 (probe), T3.2
 * (migrate + version), and T3.3 (seed).
 */

export interface ProbeOk {
  readonly ok: true;
}

export interface ProbeFail {
  readonly ok: false;
  /** One line per missing privilege. */
  readonly missing: readonly string[];
  /** The `GRANT` statements to run, one per line. */
  readonly grants: readonly string[];
  /** A single actionable message combining the above. */
  readonly message: string;
}

export type ProbeResult = ProbeOk | ProbeFail;

const CHOTU_SCHEMA = "chotu";

function fail(items: Array<{ missing: string; grant: string }>): ProbeFail {
  const missing = items.map((i) => i.missing);
  const grants = items.map((i) => i.grant);
  return {
    ok: false,
    missing,
    grants,
    message: [
      "Bootstrap cannot proceed. The bootstrap role is missing:",
      ...missing.map((m) => `  - ${m}`),
      "Run:",
      ...grants.map((g) => `  ${g}`),
    ].join("\n"),
  };
}

/**
 * Check the connection can do what bootstrap needs. On PostgreSQL this uses
 * `has_*_privilege` so it names the exact missing GRANT (FR-1.4, AC-2). On
 * SQLite it confirms the file is writable and PRAGMA foreign_keys can be set.
 */
export async function probePrivileges(
  handle: DbHandle,
): Promise<ProbeResult> {
  if (handle.dialect === "sqlite") {
    try {
      handle.client.pragma("foreign_keys = ON");
      handle.client.prepare("create table if not exists _probe (x)").run();
      handle.client.prepare("drop table if exists _probe").run();
      return { ok: true };
    } catch (err) {
      return fail([
        {
          missing: `write access to the SQLite database file (${String(err)})`,
          grant: "# ensure the database file and its directory are writable",
        },
      ]);
    }
  }

  const { db } = handle;
  const problems: Array<{ missing: string; grant: string }> = [];

  const role = (
    await db.execute<{ current_user: string }>(sql`select current_user`)
  )[0]?.current_user;
  const database = (
    await db.execute<{ current_database: string }>(
      sql`select current_database()`,
    )
  )[0]?.current_database;
  const roleId = role != null ? `"${role}"` : "<role>";
  const dbId = database != null ? `"${database}"` : "<database>";

  const schemaExists =
    (
      await db.execute<{ exists: boolean }>(
        sql`select exists (select 1 from information_schema.schemata where schema_name = ${CHOTU_SCHEMA}) as exists`,
      )
    )[0]?.exists === true;

  if (!schemaExists) {
    const canCreateDb =
      (
        await db.execute<{ ok: boolean }>(
          sql`select has_database_privilege(current_user, current_database(), 'CREATE') as ok`,
        )
      )[0]?.ok === true;
    if (!canCreateDb) {
      problems.push({
        missing: `CREATE on database ${dbId} (to create schema "${CHOTU_SCHEMA}")`,
        grant: `GRANT CREATE ON DATABASE ${dbId} TO ${roleId};`,
      });
    }
  } else {
    for (const priv of ["USAGE", "CREATE"] as const) {
      const has =
        (
          await db.execute<{ ok: boolean }>(
            sql`select has_schema_privilege(current_user, ${CHOTU_SCHEMA}, ${priv}) as ok`,
          )
        )[0]?.ok === true;
      if (!has) {
        problems.push({
          missing: `${priv} on schema "${CHOTU_SCHEMA}"`,
          grant: `GRANT ${priv} ON SCHEMA "${CHOTU_SCHEMA}" TO ${roleId};`,
        });
      }
    }
  }

  return problems.length === 0 ? { ok: true } : fail(problems);
}

// ---------------------------------------------------------------------------
// Migrate + schema version (T3.2)
// ---------------------------------------------------------------------------

const MIGRATIONS = {
  postgres: fileURLToPath(new URL("./migrations/postgres", import.meta.url)),
  sqlite: fileURLToPath(new URL("./migrations/sqlite", import.meta.url)),
};

export class SchemaVersionError extends Error {
  constructor(
    public readonly found: number,
    public readonly current: number,
  ) {
    super(
      `Database schema version ${found} is not supported by this build (expects ${current}). ` +
        `Deploy a matching Chotu version or run its migrations.`,
    );
    this.name = "SchemaVersionError";
  }
}

/** Apply every pending migration for the handle's dialect. */
export async function runMigrations(handle: DbHandle): Promise<void> {
  if (handle.dialect === "sqlite") {
    migrateSqlite(handle.db, { migrationsFolder: MIGRATIONS.sqlite });
  } else {
    await migratePostgres(handle.db, { migrationsFolder: MIGRATIONS.postgres });
  }
}

/** Upsert the `schema_meta` singleton to this build's schema version. */
export async function writeSchemaMeta(
  handle: DbHandle,
  build: string,
): Promise<void> {
  // ISO string for both dialects: PostgreSQL casts it to timestamptz, SQLite
  // stores the text. (A Date object cannot be a raw postgres.js bind param.)
  const appliedAt = new Date().toISOString();
  await sqlRun(
    handle,
    sql`insert into schema_meta (id, schema_version, applied_at, chotu_build)
        values ('singleton', ${CURRENT_SCHEMA_VERSION}, ${appliedAt}, ${build})
        on conflict (id) do update set
          schema_version = excluded.schema_version,
          applied_at = excluded.applied_at,
          chotu_build = excluded.chotu_build`,
  );
}

/** Read `schema_meta.schema_version`, or null if the row is missing. */
export async function readSchemaVersion(
  handle: DbHandle,
): Promise<number | null> {
  const rows = await sqlQuery<{ schema_version: number }>(
    handle,
    sql`select schema_version from schema_meta where id = 'singleton'`,
  );
  const v = rows[0]?.schema_version;
  return v == null ? null : Number(v);
}

/** Throw `SchemaVersionError` if the stored version is outside the window (FR-1.3). */
export async function assertSchemaSupported(handle: DbHandle): Promise<void> {
  const found = await readSchemaVersion(handle);
  if (found == null || !isSchemaSupported(found)) {
    throw new SchemaVersionError(found ?? -1, CURRENT_SCHEMA_VERSION);
  }
}

/**
 * The schema half of bootstrap (FR-1.2, FR-1.3): probe, migrate, record and
 * validate the version. Seeding (settings + first admin + token) is T3.3.
 */
export async function bootstrapSchema(
  handle: DbHandle,
  opts: { build: string },
): Promise<void> {
  const probe = await probePrivileges(handle);
  if (!probe.ok) {
    const err = new Error(probe.message);
    err.name = "BootstrapPrivilegeError";
    throw err;
  }
  await runMigrations(handle);
  await writeSchemaMeta(handle, opts.build);
  await assertSchemaSupported(handle);
}

// ---------------------------------------------------------------------------
// Seed the deployment (T3.3)
// ---------------------------------------------------------------------------

export const SEEDED_ADMIN_EMAIL = "scott@chotu.local";
const SEEDED_ADMIN_PASSWORD = "tiger";

const SETTINGS_DEFAULTS = {
  deploymentName: "Chotu",
  registrationPolicy: "invite_only",
  allowedAuthMethods: ["password"],
  defaultUnitSystem: "imperial",
  defaultCurrencyCode: "USD",
  defaultTimeZone: "America/New_York",
  fuelVolumePrecision: 3,
  sessionTtlSeconds: 60 * 60 * 24 * 7,
  apiTokenTtlSeconds: null,
} satisfies Omit<DeploymentSettingsRow, "id" | "createdAt" | "updatedAt">;

export class AlreadySeededError extends Error {
  constructor() {
    super("This deployment is already bootstrapped (deployment_settings exists).");
    this.name = "AlreadySeededError";
  }
}

export type AdminSpec =
  | { email: string; password: string }
  | { email: string } // no password -> a one-time set-password link is issued
  | { seedDefault: true }; // scott@chotu.local / tiger, must change password

export interface SeedResult {
  readonly adminId: string;
  readonly adminEmail: string;
  /** Plaintext API token for the admin. Shown once. */
  readonly apiToken: string;
  /** Present when the admin has no password yet — deliver this link. */
  readonly setPasswordToken?: string;
  readonly warnings: readonly string[];
}

/**
 * Create the `deployment_settings` singleton and the first admin (FR-1.5),
 * then issue one API token for it (FR-1.7).
 *
 * The writes are not one transaction (a password hash is computed between
 * them), so instead this is **resumable**: it throws `AlreadySeededError` only
 * once both the settings row and an active admin exist. A re-run after a
 * partial failure reuses whatever is already there and finishes the rest,
 * always returning a fresh API token.
 */
export async function seedDeployment(
  handle: DbHandle,
  opts: {
    admin: AdminSpec;
    settings?: Partial<
      Omit<DeploymentSettingsRow, "id" | "createdAt" | "updatedAt">
    >;
  },
): Promise<SeedResult> {
  const repos = makeRepos(handle);

  const existingSettings = await repos.settings.get();
  const existingAdmins = (await repos.users.list()).filter(
    (u) => u.role === "admin" && u.status === "active",
  );
  if (existingSettings != null && existingAdmins.length > 0) {
    throw new AlreadySeededError();
  }

  // Resolve the admin identity + hash first (async CPU work, no DB).
  const warnings: string[] = [];
  let email: string;
  let passwordHash: string | null;
  let mustChangePassword = false;
  let setPasswordToken: string | undefined;

  if ("seedDefault" in opts.admin) {
    email = SEEDED_ADMIN_EMAIL;
    passwordHash = await hashPassword(SEEDED_ADMIN_PASSWORD);
    mustChangePassword = true;
    warnings.push(
      `Seeded the default admin ${SEEDED_ADMIN_EMAIL} with password "${SEEDED_ADMIN_PASSWORD}". ` +
        "Change it on first sign-in. The API will not serve production traffic until you do.",
    );
  } else if ("password" in opts.admin) {
    email = opts.admin.email;
    passwordHash = await hashPassword(opts.admin.password);
  } else {
    email = opts.admin.email;
    passwordHash = null;
  }

  if (existingSettings == null) {
    const t0 = new Date();
    await repos.settings.create({
      id: "singleton",
      ...SETTINGS_DEFAULTS,
      ...opts.settings,
      createdAt: t0,
      updatedAt: t0,
    });
  }

  // Reuse an admin from a partial prior run if it matches, else create one.
  const prior = await repos.users.findByEmail(email);
  const adminId = prior?.id ?? newId();
  if (prior == null) {
    await repos.users.create({
      id: adminId,
      email,
      // The operator running bootstrap supplied this email directly; there is
      // no verification flow for it (FR-3.5 gates self-registration only).
      emailVerifiedAt: new Date(),
      displayName: "Administrator",
      role: "admin",
      status: "active",
      passwordHash,
      mustChangePassword,
      unitSystem:
        opts.settings?.defaultUnitSystem ?? SETTINGS_DEFAULTS.defaultUnitSystem,
      currencyCode:
        opts.settings?.defaultCurrencyCode ??
        SETTINGS_DEFAULTS.defaultCurrencyCode,
      timeZone:
        opts.settings?.defaultTimeZone ?? SETTINGS_DEFAULTS.defaultTimeZone,
      deactivatedAt: null,
    });
  }

  if ((prior?.passwordHash ?? passwordHash) == null) {
    const link = generateLinkToken();
    await repos.userTokens.issue({
      id: newId(),
      userId: adminId,
      purpose: "set_password",
      tokenHash: hashToken(link),
      expiresAt: new Date(Date.now() + 1000 * 60 * 60 * 24),
    });
    setPasswordToken = link;
  }

  const apiToken = generateCredential(API_TOKEN_PREFIX);
  await repos.apiTokens.create({
    id: newId(),
    userId: adminId,
    tokenHash: hashToken(apiToken),
    label: "bootstrap",
    expiresAt: null,
  });

  return {
    adminId,
    adminEmail: email,
    apiToken,
    ...(setPasswordToken != null ? { setPasswordToken } : {}),
    warnings,
  };
}

/** Full bootstrap: schema + seed, unless the deployment is already seeded. */
export async function bootstrapDeployment(
  handle: DbHandle,
  opts: {
    build: string;
    admin: AdminSpec;
    settings?: Partial<
      Omit<DeploymentSettingsRow, "id" | "createdAt" | "updatedAt">
    >;
  },
): Promise<SeedResult> {
  await bootstrapSchema(handle, { build: opts.build });
  return seedDeployment(handle, {
    admin: opts.admin,
    ...(opts.settings ? { settings: opts.settings } : {}),
  });
}
