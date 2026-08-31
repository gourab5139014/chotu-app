/**
 * Row mappers. Convert an adapter's raw row (PostgreSQL: `Date`, parsed jsonb;
 * SQLite: ISO string, JSON-in-text) to and from the canonical shapes in
 * `types.ts`. Repositories call these; the domain never sees a Drizzle row.
 *
 * Only two transforms are needed for these tables: instants (`Date` <-> ISO
 * string on SQLite) and a safe-integer guard on 64-bit columns. Everything else
 * (booleans, typed JSON, small integers, text) Drizzle already returns in the
 * canonical form.
 */
import type { Adapter } from "../index";
import type {
  ApiTokenRow,
  DeploymentSettingsRow,
  SchemaMetaRow,
  SessionRow,
  UserRow,
  UserTokenRow,
} from "./types";

type Raw = Record<string, unknown>;

interface TableMap {
  /** Columns holding an instant. Nullable ones are handled transparently. */
  readonly instants: readonly string[];
  /** 64-bit integer columns that must round-trip as a safe JS number. */
  readonly safeInts: readonly string[];
}

function toDate(value: unknown): Date {
  if (value instanceof Date) return value;
  if (typeof value === "string" || typeof value === "number") {
    return new Date(value);
  }
  throw new TypeError(`Expected an instant, got ${typeof value}`);
}

function toSafeInt(value: unknown, field: string): number {
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isSafeInteger(n)) {
    throw new RangeError(`${field} is not a safe integer: ${String(value)}`);
  }
  return n;
}

function rowToDomain<T>(raw: Raw, map: TableMap): T {
  const out: Raw = { ...raw };
  for (const key of map.instants) {
    const v = out[key];
    out[key] = v == null ? null : toDate(v);
  }
  for (const key of map.safeInts) {
    const v = out[key];
    if (v != null) out[key] = toSafeInt(v, key);
  }
  return out as T;
}

function domainToRow<T extends object>(
  domain: T,
  map: TableMap,
  dialect: Adapter,
): Raw {
  const out: Raw = { ...(domain as Record<string, unknown>) };
  if (dialect === "sqlite") {
    for (const key of map.instants) {
      const v = out[key];
      if (v instanceof Date) out[key] = v.toISOString();
    }
  }
  return out;
}

const SCHEMA_META: TableMap = { instants: ["appliedAt"], safeInts: [] };
const DEPLOYMENT_SETTINGS: TableMap = {
  instants: ["createdAt", "updatedAt"],
  safeInts: [],
};
const USER: TableMap = {
  instants: ["emailVerifiedAt", "createdAt", "updatedAt", "deactivatedAt"],
  safeInts: [],
};
const USER_TOKEN: TableMap = {
  instants: ["expiresAt", "usedAt", "createdAt"],
  safeInts: [],
};
const API_TOKEN: TableMap = {
  instants: ["createdAt", "lastUsedAt", "expiresAt", "revokedAt"],
  safeInts: [],
};
const SESSION: TableMap = {
  instants: ["createdAt", "lastSeenAt", "expiresAt", "revokedAt"],
  safeInts: [],
};

export const mappers = {
  schemaMeta: {
    toDomain: (r: Raw) => rowToDomain<SchemaMetaRow>(r, SCHEMA_META),
    toRow: (d: SchemaMetaRow, a: Adapter) => domainToRow(d, SCHEMA_META, a),
  },
  deploymentSettings: {
    toDomain: (r: Raw) =>
      rowToDomain<DeploymentSettingsRow>(r, DEPLOYMENT_SETTINGS),
    toRow: (d: DeploymentSettingsRow, a: Adapter) =>
      domainToRow(d, DEPLOYMENT_SETTINGS, a),
  },
  user: {
    toDomain: (r: Raw) => rowToDomain<UserRow>(r, USER),
    toRow: (d: UserRow, a: Adapter) => domainToRow(d, USER, a),
  },
  userToken: {
    toDomain: (r: Raw) => rowToDomain<UserTokenRow>(r, USER_TOKEN),
    toRow: (d: UserTokenRow, a: Adapter) => domainToRow(d, USER_TOKEN, a),
  },
  apiToken: {
    toDomain: (r: Raw) => rowToDomain<ApiTokenRow>(r, API_TOKEN),
    toRow: (d: ApiTokenRow, a: Adapter) => domainToRow(d, API_TOKEN, a),
  },
  session: {
    toDomain: (r: Raw) => rowToDomain<SessionRow>(r, SESSION),
    toRow: (d: SessionRow, a: Adapter) => domainToRow(d, SESSION, a),
  },
} as const;

export { toSafeInt };
