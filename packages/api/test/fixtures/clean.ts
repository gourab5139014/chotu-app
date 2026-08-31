import type {
  DeploymentSettingsRow,
  UserRow,
} from "../../src/db/schema/types";

/**
 * The `clean` fixture: a valid deployment with one admin and two regular users.
 * Reconciliation must return no findings against it. Vehicles and fuel entries
 * are added to this fixture when those tables land (slices 8-9).
 * See specs/0001-m1-trusted-fuel-logging/data-model.md "Fixtures".
 */

const T0 = new Date("2026-01-01T00:00:00.000Z");

export const cleanSettings: DeploymentSettingsRow = {
  id: "singleton",
  deploymentName: "Clean Fixture",
  registrationPolicy: "invite_only",
  allowedAuthMethods: ["password"],
  defaultUnitSystem: "imperial",
  defaultCurrencyCode: "USD",
  defaultTimeZone: "America/New_York",
  fuelVolumePrecision: 3,
  sessionTtlSeconds: 3600,
  apiTokenTtlSeconds: null,
  createdAt: T0,
  updatedAt: T0,
};

function user(over: Partial<UserRow>): UserRow {
  return {
    id: "00000000-0000-7000-8000-000000000000",
    email: "user@example.com",
    emailVerifiedAt: T0,
    displayName: "User",
    role: "user",
    status: "active",
    passwordHash: "argon2id$clean",
    mustChangePassword: false,
    unitSystem: "imperial",
    currencyCode: "USD",
    timeZone: "America/New_York",
    createdAt: T0,
    updatedAt: T0,
    deactivatedAt: null,
    ...over,
  };
}

export const cleanAdmin: UserRow = user({
  id: "00000000-0000-7000-8000-0000000000a1",
  email: "admin@example.com",
  displayName: "Admin",
  role: "admin",
});

export const cleanUsers: readonly UserRow[] = [
  user({
    id: "00000000-0000-7000-8000-0000000000b1",
    email: "alice@example.com",
    displayName: "Alice",
  }),
  user({
    id: "00000000-0000-7000-8000-0000000000b2",
    email: "bob@example.com",
    displayName: "Bob",
  }),
];

export const clean = {
  settings: cleanSettings,
  admin: cleanAdmin,
  users: cleanUsers,
} as const;

export type CleanFixture = typeof clean;
