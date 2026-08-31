/**
 * Ports: the persistence interfaces the domain depends on. Implementations live
 * in `src/db/repositories.ts`. Everything in and out is a canonical type from
 * `db/schema/types.ts` — no Drizzle rows cross this boundary.
 *
 * Methods are added slice by slice as services need them; this is the slice-2
 * set (settings, schema version, and the auth-core tables).
 */
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
} from "../db/schema/types";

export interface SchemaMetaRepo {
  get(): Promise<SchemaMetaRow | null>;
  set(row: SchemaMetaRow): Promise<SchemaMetaRow>;
}

export interface SettingsRepo {
  get(): Promise<DeploymentSettingsRow | null>;
  create(row: DeploymentSettingsRow): Promise<DeploymentSettingsRow>;
  update(
    patch: Partial<Omit<DeploymentSettingsRow, "id" | "createdAt">>,
  ): Promise<DeploymentSettingsRow>;
}

export interface UserRepo {
  create(user: NewUser): Promise<UserRow>;
  findById(id: string): Promise<UserRow | null>;
  /** Case-insensitive on email. */
  findByEmail(email: string): Promise<UserRow | null>;
  update(
    id: string,
    patch: Partial<Omit<UserRow, "id" | "createdAt">>,
  ): Promise<UserRow>;
  list(): Promise<UserRow[]>;
  countActiveAdmins(): Promise<number>;
}

export interface UserTokenRepo {
  /** Issue a token, first deleting any prior unused token of the same purpose. */
  issue(token: NewUserToken): Promise<UserTokenRow>;
  findByHash(tokenHash: string): Promise<UserTokenRow | null>;
  consume(id: string, at: Date): Promise<void>;
  deleteExpired(now: Date): Promise<number>;
}

export interface ApiTokenRepo {
  create(token: NewApiToken): Promise<ApiTokenRow>;
  findById(id: string): Promise<ApiTokenRow | null>;
  findByHash(tokenHash: string): Promise<ApiTokenRow | null>;
  listForUser(userId: string): Promise<ApiTokenRow[]>;
  revoke(id: string, at: Date): Promise<void>;
  touch(id: string, at: Date): Promise<void>;
}

export interface SessionRepo {
  create(session: NewSession): Promise<SessionRow>;
  findByHash(tokenHash: string): Promise<SessionRow | null>;
  revoke(id: string, at: Date): Promise<void>;
  deleteExpired(now: Date): Promise<number>;
}

export interface Repos {
  readonly schemaMeta: SchemaMetaRepo;
  readonly settings: SettingsRepo;
  readonly users: UserRepo;
  readonly userTokens: UserTokenRepo;
  readonly apiTokens: ApiTokenRepo;
  readonly sessions: SessionRepo;
}
