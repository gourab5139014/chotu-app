import type {
  DeploymentSettingsRow,
  InvitationRow,
  UserRow,
} from "../../src/db/schema/types";

/**
 * The `invite` fixture: an admin plus three invitations — pending, expired,
 * and already accepted (with the accepting user present, since
 * `accepted_user_id` is a foreign key). Drives the T6a.2/T6a.3 accept tests.
 * See specs/0001-m1-trusted-fuel-logging/data-model.md "Fixtures".
 */

const T0 = new Date("2026-03-01T00:00:00.000Z");

export const inviteSettings: DeploymentSettingsRow = {
  id: "singleton",
  deploymentName: "Invite Fixture",
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

export const inviteAdmin: UserRow = {
  id: "00000000-0000-7000-8000-0000000c0a01",
  email: "admin@example.com",
  emailVerifiedAt: T0,
  displayName: "Admin",
  role: "admin",
  status: "active",
  passwordHash: "argon2id$invite",
  mustChangePassword: false,
  unitSystem: "imperial",
  currencyCode: "USD",
  timeZone: "America/New_York",
  createdAt: T0,
  updatedAt: T0,
  deactivatedAt: null,
};

export const inviteAcceptedUser: UserRow = {
  id: "00000000-0000-7000-8000-0000000c0b01",
  email: "already-in@example.com",
  emailVerifiedAt: T0,
  displayName: "Already In",
  role: "user",
  status: "active",
  passwordHash: "argon2id$invite",
  mustChangePassword: false,
  unitSystem: "imperial",
  currencyCode: "USD",
  timeZone: "America/New_York",
  createdAt: T0,
  updatedAt: T0,
  deactivatedAt: null,
};

function invitation(over: Partial<InvitationRow>): InvitationRow {
  return {
    id: "00000000-0000-7000-8000-0000000c0000",
    email: "someone@example.com",
    tokenHash: "fixture-hash",
    invitedRole: "user",
    createdBy: inviteAdmin.id,
    expiresAt: new Date(T0.getTime() + 1000 * 60 * 60 * 24 * 7),
    acceptedAt: null,
    acceptedUserId: null,
    createdAt: T0,
    ...over,
  };
}

export const invitePending: InvitationRow = invitation({
  id: "00000000-0000-7000-8000-0000000c0001",
  email: "pending@example.com",
  tokenHash: "fixture-hash-pending",
});

export const inviteExpired: InvitationRow = invitation({
  id: "00000000-0000-7000-8000-0000000c0002",
  email: "expired@example.com",
  tokenHash: "fixture-hash-expired",
  expiresAt: new Date(T0.getTime() - 1000),
});

export const inviteAccepted: InvitationRow = invitation({
  id: "00000000-0000-7000-8000-0000000c0003",
  email: inviteAcceptedUser.email,
  tokenHash: "fixture-hash-accepted",
  acceptedAt: new Date(T0.getTime() + 1000 * 60 * 60),
  acceptedUserId: inviteAcceptedUser.id,
});

export const invite = {
  settings: inviteSettings,
  admin: inviteAdmin,
  acceptedUser: inviteAcceptedUser,
  invitations: [invitePending, inviteExpired, inviteAccepted] as const,
} as const;

export type InviteFixture = typeof invite;
