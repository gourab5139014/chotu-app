/* eslint-disable @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-return -- one repo layer over both Drizzle dialects; ports.ts is the typed boundary */
import { and, desc, eq, isNull, lte, sql } from "drizzle-orm";

import { err } from "../domain/errors";
import { newId } from "../domain/id";

import { mappers } from "./schema/mappers";
import * as pgSchema from "./schema/pg";
import * as sqliteSchema from "./schema/sqlite";
import type {
  ApiTokenRow,
  AuditLogRow,
  DeploymentSettingsRow,
  IdentityRow,
  InvitationRow,
  NewApiToken,
  NewAuditLog,
  NewIdentity,
  NewInvitation,
  NewOidcLogin,
  NewOidcProvider,
  NewSession,
  NewUser,
  NewUserToken,
  OidcLoginRow,
  OidcProviderRow,
  SchemaMetaRow,
  SessionRow,
  UserRow,
  UserTokenRow,
} from "./schema/types";
import type { Adapter, DbHandle } from "./index";
import type { Tx } from "./uow";
import type { Repos } from "../domain/ports";

const SINGLETON = "singleton";

function first<T>(rows: unknown[], toDomain: (r: any) => T): T | null {
  const row = rows[0];
  return row == null ? null : toDomain(row);
}

export function makeRepos(handle: DbHandle): Repos {
  const db: any = handle.db;
  const a: Adapter = handle.dialect;
  const s: typeof sqliteSchema =
    a === "postgres" ? (pgSchema as unknown as typeof sqliteSchema) : sqliteSchema;

  const now = (): Date => new Date();
  const returningAll = (q: any): any =>
    a === "postgres" ? q.returning() : q.returning();

  return {
    schemaMeta: {
      async get() {
        const rows = await db.select().from(s.schemaMeta).limit(1);
        return first<SchemaMetaRow>(rows, mappers.schemaMeta.toDomain);
      },
      async set(row) {
        await db
          .insert(s.schemaMeta)
          .values(mappers.schemaMeta.toRow(row, a))
          .onConflictDoUpdate({
            target: s.schemaMeta.id,
            set: mappers.schemaMeta.toRow(row, a),
          });
        return row;
      },
    },

    settings: {
      async get() {
        const rows = await db.select().from(s.deploymentSettings).limit(1);
        return first<DeploymentSettingsRow>(
          rows,
          mappers.deploymentSettings.toDomain,
        );
      },
      async create(row) {
        await db
          .insert(s.deploymentSettings)
          .values(mappers.deploymentSettings.toRow(row, a));
        return row;
      },
      async update(patch) {
        const values = mappers.deploymentSettings.toRow(
          { ...(patch as any), updatedAt: now() } as DeploymentSettingsRow,
          a,
        );
        delete (values as any).id;
        delete (values as any).createdAt;
        const rows = await returningAll(
          db
            .update(s.deploymentSettings)
            .set(values)
            .where(eq(s.deploymentSettings.id, SINGLETON)),
        );
        const updated = first<DeploymentSettingsRow>(
          rows,
          mappers.deploymentSettings.toDomain,
        );
        if (updated == null) throw new Error("deployment_settings row missing");
        return updated;
      },
    },

    users: {
      async create(user: NewUser) {
        const ts = now();
        const row: UserRow = { ...user, createdAt: ts, updatedAt: ts };
        await db.insert(s.user).values(mappers.user.toRow(row, a));
        return row;
      },
      async findById(id) {
        const rows = await db
          .select()
          .from(s.user)
          .where(eq(s.user.id, id))
          .limit(1);
        return first<UserRow>(rows, mappers.user.toDomain);
      },
      async findByEmail(email) {
        const rows = await db
          .select()
          .from(s.user)
          .where(sql`lower(${s.user.email}) = lower(${email})`)
          .limit(1);
        return first<UserRow>(rows, mappers.user.toDomain);
      },
      async update(id, patch) {
        const values = mappers.user.toRow({ ...patch, updatedAt: now() }, a);
        const rows = await returningAll(
          db.update(s.user).set(values).where(eq(s.user.id, id)),
        );
        const updated = first<UserRow>(rows, mappers.user.toDomain);
        if (updated == null) throw new Error(`user ${id} not found`);
        return updated;
      },
      async list() {
        const rows = await db.select().from(s.user);
        return rows.map((r: any) => mappers.user.toDomain(r));
      },
      async countActiveAdmins() {
        const rows = await db
          .select({ n: sql<number>`count(*)` })
          .from(s.user)
          .where(and(eq(s.user.role, "admin"), eq(s.user.status, "active")));
        return Number(rows[0]?.n ?? 0);
      },
    },

    userTokens: {
      async issue(token: NewUserToken) {
        await db
          .delete(s.userToken)
          .where(
            and(
              eq(s.userToken.userId, token.userId),
              eq(s.userToken.purpose, token.purpose),
              isNull(s.userToken.usedAt),
            ),
          );
        const row: UserTokenRow = {
          ...token,
          usedAt: token.usedAt ?? null,
          createdAt: now(),
        };
        await db.insert(s.userToken).values(mappers.userToken.toRow(row, a));
        return row;
      },
      async findByHash(tokenHash) {
        const rows = await db
          .select()
          .from(s.userToken)
          .where(eq(s.userToken.tokenHash, tokenHash))
          .limit(1);
        return first<UserTokenRow>(rows, mappers.userToken.toDomain);
      },
      async consume(id, at) {
        await db
          .update(s.userToken)
          .set({ usedAt: a === "sqlite" ? at.toISOString() : at })
          .where(eq(s.userToken.id, id));
      },
      async deleteExpired(nowAt) {
        const rows = await returningAll(
          db
            .delete(s.userToken)
            .where(
              lte(
                s.userToken.expiresAt,
                a === "sqlite" ? nowAt.toISOString() : (nowAt as any),
              ),
            ),
        );
        return rows.length;
      },
    },

    apiTokens: {
      async create(token: NewApiToken) {
        const row: ApiTokenRow = {
          ...token,
          createdAt: now(),
          lastUsedAt: null,
          revokedAt: null,
        };
        await db.insert(s.apiToken).values(mappers.apiToken.toRow(row, a));
        return row;
      },
      async findById(id) {
        const rows = await db
          .select()
          .from(s.apiToken)
          .where(eq(s.apiToken.id, id))
          .limit(1);
        return first<ApiTokenRow>(rows, mappers.apiToken.toDomain);
      },
      async findByHash(tokenHash) {
        const rows = await db
          .select()
          .from(s.apiToken)
          .where(eq(s.apiToken.tokenHash, tokenHash))
          .limit(1);
        return first<ApiTokenRow>(rows, mappers.apiToken.toDomain);
      },
      async listForUser(userId) {
        const rows = await db
          .select()
          .from(s.apiToken)
          .where(eq(s.apiToken.userId, userId));
        return rows.map((r: any) => mappers.apiToken.toDomain(r));
      },
      async revoke(id, at) {
        await db
          .update(s.apiToken)
          .set({ revokedAt: a === "sqlite" ? at.toISOString() : at })
          .where(eq(s.apiToken.id, id));
      },
      async touch(id, at) {
        await db
          .update(s.apiToken)
          .set({ lastUsedAt: a === "sqlite" ? at.toISOString() : at })
          .where(eq(s.apiToken.id, id));
      },
    },

    sessions: {
      async create(session: NewSession) {
        const ts = now();
        const row: SessionRow = { ...session, createdAt: ts, lastSeenAt: ts };
        await db.insert(s.session).values(mappers.session.toRow(row, a));
        return row;
      },
      async findByHash(tokenHash) {
        const rows = await db
          .select()
          .from(s.session)
          .where(eq(s.session.tokenHash, tokenHash))
          .limit(1);
        return first<SessionRow>(rows, mappers.session.toDomain);
      },
      async revoke(id, at) {
        await db
          .update(s.session)
          .set({ revokedAt: a === "sqlite" ? at.toISOString() : at })
          .where(eq(s.session.id, id));
      },
      async deleteExpired(nowAt) {
        const rows = await returningAll(
          db
            .delete(s.session)
            .where(
              lte(
                s.session.expiresAt,
                a === "sqlite" ? nowAt.toISOString() : (nowAt as any),
              ),
            ),
        );
        return rows.length;
      },
      async latestActivityForUser(userId) {
        const rows = await db
          .select({ lastSeenAt: s.session.lastSeenAt })
          .from(s.session)
          .where(eq(s.session.userId, userId))
          .orderBy(desc(s.session.lastSeenAt))
          .limit(1);
        const v = rows[0]?.lastSeenAt;
        return v == null ? null : v instanceof Date ? v : new Date(v);
      },
    },

    audit: {
      async record(entry: NewAuditLog) {
        const row = buildAuditRow(entry);
        await db.insert(s.auditLog).values(mappers.auditLog.toRow(row, a));
        return row;
      },
      async list(filter = {}) {
        const clauses = [];
        if (filter.targetType != null) {
          clauses.push(eq(s.auditLog.targetType, filter.targetType));
        }
        if (filter.targetId != null) {
          clauses.push(eq(s.auditLog.targetId, filter.targetId));
        }
        let q = db.select().from(s.auditLog);
        if (clauses.length > 0) q = q.where(and(...clauses));
        q = q.orderBy(desc(s.auditLog.createdAt), desc(s.auditLog.id));
        if (filter.limit != null) q = q.limit(filter.limit);
        const rows = await q;
        return rows.map((r: any) => mappers.auditLog.toDomain(r));
      },
      async count() {
        const rows = await db
          .select({ n: sql<number>`count(*)` })
          .from(s.auditLog);
        return Number(rows[0]?.n ?? 0);
      },
    },

    invitations: {
      async issue(invitation: NewInvitation) {
        await db
          .delete(s.invitation)
          .where(
            and(
              sql`lower(${s.invitation.email}) = lower(${invitation.email})`,
              isNull(s.invitation.acceptedAt),
            ),
          );
        const row: InvitationRow = {
          ...invitation,
          acceptedAt: null,
          acceptedUserId: null,
          createdAt: now(),
        };
        await db.insert(s.invitation).values(mappers.invitation.toRow(row, a));
        return row;
      },
      async findByHash(tokenHash) {
        const rows = await db
          .select()
          .from(s.invitation)
          .where(eq(s.invitation.tokenHash, tokenHash))
          .limit(1);
        return first<InvitationRow>(rows, mappers.invitation.toDomain);
      },
      async consume(id, acceptedUserId, at) {
        await db
          .update(s.invitation)
          .set(
            mappers.invitation.toRow(
              { acceptedAt: at, acceptedUserId },
              a,
            ),
          )
          .where(eq(s.invitation.id, id));
      },
    },

    oidcProviders: {
      async create(p: NewOidcProvider) {
        const ts = now();
        const row: OidcProviderRow = { ...p, createdAt: ts, updatedAt: ts };
        await db.insert(s.oidcProvider).values(mappers.oidcProvider.toRow(row, a));
        return row;
      },
      async findByKey(key) {
        const rows = await db
          .select()
          .from(s.oidcProvider)
          .where(eq(s.oidcProvider.key, key))
          .limit(1);
        return first<OidcProviderRow>(rows, mappers.oidcProvider.toDomain);
      },
      async list() {
        const rows = await db.select().from(s.oidcProvider);
        return rows.map((r: any) => mappers.oidcProvider.toDomain(r));
      },
      async update(key, patch) {
        const values = mappers.oidcProvider.toRow(
          { ...patch, updatedAt: now() },
          a,
        );
        const rows = await returningAll(
          db
            .update(s.oidcProvider)
            .set(values)
            .where(eq(s.oidcProvider.key, key)),
        );
        const updated = first<OidcProviderRow>(rows, mappers.oidcProvider.toDomain);
        if (updated == null) throw new Error(`oidc_provider ${key} not found`);
        return updated;
      },
      async delete(key) {
        await db.delete(s.oidcProvider).where(eq(s.oidcProvider.key, key));
      },
    },

    oidcLogins: {
      async create(row: NewOidcLogin) {
        const full: OidcLoginRow = { ...row, consumedAt: null, createdAt: now() };
        await db.insert(s.oidcLogin).values(mappers.oidcLogin.toRow(full, a));
        return full;
      },
      async findByStateHash(stateHash) {
        const rows = await db
          .select()
          .from(s.oidcLogin)
          .where(eq(s.oidcLogin.stateHash, stateHash))
          .limit(1);
        return first<OidcLoginRow>(rows, mappers.oidcLogin.toDomain);
      },
      async consume(id, at) {
        await db
          .update(s.oidcLogin)
          .set(mappers.oidcLogin.toRow({ consumedAt: at }, a))
          .where(eq(s.oidcLogin.id, id));
      },
      async deleteExpired(nowAt) {
        const rows = await returningAll(
          db
            .delete(s.oidcLogin)
            .where(
              lte(
                s.oidcLogin.expiresAt,
                a === "sqlite" ? nowAt.toISOString() : (nowAt as any),
              ),
            ),
        );
        return rows.length;
      },
    },

    identities: {
      async create(i: NewIdentity) {
        const row: IdentityRow = {
          ...i,
          lastLoginAt: i.lastLoginAt ?? null,
          createdAt: now(),
        };
        await db.insert(s.identity).values(mappers.identity.toRow(row, a));
        return row;
      },
      async findByProviderSubject(providerKey, subject) {
        const rows = await db
          .select()
          .from(s.identity)
          .where(
            and(
              eq(s.identity.providerKey, providerKey),
              eq(s.identity.subject, subject),
            ),
          )
          .limit(1);
        return first<IdentityRow>(rows, mappers.identity.toDomain);
      },
      async findById(id) {
        const rows = await db
          .select()
          .from(s.identity)
          .where(eq(s.identity.id, id))
          .limit(1);
        return first<IdentityRow>(rows, mappers.identity.toDomain);
      },
      async listForUser(userId) {
        const rows = await db
          .select()
          .from(s.identity)
          .where(eq(s.identity.userId, userId));
        return rows.map((r: any) => mappers.identity.toDomain(r));
      },
      async listForProvider(providerKey) {
        const rows = await db
          .select()
          .from(s.identity)
          .where(eq(s.identity.providerKey, providerKey));
        return rows.map((r: any) => mappers.identity.toDomain(r));
      },
      async countForProvider(providerKey) {
        const rows = await db
          .select({ n: sql<number>`count(*)` })
          .from(s.identity)
          .where(eq(s.identity.providerKey, providerKey));
        return Number(rows[0]?.n ?? 0);
      },
      async touchLogin(id, at) {
        await db
          .update(s.identity)
          .set(mappers.identity.toRow({ lastLoginAt: at }, a))
          .where(eq(s.identity.id, id));
      },
      async delete(id) {
        await db.delete(s.identity).where(eq(s.identity.id, id));
      },
    },
  };
}

