import { sql } from "drizzle-orm";

import { SEEDED_ADMIN_EMAIL } from "./db/bootstrap";
import { adapterFor, sqlQuery, type DbHandle } from "./db/index";
import type { Env } from "./env";

export class StartupError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "StartupError";
  }
}

/**
 * Guards that must hold before the API serves traffic (FR-1.6, FR-1.10).
 * Development is permissive; production is strict.
 */
export async function assertStartupSafe(
  env: Pick<Env, "CHOTU_ENV" | "DATABASE_URL">,
  handle: DbHandle,
): Promise<void> {
  if (env.CHOTU_ENV !== "production") return;

  if (adapterFor(env.DATABASE_URL) === "sqlite") {
    throw new StartupError(
      "SQLite is a development and test adapter only. Set DATABASE_URL to a PostgreSQL connection for production.",
    );
  }

  const rows = await sqlQuery<{ n: number }>(
    handle,
    sql`select count(*) as n from "user"
        where email = ${SEEDED_ADMIN_EMAIL}
          and role = 'admin'
          and must_change_password = ${handle.dialect === "sqlite" ? 1 : true}`,
  );
  if (Number(rows[0]?.n ?? 0) > 0) {
    throw new StartupError(
      `The seeded admin ${SEEDED_ADMIN_EMAIL} still has its default password. ` +
        "Sign in, change the password, then restart in production mode.",
    );
  }
}
