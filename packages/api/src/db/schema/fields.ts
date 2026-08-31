/**
 * Dual-dialect column helpers.
 *
 * Each helper returns `{ pg, sqlite }` — the same logical column built for both
 * engines. `schema/pg.ts` and `schema/sqlite.ts` build their tables by picking
 * `.pg` / `.sqlite`; the parity test in `fields.test.ts` proves the two stay in
 * step. See specs/0001-m1-trusted-fuel-logging/plan.md section 2 and
 * data-model.md "Adapter notes".
 *
 * Type differences (Date vs ISO string, boolean vs 0/1, jsonb vs text) are
 * normalised by the row mappers added in T2.3, not here.
 */
import {
  bigint as pgBigint,
  boolean as pgBoolean,
  date as pgDate,
  integer as pgInteger,
  jsonb as pgJsonb,
  text as pgText,
  timestamp as pgTimestamp,
  uuid as pgUuid,
} from "drizzle-orm/pg-core";
import {
  integer as sqliteInteger,
  text as sqliteText,
} from "drizzle-orm/sqlite-core";

/** `uuid` primary key named `id`. Application-generated UUID v7. */
export const uuidPk = () => ({
  pg: pgUuid("id").primaryKey(),
  sqlite: sqliteText("id").primaryKey(),
});

/** `text` primary key named `id`, for single-row tables (fixed value `singleton`). */
export const singletonId = () => ({
  pg: pgText("id").primaryKey(),
  sqlite: sqliteText("id").primaryKey(),
});

/** A `uuid` reference column (foreign keys are wired in the table file). */
export const uuidRef = (name: string) => ({
  pg: pgUuid(name),
  sqlite: sqliteText(name),
});

export const text = (name: string) => ({
  pg: pgText(name),
  sqlite: sqliteText(name),
});

/** UTC instant. PostgreSQL `timestamptz`; SQLite ISO-8601 text. */
export const timestamptz = (name: string) => ({
  pg: pgTimestamp(name, { withTimezone: true, mode: "date" }),
  sqlite: sqliteText(name),
});

/** Calendar date, no time. */
export const dateOnly = (name: string) => ({
  pg: pgDate(name, { mode: "string" }),
  sqlite: sqliteText(name),
});

export const bool = (name: string) => ({
  pg: pgBoolean(name),
  sqlite: sqliteInteger(name, { mode: "boolean" }),
});

/** 64-bit integer surfaced as a JS `number` (canonical units, TTL seconds). */
export const bigintNum = (name: string) => ({
  pg: pgBigint(name, { mode: "number" }),
  sqlite: sqliteInteger(name, { mode: "number" }),
});

/** 32-bit integer (schema version, year). */
export const intNum = (name: string) => ({
  pg: pgInteger(name),
  sqlite: sqliteInteger(name, { mode: "number" }),
});

/** Structured JSON. PostgreSQL `jsonb`; SQLite JSON-in-text. */
export const json = (name: string) => ({
  pg: pgJsonb(name),
  sqlite: sqliteText(name, { mode: "json" }),
});