/**
 * Count `role = 'admin' AND status = 'active'` users on an open transaction.
 * Use it under `tx.lockSettings` for the INV-6 / FR-7.4 last-admin guard.
 * Synchronous on SQLite, a promise on PostgreSQL.
 */
export function countActiveAdminsInTx(tx: Tx): number | Promise<number> {
  const q = sql`select count(*) as n from "user" where role = 'admin' and status = 'active'`;
  if (tx.dialect === "postgres") {
    return tx.db.execute(q).then((rows) => Number((rows[0] as any)?.n ?? 0));
  }
  return Number((tx.db.all(q)[0] as any)?.n ?? 0);
}

/** Delete a user row on an open transaction. FK cascades take the dependents. */
export function deleteUserInTx(tx: Tx, userId: string): void | Promise<void> {
  if (tx.dialect === "postgres") {
    return tx.db
      .delete(pgSchema.user)
      .where(eq(pgSchema.user.id, userId))
      .then(() => undefined);
  }
  tx.db.delete(sqliteSchema.user).where(eq(sqliteSchema.user.id, userId)).run();
}

/** Fill `id` and `createdAt` for an audit entry. */
function buildAuditRow(entry: NewAuditLog): AuditLogRow {
  return {
    id: entry.id ?? newId(),
    actorUserId: entry.actorUserId,
    action: entry.action,
    targetType: entry.targetType,
    targetId: entry.targetId,
    summary: entry.summary,
    metadata: entry.metadata,
    ip: entry.ip,
    createdAt: new Date(),
  };
}

