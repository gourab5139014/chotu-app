/* eslint-disable @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access -- one dialect-agnostic integration test driving both Drizzle query builders */
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { mappers } from "../../src/db/schema/mappers";
import * as pgSchema from "../../src/db/schema/pg";
import * as sqliteSchema from "../../src/db/schema/sqlite";
import type {
  ApiTokenRow,
  DeploymentSettingsRow,
  SchemaMetaRow,
  SessionRow,
  UserRow,
  UserTokenRow,
} from "../../src/db/schema/types";
import { openMigratedPostgres } from "../support/postgres";
import { openMigratedSqlite } from "../support/sqlite";

const at = (iso: string) => new Date(iso);

const META: SchemaMetaRow = {
  id: "singleton",
  schemaVersion: 1,
  appliedAt: at("2026-01-02T03:04:05.000Z"),
  chotuBuild: "test-build",
};

const SETTINGS: DeploymentSettingsRow = {
  id: "singleton",
  deploymentName: "Round Trip",
  registrationPolicy: "invite_only",
  allowedAuthMethods: ["password", "oidc"],
  defaultUnitSystem: "imperial",
  defaultCurrencyCode: "USD",
  defaultTimeZone: "America/New_York",
  fuelVolumePrecision: 3,
  sessionTtlSeconds: 3600,
  apiTokenTtlSeconds: null,
  createdAt: at("2026-01-01T00:00:00.000Z"),
  updatedAt: at("2026-01-01T00:00:00.000Z"),
};

const USER: UserRow = {
  id: "00000000-0000-7000-8000-000000000001",
  email: "rt@example.com",
  emailVerifiedAt: null,
  displayName: "Round Trip",
  role: "admin",
  status: "active",
  passwordHash: "argon2id$dummy",
  mustChangePassword: false,
  unitSystem: "imperial",
  currencyCode: "USD",
  timeZone: "America/New_York",
  createdAt: at("2026-01-01T00:00:00.000Z"),
  updatedAt: at("2026-01-02T00:00:00.000Z"),
  deactivatedAt: null,
};

const USER_TOKEN: UserTokenRow = {
  id: "00000000-0000-7000-8000-000000000002",
  userId: USER.id,
  purpose: "reset",
  tokenHash: "hash-ut",
  expiresAt: at("2026-01-03T00:00:00.000Z"),
  usedAt: null,
  createdAt: at("2026-01-01T00:00:00.000Z"),
};

const API_TOKEN: ApiTokenRow = {
  id: "00000000-0000-7000-8000-000000000003",
  userId: USER.id,
  tokenHash: "hash-at",
  label: "cli",
  createdAt: at("2026-01-01T00:00:00.000Z"),
  lastUsedAt: null,
  expiresAt: null,
  revokedAt: null,
};

const SESSION: SessionRow = {
  id: "00000000-0000-7000-8000-000000000004",
  tokenHash: "hash-s",
  userId: USER.id,
  createdAt: at("2026-01-01T00:00:00.000Z"),
  lastSeenAt: at("2026-01-01T01:00:00.000Z"),
  expiresAt: at("2026-01-01T02:00:00.000Z"),
  revokedAt: null,
  userAgent: "vitest",
  ip: "127.0.0.1",
};

interface Ctx {
  name: "sqlite" | "postgres";
  db: any;
  schema: typeof sqliteSchema;
  cleanup(): Promise<void>;
}

async function runRoundTrips(ctx: Ctx): Promise<void> {
  const { db, schema } = ctx;
  const a = ctx.name;

  await db.insert(schema.schemaMeta).values(mappers.schemaMeta.toRow(META, a));
  await db
    .insert(schema.deploymentSettings)
    .values(mappers.deploymentSettings.toRow(SETTINGS, a));
  await db.insert(schema.user).values(mappers.user.toRow(USER, a));
  await db
    .insert(schema.userToken)
    .values(mappers.userToken.toRow(USER_TOKEN, a));
  await db.insert(schema.apiToken).values(mappers.apiToken.toRow(API_TOKEN, a));
  await db.insert(schema.session).values(mappers.session.toRow(SESSION, a));

  const [meta] = await db.select().from(schema.schemaMeta);
  expect(mappers.schemaMeta.toDomain(meta)).toEqual(META);

  const [settings] = await db.select().from(schema.deploymentSettings);
  expect(mappers.deploymentSettings.toDomain(settings)).toEqual(SETTINGS);

  const [user] = await db
    .select()
    .from(schema.user)
    .where(eq(schema.user.id, USER.id));
  expect(mappers.user.toDomain(user)).toEqual(USER);

  const [ut] = await db.select().from(schema.userToken);
  expect(mappers.userToken.toDomain(ut)).toEqual(USER_TOKEN);

  const [apt] = await db.select().from(schema.apiToken);
  expect(mappers.apiToken.toDomain(apt)).toEqual(API_TOKEN);

  const [sess] = await db.select().from(schema.session);
  expect(mappers.session.toDomain(sess)).toEqual(SESSION);
}

describe("row mappers round-trip (SQLite)", () => {
  let ctx: Ctx;

  beforeAll(() => {
    const mig = openMigratedSqlite();
    ctx = {
      name: "sqlite",
      db: mig.handle.db,
      schema: sqliteSchema,
      cleanup: () => mig.cleanup(),
    };
  });

  afterAll(() => ctx?.cleanup());

  it("every slice-2 table round-trips through the mappers", async () => {
    await runRoundTrips(ctx);
  });
});

const pgUrl = process.env["DATABASE_URL"];
const hasPg = typeof pgUrl === "string" && pgUrl.startsWith("postgres");

describe.skipIf(!hasPg)("row mappers round-trip (PostgreSQL)", () => {
  let ctx: Ctx;

  beforeAll(async () => {
    const mig = await openMigratedPostgres(pgUrl as string);
    ctx = {
      name: "postgres",
      db: mig.handle.db,
      schema: pgSchema as unknown as typeof sqliteSchema,
      cleanup: () => mig.cleanup(),
    };
  });

  afterAll(() => ctx?.cleanup());

  it("every slice-2 table round-trips through the mappers", async () => {
    await runRoundTrips(ctx);
  });
});
