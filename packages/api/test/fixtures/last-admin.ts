import type {
  DeploymentSettingsRow,
  UserRow,
} from "../../src/db/schema/types";

/**
 * The `last-admin` fixture: two active admins, one deactivated admin, and one
 * regular user. It drives the INV-6 tests — demoting, deactivating, or
 * deleting either active admin must be refused once only one active admin is
 * left, and a race between the two must never reach zero.
 * See specs/0001-m1-trusted-fuel-logging/data-model.md "Fixtures".
 */

const T0 = new Date("2026-02-01T00:00:00.000Z");

export const lastAdminSettings: DeploymentSettingsRow = {
  id: "singleton",
  deploymentName: "Last Admin Fixture",
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
    email: "x@example.com",
    emailVerifiedAt: T0,
    displayName: "X",
    role: "user",
    status: "active",
    passwordHash: "argon2id$last-admin",
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

export const lastAdminA: UserRow = user({
  id: "00000000-0000-7000-8000-00000000aa01",
  email: "admin-a@example.com",
  displayName: "Admin A",
  role: "admin",
});

export const lastAdminB: UserRow = user({
  id: "00000000-0000-7000-8000-00000000aa02",
  email: "admin-b@example.com",
  displayName: "Admin B",
  role: "admin",
});

export const lastAdminDeactivated: UserRow = user({
  id: "00000000-0000-7000-8000-00000000aa03",
  email: "admin-c@example.com",
  displayName: "Admin C (deactivated)",
  role: "admin",
  status: "deactivated",
  deactivatedAt: T0,
});

export const lastAdminRegular: UserRow = user({
  id: "00000000-0000-7000-8000-00000000bb01",
  email: "member@example.com",
  displayName: "Member",
});

export const lastAdmin = {
  settings: lastAdminSettings,
  admins: [lastAdminA, lastAdminB, lastAdminDeactivated] as const,
  regular: lastAdminRegular,
} as const;

export type LastAdminFixture = typeof lastAdmin;
