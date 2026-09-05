/**
 * Chotu PostgreSQL schema. Built from the dual-dialect helpers in `fields.ts`.
 * Keep every table in lockstep with `sqlite.ts`; `fields.test.ts` enforces
 * column / notNull / primary parity. Constraint expressions may differ per
 * dialect (regex vs glob) as long as they encode the same rule.
 */
import { sql } from "drizzle-orm";
import {
  check,
  index,
  pgTable,
  uniqueIndex,
} from "drizzle-orm/pg-core";

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

export const user = pgTable(
  "user",
  {
    id: f.uuidPk().pg,
    email: f.text("email").pg.notNull(),
    emailVerifiedAt: f.timestamptz("email_verified_at").pg,
    displayName: f.text("display_name").pg.notNull(),
    role: f.text("role").pg.notNull(),
    status: f.text("status").pg.notNull(),
    passwordHash: f.text("password_hash").pg,
    mustChangePassword: f.bool("must_change_password").pg.notNull().default(false),
    unitSystem: f.text("unit_system").pg.notNull(),
    currencyCode: f.text("currency_code").pg.notNull(),
    timeZone: f.text("time_zone").pg.notNull(),
    createdAt: f.timestamptz("created_at").pg.notNull(),
    updatedAt: f.timestamptz("updated_at").pg.notNull(),
    deactivatedAt: f.timestamptz("deactivated_at").pg,
  },
  (t) => [
    uniqueIndex("user_email_lower_uq").on(sql`lower(${t.email})`),
    index("user_active_admin_ix")
      .on(t.role, t.status)
      .where(sql`${t.role} = 'admin' and ${t.status} = 'active'`),
    check("user_role_ck", sql`${t.role} in ('user', 'admin')`),
    check("user_status_ck", sql`${t.status} in ('active', 'deactivated')`),
    check("user_unit_system_ck", sql`${t.unitSystem} in ('imperial', 'metric')`),
    check("user_currency_code_ck", sql`${t.currencyCode} ~ '^[A-Z]{3}$'`),
  ],
);

export const userToken = pgTable(
  "user_token",
  {
    id: f.uuidPk().pg,
    userId: f
      .uuidRef("user_id")
      .pg.notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    purpose: f.text("purpose").pg.notNull(),
    tokenHash: f.text("token_hash").pg.notNull(),
    expiresAt: f.timestamptz("expires_at").pg.notNull(),
    usedAt: f.timestamptz("used_at").pg,
    createdAt: f.timestamptz("created_at").pg.notNull(),
  },
  (t) => [
    uniqueIndex("user_token_hash_uq").on(t.tokenHash),
    uniqueIndex("user_token_one_unused_uq")
      .on(t.userId, t.purpose)
      .where(sql`${t.usedAt} is null`),
    check(
      "user_token_purpose_ck",
      sql`${t.purpose} in ('reset', 'verify', 'set_password')`,
    ),
  ],
);

export const apiToken = pgTable(
  "api_token",
  {
    id: f.uuidPk().pg,
    userId: f
      .uuidRef("user_id")
      .pg.notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    tokenHash: f.text("token_hash").pg.notNull(),
    label: f.text("label").pg,
    createdAt: f.timestamptz("created_at").pg.notNull(),
    lastUsedAt: f.timestamptz("last_used_at").pg,
    expiresAt: f.timestamptz("expires_at").pg,
    revokedAt: f.timestamptz("revoked_at").pg,
  },
  (t) => [uniqueIndex("api_token_hash_uq").on(t.tokenHash)],
);

export const session = pgTable(
  "session",
  {
    id: f.uuidPk().pg,
    tokenHash: f.text("token_hash").pg.notNull(),
    userId: f
      .uuidRef("user_id")
      .pg.notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    createdAt: f.timestamptz("created_at").pg.notNull(),
    lastSeenAt: f.timestamptz("last_seen_at").pg.notNull(),
    expiresAt: f.timestamptz("expires_at").pg.notNull(),
    revokedAt: f.timestamptz("revoked_at").pg,
    userAgent: f.text("user_agent").pg,
    ip: f.text("ip").pg,
  },
  (t) => [uniqueIndex("session_hash_uq").on(t.tokenHash)],
);

export const invitation = pgTable(
  "invitation",
  {
    id: f.uuidPk().pg,
    email: f.text("email").pg.notNull(),
    tokenHash: f.text("token_hash").pg.notNull(),
    invitedRole: f.text("invited_role").pg.notNull(),
    createdBy: f
      .uuidRef("created_by")
      .pg.notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    expiresAt: f.timestamptz("expires_at").pg.notNull(),
    acceptedAt: f.timestamptz("accepted_at").pg,
    acceptedUserId: f
      .uuidRef("accepted_user_id")
      .pg.references(() => user.id, { onDelete: "set null" }),
    createdAt: f.timestamptz("created_at").pg.notNull(),
  },
  (t) => [
    uniqueIndex("invitation_token_hash_uq").on(t.tokenHash),
    uniqueIndex("invitation_pending_email_uq")
      .on(sql`lower(${t.email})`)
      .where(sql`${t.acceptedAt} is null`),
    check("invitation_role_ck", sql`${t.invitedRole} in ('user', 'admin')`),
  ],
);

export const auditLog = pgTable(
  "audit_log",
  {
    id: f.uuidPk().pg,
    actorUserId: f
      .uuidRef("actor_user_id")
      .pg.references(() => user.id, { onDelete: "set null" }),
    action: f.text("action").pg.notNull(),
    targetType: f.text("target_type").pg,
    targetId: f.text("target_id").pg,
    summary: f.text("summary").pg.notNull(),
    metadata: f.json("metadata").pg,
    ip: f.text("ip").pg,
    createdAt: f.timestamptz("created_at").pg.notNull(),
  },
  (t) => [
    index("audit_log_created_at_ix").on(t.createdAt),
    index("audit_log_target_ix").on(t.targetType, t.targetId),
  ],
);
