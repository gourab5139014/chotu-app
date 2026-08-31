import { getTableColumns, type Table } from "drizzle-orm";
import { describe, expect, expectTypeOf, it } from "vitest";

import * as pg from "../../src/db/schema/pg";
import type {
  ApiTokenRow,
  DeploymentSettingsRow,
  SchemaMetaRow,
  SessionRow,
  UserRow,
  UserTokenRow,
} from "../../src/db/schema/types";
import {
  isSchemaSupported,
  SUPPORTED_SCHEMA_RANGE,
} from "../../src/db/schema/version";

/** Every canonical row type covers exactly the table's columns. */
function keysOf(table: Table): string[] {
  return Object.keys(getTableColumns(table)).sort();
}

describe("canonical row types match the schema columns", () => {
  const cases: Array<[string, Table, string[]]> = [
    [
      "schema_meta",
      pg.schemaMeta,
      ["id", "schemaVersion", "appliedAt", "chotuBuild"].sort(),
    ],
    [
      "user",
      pg.user,
      (
        [
          "id",
          "email",
          "emailVerifiedAt",
          "displayName",
          "role",
          "status",
          "passwordHash",
          "mustChangePassword",
          "unitSystem",
          "currencyCode",
          "timeZone",
          "createdAt",
          "updatedAt",
          "deactivatedAt",
        ] satisfies Array<keyof UserRow>
      ).sort(),
    ],
    [
      "user_token",
      pg.userToken,
      (
        [
          "id",
          "userId",
          "purpose",
          "tokenHash",
          "expiresAt",
          "usedAt",
          "createdAt",
        ] satisfies Array<keyof UserTokenRow>
      ).sort(),
    ],
    [
      "api_token",
      pg.apiToken,
      (
        [
          "id",
          "userId",
          "tokenHash",
          "label",
          "createdAt",
          "lastUsedAt",
          "expiresAt",
          "revokedAt",
        ] satisfies Array<keyof ApiTokenRow>
      ).sort(),
    ],
    [
      "session",
      pg.session,
      (
        [
          "id",
          "tokenHash",
          "userId",
          "createdAt",
          "lastSeenAt",
          "expiresAt",
          "revokedAt",
          "userAgent",
          "ip",
        ] satisfies Array<keyof SessionRow>
      ).sort(),
    ],
  ];

  for (const [name, table, expected] of cases) {
    it(name, () => {
      expect(keysOf(table)).toEqual(expected);
    });
  }
});

describe("canonical types normalise the dialect differences", () => {
  it("instants are Date, calendar-less nullables are Date | null", () => {
    expectTypeOf<UserRow["createdAt"]>().toEqualTypeOf<Date>();
    expectTypeOf<UserRow["emailVerifiedAt"]>().toEqualTypeOf<Date | null>();
    expectTypeOf<SessionRow["revokedAt"]>().toEqualTypeOf<Date | null>();
  });

  it("booleans are boolean, json is a typed array, ttl is number | null", () => {
    expectTypeOf<UserRow["mustChangePassword"]>().toEqualTypeOf<boolean>();
    expectTypeOf<
      DeploymentSettingsRow["allowedAuthMethods"]
    >().toEqualTypeOf<Array<"password" | "oidc">>();
    expectTypeOf<
      DeploymentSettingsRow["apiTokenTtlSeconds"]
    >().toEqualTypeOf<number | null>();
  });

  it("SchemaMetaRow.schemaVersion is a number", () => {
    expectTypeOf<SchemaMetaRow["schemaVersion"]>().toEqualTypeOf<number>();
  });
});

describe("schema version support window", () => {
  it("accepts the current range and rejects outside it", () => {
    expect(isSchemaSupported(SUPPORTED_SCHEMA_RANGE.min)).toBe(true);
    expect(isSchemaSupported(SUPPORTED_SCHEMA_RANGE.max)).toBe(true);
    expect(isSchemaSupported(SUPPORTED_SCHEMA_RANGE.max + 1)).toBe(false);
    expect(isSchemaSupported(0)).toBe(false);
  });
});
