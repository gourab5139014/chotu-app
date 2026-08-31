/* eslint-disable @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-return -- one repo layer over both Drizzle dialects; ports.ts is the typed boundary */
import { and, eq, isNull, lte, sql } from "drizzle-orm";

import { mappers } from "./schema/mappers";
import * as pgSchema from "./schema/pg";
import * as sqliteSchema from "./schema/sqlite";
import type {
  ApiTokenRow,
  DeploymentSettingsRow,
  NewApiToken,
  NewSession,
  NewUser,
  NewUserToken,
  SchemaMetaRow,
  SessionRow,
  UserRow,
  UserTokenRow,
} from "./schema/types";
import type { Adapter, DbHandle } from "./index";
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
        const values: any = { ...patch, updatedAt: now() };
        for (const k of ["emailVerifiedAt", "updatedAt", "deactivatedAt"]) {
          if (values[k] instanceof Date && a === "sqlite") {
            values[k] = values[k].toISOString();
          }
        }
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
    },
  };
}