/**
 * Insert one `audit_log` row on an open transaction. Call it from inside a
 * `uow.run` callback so the row commits or rolls back with the mutation it
 * records (plan section 4, AC-9).
 *
 * SQLite runs synchronously and returns the row. PostgreSQL returns a promise
 * for the row. A caller that serves both dialects writes a synchronous uow
 * callback and `return`s this value: on SQLite the uow sees a plain row, on
 * PostgreSQL a promise it awaits.
 */
export function writeAuditInTx(
  tx: Tx,
  entry: NewAuditLog,
): AuditLogRow | Promise<AuditLogRow> {
  const row = buildAuditRow(entry);
  if (tx.dialect === "postgres") {
    return tx.db
      .insert(pgSchema.auditLog)
      .values(mappers.auditLog.toRow(row, "postgres") as any)
      .then(() => row);
  }
  tx.db
    .insert(sqliteSchema.auditLog)
    .values(mappers.auditLog.toRow(row, "sqlite") as any)
    .run();
  return row;
}

// ---------------------------------------------------------------------------
// Transaction helpers for the admin mutation routes (slice 5c).
//
// Each returns `void` synchronously on SQLite and a `Promise<void>` on
// PostgreSQL. Pass them as steps to `runTxSteps` (uow.ts), which hides the
// dialect split. A step may throw to roll the whole uow back.
// ---------------------------------------------------------------------------

