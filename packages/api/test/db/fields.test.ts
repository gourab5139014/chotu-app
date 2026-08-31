import { getTableColumns, type Table } from "drizzle-orm";
import { describe, expect, it } from "vitest";

import * as pg from "../../src/db/schema/pg";
import * as sqlite from "../../src/db/schema/sqlite";

interface ColShape {
  name: string;
  notNull: boolean;
  primary: boolean;
}

function shape(table: Table): Record<string, ColShape> {
  const out: Record<string, ColShape> = {};
  for (const [key, col] of Object.entries(getTableColumns(table))) {
    out[key] = { name: col.name, notNull: col.notNull, primary: col.primary };
  }
  return out;
}

const pairs: ReadonlyArray<readonly [string, Table, Table]> = [
  ["schema_meta", pg.schemaMeta, sqlite.schemaMeta],
  ["deployment_settings", pg.deploymentSettings, sqlite.deploymentSettings],
];

describe("schema parity: pg vs sqlite", () => {
  for (const [name, pgTable, sqliteTable] of pairs) {
    it(`${name}: same columns, notNull, and primary keys`, () => {
      expect(shape(sqliteTable)).toEqual(shape(pgTable));
    });
  }
});
