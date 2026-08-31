import { fileURLToPath } from "node:url";

import { sql } from "drizzle-orm";
import { migrate as migrateSqlite } from "drizzle-orm/better-sqlite3/migrator";
import { migrate as migratePostgres } from "drizzle-orm/postgres-js/migrator";

import { mappers } from "./schema/mappers";
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
  const row = mappers.schemaMeta.toRow(
    {
      id: "singleton",
      schemaVersion: CURRENT_SCHEMA_VERSION,
      appliedAt: new Date(),
      chotuBuild: build,
    },
    handle.dialect,
  );
  await sqlRun(
    handle,
    sql`insert into schema_meta (id, schema_version, applied_at, chotu_build)
        values ('singleton', ${row.schemaVersion as number}, ${row.appliedAt as string | Date}, ${row.chotuBuild as string})
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
