import { CURRENT_SCHEMA_VERSION } from "../db/schema/version";
import type {
  FuelEntryRow,
  UserRow,
  VehicleRow,
} from "../db/schema/types";
import type { Repos } from "../domain/ports";

/**
 * One documented JSON document per FR-16 / FR-18. `schemaVersion` and
 * `canonicalUnits` let a later importer read the meaningful digits (FR-16.2);
 * `fuelVolumePrecision` records the deployment's configured display precision.
 * Import is out of M1 — this only has to be complete enough to rebuild later
 * (FR-16.3). Q-6 = A (one schema-versioned JSON doc).
 */

export const EXPORT_FORMAT_VERSION = 1;

const CANONICAL_UNITS = {
  distance: "mi_e3",
  volume: "gal_e3",
  money: "usd_cents",
} as const;

function isoOrNull(d: Date | null): string | null {
  return d?.toISOString() ?? null;
}

function vehicleOut(v: VehicleRow) {
  return {
    id: v.id,
    userId: v.userId,
    name: v.name,
    make: v.make,
    model: v.model,
    year: v.year,
    fuelType: v.fuelType,
    initialOdometerMiE3: v.initialOdometerMiE3,
    archivedAt: isoOrNull(v.archivedAt),
    createdAt: v.createdAt.toISOString(),
    updatedAt: v.updatedAt.toISOString(),
  };
}

function entryOut(e: FuelEntryRow) {
  return {
    id: e.id,
    vehicleId: e.vehicleId,
    entryDate: e.entryDate,
    odometerMiE3: e.odometerMiE3,
    volumeGalE3: e.volumeGalE3,
    totalCostUsdCents: e.totalCostUsdCents,
    currencyCode: e.currencyCode,
    isFullTank: e.isFullTank,
    notes: e.notes,
    sourceUnitSystem: e.sourceUnitSystem,
    sourcePayload: e.sourcePayload,
    createdAt: e.createdAt.toISOString(),
    updatedAt: e.updatedAt.toISOString(),
  };
}

function profileOut(u: UserRow) {
  return {
    id: u.id,
    email: u.email,
    displayName: u.displayName,
    role: u.role,
    status: u.status,
    unitSystem: u.unitSystem,
    currencyCode: u.currencyCode,
    timeZone: u.timeZone,
    emailVerifiedAt: isoOrNull(u.emailVerifiedAt),
    createdAt: u.createdAt.toISOString(),
    updatedAt: u.updatedAt.toISOString(),
  };
}

function envelope() {
  return {
    exportFormatVersion: EXPORT_FORMAT_VERSION,
    schemaVersion: CURRENT_SCHEMA_VERSION,
    canonicalUnits: CANONICAL_UNITS,
    exportedAt: new Date().toISOString(),
  };
}

/** A user's own data (FR-16). */
export async function buildUserExport(repos: Repos, user: UserRow) {
  const [vehicles, entries, settings] = await Promise.all([
    repos.vehicles.listForUser(user.id),
    repos.fuelEntries.listForUser(user.id),
    repos.settings.get(),
  ]);
  return {
    ...envelope(),
    fuelVolumePrecision: settings?.fuelVolumePrecision ?? 3,
    profile: profileOut(user),
    vehicles: vehicles.map(vehicleOut),
    fuelEntries: entries.map(entryOut),
  };
}

/**
 * A full deployment backup (FR-18.1). All substantive tables. Credential
 * material — password hashes, token hashes, OIDC login state, live sessions —
 * is left out (never emitted, even as a hash); a restore re-issues those
 * (FR-18.2, restore tooling out of M1). `client_secret_ref` is an environment
 * reference, not a secret, so it stays.
 */
export async function buildAdminExport(repos: Repos) {
  const [settings, users, vehicles, entries, providers, invitations, identities, audit] =
    await Promise.all([
      repos.settings.get(),
      repos.users.list(),
      repos.vehicles.listAll(),
      repos.fuelEntries.listAll(),
      repos.oidcProviders.list(),
      repos.invitations.listAll(),
      repos.identities.listAll(),
      repos.audit.list({}),
    ]);

  return {
    ...envelope(),
    fuelVolumePrecision: settings?.fuelVolumePrecision ?? 3,
    deploymentSettings:
      settings == null
        ? null
        : {
            deploymentName: settings.deploymentName,
            registrationPolicy: settings.registrationPolicy,
            allowedAuthMethods: settings.allowedAuthMethods,
            defaultUnitSystem: settings.defaultUnitSystem,
            defaultCurrencyCode: settings.defaultCurrencyCode,
            defaultTimeZone: settings.defaultTimeZone,
            fuelVolumePrecision: settings.fuelVolumePrecision,
            sessionTtlSeconds: settings.sessionTtlSeconds,
            apiTokenTtlSeconds: settings.apiTokenTtlSeconds,
            createdAt: settings.createdAt.toISOString(),
            updatedAt: settings.updatedAt.toISOString(),
          },
    users: users.map(profileOut),
    oidcProviders: providers.map((p) => ({
      id: p.id,
      key: p.key,
      displayName: p.displayName,
      issuerUrl: p.issuerUrl,
      clientId: p.clientId,
      clientSecretRef: p.clientSecretRef,
      scopes: p.scopes,
      allowedEmailDomains: p.allowedEmailDomains,
      allowedGroups: p.allowedGroups,
      autoProvision: p.autoProvision,
      enabled: p.enabled,
      createdAt: p.createdAt.toISOString(),
      updatedAt: p.updatedAt.toISOString(),
    })),
    identities: identities.map((i) => ({
      id: i.id,
      userId: i.userId,
      providerKey: i.providerKey,
      subject: i.subject,
      emailAtLink: i.emailAtLink,
      createdAt: i.createdAt.toISOString(),
      lastLoginAt: isoOrNull(i.lastLoginAt),
    })),
    invitations: invitations.map((inv) => ({
      id: inv.id,
      email: inv.email,
      invitedRole: inv.invitedRole,
      createdBy: inv.createdBy,
      expiresAt: inv.expiresAt.toISOString(),
      acceptedAt: isoOrNull(inv.acceptedAt),
      acceptedUserId: inv.acceptedUserId,
      createdAt: inv.createdAt.toISOString(),
    })),
    vehicles: vehicles.map(vehicleOut),
    fuelEntries: entries.map(entryOut),
    auditLog: audit.map((row) => ({
      id: row.id,
      actorUserId: row.actorUserId,
      action: row.action,
      targetType: row.targetType,
      targetId: row.targetId,
      summary: row.summary,
      metadata: row.metadata,
      ip: row.ip,
      createdAt: row.createdAt.toISOString(),
    })),
  };
}