/** The schema module for a transaction's dialect, loosely typed like `makeRepos`. */
function txParts(tx: Tx): { db: any; s: typeof sqliteSchema; a: Adapter } {
  const s: typeof sqliteSchema =
    tx.dialect === "postgres"
      ? (pgSchema as unknown as typeof sqliteSchema)
      : sqliteSchema;
  return { db: tx.db as any, s, a: tx.dialect };
}

/** Await on Postgres, no-op on SQLite (the builder already ran). */
function settle(tx: Tx, builder: any): void | Promise<void> {
  if (tx.dialect === "postgres") return builder.then(() => undefined);
  builder.run();
}

/** Insert a fully-formed user row. */
export function insertUserInTx(tx: Tx, row: UserRow): void | Promise<void> {
  const { db, s, a } = txParts(tx);
  return settle(tx, db.insert(s.user).values(mappers.user.toRow(row, a)));
}

/** Patch a user row by id. `updatedAt` is set here. */
export function updateUserInTx(
  tx: Tx,
  id: string,
  patch: Partial<UserRow>,
): void | Promise<void> {
  const { db, s, a } = txParts(tx);
  const values = mappers.user.toRow({ ...patch, updatedAt: new Date() }, a);
  return settle(tx, db.update(s.user).set(values).where(eq(s.user.id, id)));
}

