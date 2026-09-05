/**
 * Chotu SQLite schema (development and test only). Mirror of `pg.ts`, built
 * from the same helpers in `fields.ts`. `fields.test.ts` enforces column /
 * notNull / primary parity. Constraint expressions differ from PostgreSQL
 * where the dialect requires it (glob instead of regex).
 */
import { sql } from "drizzle-orm";
import {
  check,
  index,
  sqliteTable,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";

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

export const user = sqliteTable(
  "user",
  {
    id: f.uuidPk().sqlite,
    email: f.text("email").sqlite.notNull(),
    emailVerifiedAt: f.timestamptz("email_verified_at").sqlite,
    displayName: f.text("display_name").sqlite.notNull(),
    role: f.text("role").sqlite.notNull(),
    status: f.text("status").sqlite.notNull(),
    passwordHash: f.text("password_hash").sqlite,
    mustChangePassword: f
      .bool("must_change_password")
      .sqlite.notNull()
      .default(false),
    unitSystem: f.text("unit_system").sqlite.notNull(),
    currencyCode: f.text("currency_code").sqlite.notNull(),
    timeZone: f.text("time_zone").sqlite.notNull(),
    createdAt: f.timestamptz("created_at").sqlite.notNull(),
    updatedAt: f.timestamptz("updated_at").sqlite.notNull(),
    deactivatedAt: f.timestamptz("deactivated_at").sqlite,
  },
  (t) => [
    uniqueIndex("user_email_lower_uq").on(sql`lower(${t.email})`),
    index("user_active_admin_ix")
      .on(t.role, t.status)
      .where(sql`${t.role} = 'admin' and ${t.status} = 'active'`),
    check("user_role_ck", sql`${t.role} in ('user', 'admin')`),
    check("user_status_ck", sql`${t.status} in ('active', 'deactivated')`),
    check("user_unit_system_ck", sql`${t.unitSystem} in ('imperial', 'metric')`),
    check(
      "user_currency_code_ck",
      sql`${t.currencyCode} glob '[A-Z][A-Z][A-Z]'`,
    ),
  ],
);

export const userToken = sqliteTable(
  "user_token",
  {
    id: f.uuidPk().sqlite,
    userId: f
      .uuidRef("user_id")
      .sqlite.notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    purpose: f.text("purpose").sqlite.notNull(),
    tokenHash: f.text("token_hash").sqlite.notNull(),
    expiresAt: f.timestamptz("expires_at").sqlite.notNull(),
    usedAt: f.timestamptz("used_at").sqlite,
    createdAt: f.timestamptz("created_at").sqlite.notNull(),
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

export const apiToken = sqliteTable(
  "api_token",
  {
    id: f.uuidPk().sqlite,
    userId: f
      .uuidRef("user_id")
      .sqlite.notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    tokenHash: f.text("token_hash").sqlite.notNull(),
    label: f.text("label").sqlite,
    createdAt: f.timestamptz("created_at").sqlite.notNull(),
    lastUsedAt: f.timestamptz("last_used_at").sqlite,
    expiresAt: f.timestamptz("expires_at").sqlite,
    revokedAt: f.timestamptz("revoked_at").sqlite,
  },
  (t) => [uniqueIndex("api_token_hash_uq").on(t.tokenHash)],
);

export const session = sqliteTable(
  "session",
  {
    id: f.uuidPk().sqlite,
    tokenHash: f.text("token_hash").sqlite.notNull(),
    userId: f
      .uuidRef("user_id")
      .sqlite.notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    createdAt: f.timestamptz("created_at").sqlite.notNull(),
    lastSeenAt: f.timestamptz("last_seen_at").sqlite.notNull(),
    expiresAt: f.timestamptz("expires_at").sqlite.notNull(),
    revokedAt: f.timestamptz("revoked_at").sqlite,
    userAgent: f.text("user_agent").sqlite,
    ip: f.text("ip").sqlite,
  },
  (t) => [uniqueIndex("session_hash_uq").on(t.tokenHash)],
);

export const invitation = sqliteTable(
  "invitation",
  {
    id: f.uuidPk().sqlite,
    email: f.text("email").sqlite.notNull(),
    tokenHash: f.text("token_hash").sqlite.notNull(),
    invitedRole: f.text("invited_role").sqlite.notNull(),
    createdBy: f
      .uuidRef("created_by")
      .sqlite.notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    expiresAt: f.timestamptz("expires_at").sqlite.notNull(),
    acceptedAt: f.timestamptz("accepted_at").sqlite,
    acceptedUserId: f
      .uuidRef("accepted_user_id")
      .sqlite.references(() => user.id, { onDelete: "set null" }),
    createdAt: f.timestamptz("created_at").sqlite.notNull(),
  },
  (t) => [
    uniqueIndex("invitation_token_hash_uq").on(t.tokenHash),
    uniqueIndex("invitation_pending_email_uq")
      .on(sql`lower(${t.email})`)
      .where(sql`${t.acceptedAt} is null`),
    check("invitation_role_ck", sql`${t.invitedRole} in ('user', 'admin')`),
  ],
);

export const auditLog = sqliteTable(
  "audit_log",
  {
    id: f.uuidPk().sqlite,
    actorUserId: f
      .uuidRef("actor_user_id")
      .sqlite.references(() => user.id, { onDelete: "set null" }),
    action: f.text("action").sqlite.notNull(),
    targetType: f.text("target_type").sqlite,
    targetId: f.text("target_id").sqlite,
    summary: f.text("summary").sqlite.notNull(),
    metadata: f.json("metadata").sqlite,
    ip: f.text("ip").sqlite,
    createdAt: f.timestamptz("created_at").sqlite.notNull(),
  },
  (t) => [
    index("audit_log_created_at_ix").on(t.createdAt),
    index("audit_log_target_ix").on(t.targetType, t.targetId),
  ],
);

export const oidcProvider = sqliteTable(
  "oidc_provider",
  {
    id: f.uuidPk().sqlite,
    key: f.text("key").sqlite.notNull(),
    displayName: f.text("display_name").sqlite.notNull(),
    issuerUrl: f.text("issuer_url").sqlite.notNull(),
    clientId: f.text("client_id").sqlite.notNull(),
    // Environment reference, e.g. "env:MY_PROVIDER_SECRET" (D-5, R-3). Never
    // returned once written — write-only over the API (FR-9.3).
    clientSecretRef: f.text("client_secret_ref").sqlite.notNull(),
    scopes: f.json("scopes").sqlite.notNull(),
    allowedEmailDomains: f.json("allowed_email_domains").sqlite,
    allowedGroups: f.json("allowed_groups").sqlite,
    autoProvision: f.bool("auto_provision").sqlite.notNull().default(false),
    enabled: f.bool("enabled").sqlite.notNull().default(true),
    createdAt: f.timestamptz("created_at").sqlite.notNull(),
    updatedAt: f.timestamptz("updated_at").sqlite.notNull(),
  },
  (t) => [
    uniqueIndex("oidc_provider_key_uq").on(t.key),
    check(
      "oidc_provider_key_ck",
      sql`length(${t.key}) between 1 and 40 and ${t.key} not glob '*[^a-z0-9-]*'`,
    ),
  ],
);

export const oidcLogin = sqliteTable(
  "oidc_login",
  {
    id: f.uuidPk().sqlite,
    providerKey: f
      .text("provider_key")
      .sqlite.notNull()
      .references(() => oidcProvider.key, { onDelete: "cascade" }),
    stateHash: f.text("state_hash").sqlite.notNull(),
    codeVerifier: f.text("code_verifier").sqlite.notNull(),
    nonce: f.text("nonce").sqlite,
    redirectTo: f.text("redirect_to").sqlite,
    // Set only for an account-link attempt (Chotu extension beyond the
    // data-model draft — see plan.md section 8 / T7.4): the signed-in user
    // linking a new identity, captured at /start since /callback carries no
    // caller credential.
    linkUserId: f
      .uuidRef("link_user_id")
      .sqlite.references(() => user.id, { onDelete: "cascade" }),
    expiresAt: f.timestamptz("expires_at").sqlite.notNull(),
    consumedAt: f.timestamptz("consumed_at").sqlite,
    createdAt: f.timestamptz("created_at").sqlite.notNull(),
  },
  (t) => [uniqueIndex("oidc_login_state_hash_uq").on(t.stateHash)],
);

export const identity = sqliteTable(
  "identity",
  {
    id: f.uuidPk().sqlite,
    userId: f
      .uuidRef("user_id")
      .sqlite.notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    providerKey: f
      .text("provider_key")
      .sqlite.notNull()
      .references(() => oidcProvider.key, { onDelete: "restrict" }),
    subject: f.text("subject").sqlite.notNull(),
    emailAtLink: f.text("email_at_link").sqlite,
    createdAt: f.timestamptz("created_at").sqlite.notNull(),
    lastLoginAt: f.timestamptz("last_login_at").sqlite,
  },
  (t) => [
    uniqueIndex("identity_provider_subject_uq").on(t.providerKey, t.subject),
    index("identity_user_ix").on(t.userId),
  ],
);

export const vehicle = sqliteTable(
  "vehicle",
  {
    id: f.uuidPk().sqlite,
    userId: f
      .uuidRef("user_id")
      .sqlite.notNull()
      .references(() => user.id, { onDelete: "restrict" }),
    name: f.text("name").sqlite.notNull(),
    make: f.text("make").sqlite,
    model: f.text("model").sqlite,
    year: f.intNum("year").sqlite,
    fuelType: f.text("fuel_type").sqlite,
    initialOdometerMiE3: f.bigintNum("initial_odometer_mi_e3").sqlite.notNull(),
    archivedAt: f.timestamptz("archived_at").sqlite,
    createdAt: f.timestamptz("created_at").sqlite.notNull(),
    updatedAt: f.timestamptz("updated_at").sqlite.notNull(),
  },
  (t) => [
    uniqueIndex("vehicle_user_name_active_uq")
      .on(t.userId, t.name)
      .where(sql`${t.archivedAt} is null`),
    index("vehicle_user_archived_ix").on(t.userId, t.archivedAt),
    check("vehicle_initial_odometer_ck", sql`${t.initialOdometerMiE3} >= 0`),
    check("vehicle_year_ck", sql`${t.year} is null or ${t.year} between 1900 and 2100`),
    check(
      "vehicle_fuel_type_ck",
      sql`${t.fuelType} is null or ${t.fuelType} in ('gasoline', 'diesel', 'ev', 'hybrid', 'other')`,
    ),
  ],
);
