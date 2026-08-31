/**
 * Chotu SQLite schema (development and test only). Mirror of `pg.ts`, built
 * from the same helpers in `fields.ts`. `fields.test.ts` enforces parity.
 */
import { sql } from "drizzle-orm";
import { check, sqliteTable } from "drizzle-orm/sqlite-core";

import * as f from "./fields";

export const schemaMeta = sqliteTable("schema_meta", {
  id: f.singletonId().sqlite,
  schemaVersion: f.intNum("schema_version").sqlite.notNull(),
  appliedAt: f.timestamptz("applied_at").sqlite.notNull(),
  chotuBuild: f.text("chotu_build").sqlite.notNull(),
});

export const deploymentSettings = sqliteTable(
  "deployment_settings",
  {
    id: f.singletonId().sqlite,
    deploymentName: f.text("deployment_name").sqlite.notNull(),
    registrationPolicy: f.text("registration_policy").sqlite.notNull(),
    allowedAuthMethods: f.json("allowed_auth_methods").sqlite.notNull(),
    defaultUnitSystem: f.text("default_unit_system").sqlite.notNull(),
    defaultCurrencyCode: f.text("default_currency_code").sqlite.notNull(),
    defaultTimeZone: f.text("default_time_zone").sqlite.notNull(),
    fuelVolumePrecision: f.intNum("fuel_volume_precision").sqlite.notNull(),
    sessionTtlSeconds: f.intNum("session_ttl_seconds").sqlite.notNull(),
    apiTokenTtlSeconds: f.intNum("api_token_ttl_seconds").sqlite,
    createdAt: f.timestamptz("created_at").sqlite.notNull(),
    updatedAt: f.timestamptz("updated_at").sqlite.notNull(),
  },
  (t) => [
    check(
      "deployment_settings_registration_policy_ck",
      sql`${t.registrationPolicy} in ('invite_only', 'open', 'sso_auto')`,
    ),
    check(
      "deployment_settings_default_unit_system_ck",
      sql`${t.defaultUnitSystem} in ('imperial', 'metric')`,
    ),
    check(
      "deployment_settings_fuel_volume_precision_ck",
      sql`${t.fuelVolumePrecision} between 1 and 3`,
    ),
  ],
);
