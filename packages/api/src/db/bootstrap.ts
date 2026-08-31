import { sql } from "drizzle-orm";

import type { DbHandle } from "./index";

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
