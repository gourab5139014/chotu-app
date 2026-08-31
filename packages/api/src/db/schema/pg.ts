/**
 * Chotu PostgreSQL schema. Built from the dual-dialect helpers in `fields.ts`.
 * Keep every table in lockstep with `sqlite.ts`; `fields.test.ts` enforces it.
 */
import { sql } from "drizzle-orm";
import { check, pgTable } from "drizzle-orm/pg-core";

import * as f from "./fields";

export const schemaMeta = pgTable("schema_meta", {
  id: f.singletonId().pg,
  schemaVersion: f.intNum("schema_version").pg.notNull(),
  appliedAt: f.timestamptz("applied_at").pg.notNull(),
  chotuBuild: f.text("chotu_build").pg.notNull(),
});

export const deploymentSettings = pgTable(
  "deployment_settings",
  {
    id: f.singletonId().pg,
    deploymentName: f.text("deployment_name").pg.notNull(),
    registrationPolicy: f.text("registration_policy").pg.notNull(),
    allowedAuthMethods: f.json("allowed_auth_methods").pg.notNull(),
    defaultUnitSystem: f.text("default_unit_system").pg.notNull(),
    defaultCurrencyCode: f.text("default_currency_code").pg.notNull(),
    defaultTimeZone: f.text("default_time_zone").pg.notNull(),
    fuelVolumePrecision: f.intNum("fuel_volume_precision").pg.notNull(),
    sessionTtlSeconds: f.intNum("session_ttl_seconds").pg.notNull(),
    apiTokenTtlSeconds: f.intNum("api_token_ttl_seconds").pg,
    createdAt: f.timestamptz("created_at").pg.notNull(),
    updatedAt: f.timestamptz("updated_at").pg.notNull(),
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