/** Revoke every live session for a user. */
export function revokeUserSessionsInTx(
  tx: Tx,
  userId: string,
  at: Date,
): void | Promise<void> {
  const { db, s, a } = txParts(tx);
  const value = a === "sqlite" ? at.toISOString() : at;
  return settle(
    tx,
    db
      .update(s.session)
      .set({ revokedAt: value })
      .where(and(eq(s.session.userId, userId), isNull(s.session.revokedAt))),
  );
}

/** Revoke every live API token for a user. */
export function revokeUserApiTokensInTx(
  tx: Tx,
  userId: string,
  at: Date,
): void | Promise<void> {
  const { db, s, a } = txParts(tx);
  const value = a === "sqlite" ? at.toISOString() : at;
  return settle(
    tx,
    db
      .update(s.apiToken)
      .set({ revokedAt: value })
      .where(and(eq(s.apiToken.userId, userId), isNull(s.apiToken.revokedAt))),
  );
}

/**
 * Issue a `user_token`, first clearing any unused token of the same purpose
 * for that user (mirrors `repos.userTokens.issue`).
 */
export function issueUserTokenInTx(
  tx: Tx,
  row: UserTokenRow,
): void | Promise<void> {
  const { db, s, a } = txParts(tx);
  const clearWhere = and(
    eq(s.userToken.userId, row.userId),
    eq(s.userToken.purpose, row.purpose),
    isNull(s.userToken.usedAt),
  );
  if (tx.dialect === "postgres") {
    return db
      .delete(s.userToken)
      .where(clearWhere)
      .then(() =>
        db.insert(s.userToken).values(mappers.userToken.toRow(row, a)),
      )
      .then(() => undefined);
  }
  db.delete(s.userToken).where(clearWhere).run();
  db.insert(s.userToken).values(mappers.userToken.toRow(row, a)).run();
}

