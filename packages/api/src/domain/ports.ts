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
  /** The most recent `last_seen_at` across the user's sessions, or null. */
  latestActivityForUser(userId: string): Promise<Date | null>;
}

export interface InvitationRepo {
  /**
   * Create a single-use invitation, first clearing any unaccepted invitation
   * for the same email (data-model: one pending invite per email at a time).
   */
  issue(invitation: NewInvitation): Promise<InvitationRow>;
  findByHash(tokenHash: string): Promise<InvitationRow | null>;
  /** Mark the invitation accepted by the given user. */
  consume(id: string, acceptedUserId: string, at: Date): Promise<void>;
}

export interface OidcProviderRepo {
  create(p: NewOidcProvider): Promise<OidcProviderRow>;
  findByKey(key: string): Promise<OidcProviderRow | null>;
  list(): Promise<OidcProviderRow[]>;
  update(
    key: string,
    patch: Partial<Omit<OidcProviderRow, "id" | "key" | "createdAt">>,
  ): Promise<OidcProviderRow>;
  delete(key: string): Promise<void>;
}

export interface OidcLoginRepo {
  create(row: NewOidcLogin): Promise<OidcLoginRow>;
  findByStateHash(stateHash: string): Promise<OidcLoginRow | null>;
  consume(id: string, at: Date): Promise<void>;
  deleteExpired(now: Date): Promise<number>;
}

export interface IdentityRepo {
  create(i: NewIdentity): Promise<IdentityRow>;
  findByProviderSubject(
    providerKey: string,
    subject: string,
  ): Promise<IdentityRow | null>;
  findById(id: string): Promise<IdentityRow | null>;
  listForUser(userId: string): Promise<IdentityRow[]>;
  countForProvider(providerKey: string): Promise<number>;
  touchLogin(id: string, at: Date): Promise<void>;
  delete(id: string): Promise<void>;
}

export interface AuditRepo {
  /**
   * Append one audit row on the outer connection. When the row must commit or
   * roll back with a mutation, use `writeAuditInTx` inside that `uow.run`
   * instead (plan section 4, AC-9).
   */
  record(entry: NewAuditLog): Promise<AuditLogRow>;
  /** Newest first. Optional exact-match filter on the target. */
  list(filter?: {
    targetType?: string;
    targetId?: string;
    limit?: number;
  }): Promise<AuditLogRow[]>;
  count(): Promise<number>;
}

export interface Repos {
  readonly schemaMeta: SchemaMetaRepo;
  readonly settings: SettingsRepo;
  readonly users: UserRepo;
  readonly userTokens: UserTokenRepo;
  readonly apiTokens: ApiTokenRepo;
  readonly sessions: SessionRepo;
  readonly audit: AuditRepo;
  readonly invitations: InvitationRepo;
  readonly oidcProviders: OidcProviderRepo;
  readonly oidcLogins: OidcLoginRepo;
  readonly identities: IdentityRepo;
}
