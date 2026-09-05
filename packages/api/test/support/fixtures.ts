/* eslint-disable @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access -- direct full-privilege seed over both Drizzle dialects */
import { mappers } from "../../src/db/schema/mappers";
import * as pgSchema from "../../src/db/schema/pg";
import * as sqliteSchema from "../../src/db/schema/sqlite";
import type { DbHandle } from "../../src/db/index";

import { clean, type CleanFixture } from "../fixtures/clean";
import { invite, type InviteFixture } from "../fixtures/invite";
import { lastAdmin, type LastAdminFixture } from "../fixtures/last-admin";

export { clean, invite, lastAdmin };
export type { CleanFixture, InviteFixture, LastAdminFixture };

/**
 * Seed a fixture into a migrated database with the full-privilege test
 * connection (not an API role) and the exact rows as defined — timestamps and
 * all. Fixtures that must bypass a constraint (e.g. `orphaned`) get a
 * lower-level path when those tables exist.
 */
export async function loadClean(handle: DbHandle): Promise<CleanFixture> {
  const db: any = handle.db;
  const a = handle.dialect;
  const s: typeof sqliteSchema =
    a === "postgres"
      ? (pgSchema as unknown as typeof sqliteSchema)
      : sqliteSchema;

  await db
    .insert(s.deploymentSettings)
    .values(mappers.deploymentSettings.toRow(clean.settings, a));
  await db.insert(s.user).values(mappers.user.toRow(clean.admin, a));
  for (const u of clean.users) {
    await db.insert(s.user).values(mappers.user.toRow(u, a));
  }
  return clean;
}

/** Seed the `last-admin` fixture (INV-6 tests). */
export async function loadLastAdmin(
  handle: DbHandle,
): Promise<LastAdminFixture> {
  const db: any = handle.db;
  const a = handle.dialect;
  const s: typeof sqliteSchema =
    a === "postgres"
      ? (pgSchema as unknown as typeof sqliteSchema)
      : sqliteSchema;

  await db
    .insert(s.deploymentSettings)
    .values(mappers.deploymentSettings.toRow(lastAdmin.settings, a));
  for (const u of [...lastAdmin.admins, lastAdmin.regular]) {
    await db.insert(s.user).values(mappers.user.toRow(u, a));
  }
  return lastAdmin;
}

/** Seed the `invite` fixture: pending, expired, and accepted invitations. */
export async function loadInvite(handle: DbHandle): Promise<InviteFixture> {
  const db: any = handle.db;
  const a = handle.dialect;
  const s: typeof sqliteSchema =
    a === "postgres"
      ? (pgSchema as unknown as typeof sqliteSchema)
      : sqliteSchema;

  await db
    .insert(s.deploymentSettings)
    .values(mappers.deploymentSettings.toRow(invite.settings, a));
  await db.insert(s.user).values(mappers.user.toRow(invite.admin, a));
  await db.insert(s.user).values(mappers.user.toRow(invite.acceptedUser, a));
  for (const inv of invite.invitations) {
    await db.insert(s.invitation).values(mappers.invitation.toRow(inv, a));
  }
  return invite;
}