/** Mark a `user_token` used. */
export function consumeUserTokenInTx(
  tx: Tx,
  id: string,
  at: Date,
): void | Promise<void> {
  const { db, s, a } = txParts(tx);
  const value = a === "sqlite" ? at.toISOString() : at;
  return settle(
    tx,
    db.update(s.userToken).set({ usedAt: value }).where(eq(s.userToken.id, id)),
  );
}

/** Patch the `deployment_settings` singleton. `updatedAt` is set here. */
export function updateSettingsInTx(
  tx: Tx,
  patch: Partial<Omit<DeploymentSettingsRow, "id" | "createdAt">>,
): void | Promise<void> {
  const { db, s, a } = txParts(tx);
  const values = mappers.deploymentSettings.toRow(
    { ...patch, updatedAt: new Date() } as DeploymentSettingsRow,
    a,
  );
  delete (values as any).id;
  delete (values as any).createdAt;
  return settle(
    tx,
    db
      .update(s.deploymentSettings)
      .set(values)
      .where(eq(s.deploymentSettings.id, SINGLETON)),
  );
}

/**
 * Issue an invitation, clearing a prior unaccepted one for the same email
 * (mirrors `issueUserTokenInTx`).
 */
export function issueInvitationInTx(
  tx: Tx,
  row: InvitationRow,
): void | Promise<void> {
  const { db, s, a } = txParts(tx);
  const clearWhere = and(
    sql`lower(${s.invitation.email}) = lower(${row.email})`,
    isNull(s.invitation.acceptedAt),
  );
  if (tx.dialect === "postgres") {
    return db
      .delete(s.invitation)
      .where(clearWhere)
      .then(() =>
        db.insert(s.invitation).values(mappers.invitation.toRow(row, a)),
      )
      .then(() => undefined);
  }
  db.delete(s.invitation).where(clearWhere).run();
  db.insert(s.invitation).values(mappers.invitation.toRow(row, a)).run();
}

