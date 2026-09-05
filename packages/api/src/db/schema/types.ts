/**
 * Canonical row and insert types for the domain layer.
 *
 * The PostgreSQL and SQLite Drizzle schemas infer *different* TypeScript types
 * for the same table (Date vs ISO string, boolean vs 0/1, typed jsonb vs
 * string). The domain never touches those. It uses the shapes here, and the
 * per-table row mappers (T2.6) convert each adapter's rows to and from them.
 *
 * Conventions: instants are `Date`; calendar dates are `YYYY-MM-DD` strings;
 * 64-bit integers are `number`; nullable columns are `T | null`, never
 * optional.
 */

export type AuthMethod = "password" | "oidc";
export type RegistrationPolicy = "invite_only" | "open" | "sso_auto";
export type UnitSystem = "imperial" | "metric";
export type UserRole = "user" | "admin";
export type UserStatus = "active" | "deactivated";
export type UserTokenPurpose = "reset" | "verify" | "set_password";

export interface SchemaMetaRow {
  id: "singleton";
  schemaVersion: number;
  appliedAt: Date;
  chotuBuild: string;
}

export interface DeploymentSettingsRow {
  id: "singleton";
  deploymentName: string;
  registrationPolicy: RegistrationPolicy;
  allowedAuthMethods: AuthMethod[];
  defaultUnitSystem: UnitSystem;
  defaultCurrencyCode: string;
  defaultTimeZone: string;
  fuelVolumePrecision: number;
  sessionTtlSeconds: number;
  apiTokenTtlSeconds: number | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface UserRow {
  id: string;
  email: string;
  emailVerifiedAt: Date | null;
  displayName: string;
  role: UserRole;
  status: UserStatus;
  passwordHash: string | null;
  mustChangePassword: boolean;
  unitSystem: UnitSystem;
  currencyCode: string;
  timeZone: string;
  createdAt: Date;
  updatedAt: Date;
  deactivatedAt: Date | null;
}

export interface UserTokenRow {
  id: string;
  userId: string;
  purpose: UserTokenPurpose;
  tokenHash: string;
  expiresAt: Date;
  usedAt: Date | null;
  createdAt: Date;
}

export interface ApiTokenRow {
  id: string;
  userId: string;
  tokenHash: string;
  label: string | null;
  createdAt: Date;
  lastUsedAt: Date | null;
  expiresAt: Date | null;
  revokedAt: Date | null;
}

export interface SessionRow {
  id: string;
  tokenHash: string;
  userId: string;
  createdAt: Date;
  lastSeenAt: Date;
  expiresAt: Date;
  revokedAt: Date | null;
  userAgent: string | null;
  ip: string | null;
}

export interface InvitationRow {
  id: string;
  /** Lower-cased. */
  email: string;
  tokenHash: string;
  invitedRole: UserRole;
  createdBy: string;
  expiresAt: Date;
  acceptedAt: Date | null;
  acceptedUserId: string | null;
  createdAt: Date;
}

export interface AuditLogRow {
  id: string;
  /** The admin or user who acted. Null for a system action. */
  actorUserId: string | null;
  /** Stable code, for example `user.invited` or `role.granted`. */
  action: string;
  targetType: string | null;
  targetId: string | null;
  summary: string;
  /** Structured detail. Never a secret. */
  metadata: Record<string, unknown> | null;
  ip: string | null;
  createdAt: Date;
}

/** Insert shapes: audit timestamps are set by the repository, not the caller. */
export type NewUser = Omit<UserRow, "createdAt" | "updatedAt">;
export type NewUserToken = Omit<UserTokenRow, "createdAt" | "usedAt"> & {
  usedAt?: Date | null;
};
export type NewApiToken = Omit<
  ApiTokenRow,
  "createdAt" | "lastUsedAt" | "revokedAt"
>;
export type NewSession = Omit<SessionRow, "createdAt" | "lastSeenAt">;
/** `id` is optional here — the repository fills it when absent. */
export type NewAuditLog = Omit<AuditLogRow, "id" | "createdAt"> & {
  id?: string;
};
export type NewInvitation = Omit<
  InvitationRow,
  "createdAt" | "acceptedAt" | "acceptedUserId"
>;