/** Mark an invitation accepted by the given user. */
export function consumeInvitationInTx(
  tx: Tx,
  id: string,
  acceptedUserId: string,
  at: Date,
): void | Promise<void> {
  const { db, s, a } = txParts(tx);
  const values = mappers.invitation.toRow({ acceptedAt: at, acceptedUserId }, a);
  return settle(tx, db.update(s.invitation).set(values).where(eq(s.invitation.id, id)));
}

/**
 * INV-6 / FR-7.4 guard. Throw `last_admin` when the mutation would remove the
 * deployment's last active admin. Call it as the first `runTxSteps` step, with
 * `{ settings: true }` so the count is serialised.
 */
export function guardLastAdminInTx(tx: Tx, target: UserRow): unknown {
  if (target.role !== "admin" || target.status !== "active") return undefined;
  const n = countActiveAdminsInTx(tx);
  if (typeof n === "number") {
    if (n <= 1) throw err.lastAdmin();
    return undefined;
  }
  return n.then((count) => {
    if (count <= 1) throw err.lastAdmin();
  });
}

/** Insert a fully-formed OIDC provider row. */
export function insertOidcProviderInTx(
  tx: Tx,
  row: OidcProviderRow,
): void | Promise<void> {
  const { db, s, a } = txParts(tx);
  return settle(
    tx,
    db.insert(s.oidcProvider).values(mappers.oidcProvider.toRow(row, a)),
  );
}

/** Patch an OIDC provider by key. `updatedAt` is set here. */
export function updateOidcProviderInTx(
  tx: Tx,
  key: string,
  patch: Partial<Omit<OidcProviderRow, "id" | "key" | "createdAt">>,
): void | Promise<void> {
  const { db, s, a } = txParts(tx);
  const values = mappers.oidcProvider.toRow({ ...patch, updatedAt: new Date() }, a);
  return settle(
    tx,
    db.update(s.oidcProvider).set(values).where(eq(s.oidcProvider.key, key)),
  );
}

/** Delete an OIDC provider by key. */
export function deleteOidcProviderInTx(tx: Tx, key: string): void | Promise<void> {
  const { db, s } = txParts(tx);
  return settle(tx, db.delete(s.oidcProvider).where(eq(s.oidcProvider.key, key)));
}

/** Delete one identity row (unlink). */
export function deleteIdentityInTx(tx: Tx, id: string): void | Promise<void> {
  const { db, s } = txParts(tx);
  return settle(tx, db.delete(s.identity).where(eq(s.identity.id, id)));
}

/** Insert an identity row linking a user to an OIDC subject. */
export function insertIdentityInTx(
  tx: Tx,
  row: IdentityRow,
): void | Promise<void> {
  const { db, s, a } = txParts(tx);
  return settle(tx, db.insert(s.identity).values(mappers.identity.toRow(row, a)));
}

/** Touch `identity.last_login_at`. */
export function touchIdentityInTx(
  tx: Tx,
  id: string,
  at: Date,
): void | Promise<void> {
  const { db, s, a } = txParts(tx);
  const values = mappers.identity.toRow({ lastLoginAt: at }, a);
  return settle(tx, db.update(s.identity).set(values).where(eq(s.identity.id, id)));
}

/** Create an OIDC login's oidc_login row. */
export function insertOidcLoginInTx(
  tx: Tx,
  row: OidcLoginRow,
): void | Promise<void> {
  const { db, s, a } = txParts(tx);
  return settle(tx, db.insert(s.oidcLogin).values(mappers.oidcLogin.toRow(row, a)));
}

/** Mark an `oidc_login` row consumed. */
export function consumeOidcLoginInTx(
  tx: Tx,
  id: string,
  at: Date,
): void | Promise<void> {
  const { db, s, a } = txParts(tx);
  const values = mappers.oidcLogin.toRow({ consumedAt: at }, a);
  return settle(tx, db.update(s.oidcLogin).set(values).where(eq(s.oidcLogin.id, id)));
}
