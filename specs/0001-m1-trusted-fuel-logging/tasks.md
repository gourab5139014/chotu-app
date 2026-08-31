# 0001 — Tasks

Decomposed from `plan.md` section 18. One checkbox per task. Built on a
long-lived branch, one commit per verified task, so the build resumes after a
pause with almost no rework.

## BUILD STATE

- **Branch:** `build/m1`
- **Plan:** `plan.md` (revised, two independent review rounds; verdict
  yes-with-nits, nits cleared)
- **Last completed task:** T3.4
- **Next task:** T3.5
- **Verify the tree is green:** `pnpm -w run verify` (typecheck + lint +
  per-dialect `drizzle-kit check` + vitest). The `verify` script exists from
  T1.8; before that, run the commands named in each task.
- **Resume procedure:** read this header, run `git log --oneline main..HEAD`,
  run `pnpm -w run verify`; if green, start the **Next task**; if red, finish or
  revert the last partial task first.

## Conventions

- Commit message: `build(m1): T<id> <short title>`.
- A task is done when its **done when** check passes **and** `pnpm -w run verify`
  is green (from T1.8 on). Then: tick the box, set **Last completed** and
  **Next** in BUILD STATE, commit.
- Never start a task before the prior one is committed.
- OpenAPI gates (Spectral, oasdiff, `openapi.yaml` diff) are no-op until T4.x.
  Per-dialect Drizzle gates are active from T2.x.
- `@chotu/api` is the package name. Schema name `chotu` on PostgreSQL.

---

## Slice 1 — Workspace + skeleton

- [x] **T1.1** Workspace root: `package.json`, `pnpm-workspace.yaml`,
  `tsconfig.base.json` (strict, NodeNext, ES2022), `.nvmrc` = 20.
  *done when:* `pnpm -w install` succeeds; `pnpm -w exec tsc --version` prints.
- [x] **T1.2** `packages/api` scaffold: `package.json`, `tsconfig.json` extending
  base, `src/index.ts` + `src/app.ts` stubs.
  *done when:* `pnpm --filter @chotu/api exec tsc --noEmit` passes.
  *note:* adding deps needs `rm -rf node_modules && pnpm install --force` in this
  sandbox — incremental install leaves the lockfile updated but `node_modules`
  unmaterialised.
- [x] **T1.3** ESLint flat config with `typescript-eslint`; a local rule module
  stub `no-unscoped-entity-query` (reports nothing yet).
  *done when:* `pnpm -w run lint` passes.
- [x] **T1.4** Vitest workspace config + one placeholder test in `packages/api`.
  *done when:* `pnpm -w run test` green.
- [x] **T1.5** `src/env.ts`: zod schema for every var in `plan.md` section 16;
  `.env.example` regenerated from it.
  *done when:* unit test parses a good env and rejects a missing
  `SESSION_SIGNING_KEY`.
- [x] **T1.6** `drizzle.pg.config.ts`, `drizzle.sqlite.config.ts`, empty
  `src/db/schema/{pg,sqlite}.ts`, empty migration dirs.
  *done when:* `drizzle-kit check` runs clean for both dialects (no tables yet).
- [x] **T1.7** Rewrite `.github/workflows/ci.yml` for pnpm; add the seven
  section-15 jobs. Drizzle codegen/drift jobs active; OpenAPI jobs present but
  skip when `openapi.yaml` is absent.
  *done when:* CI is green on the push.
- [x] **T1.8** `pnpm -w run verify` script = typecheck + lint + both
  `drizzle-kit check` + test. Add `pnpm -w run openapi:write` placeholder.
  *done when:* `pnpm -w run verify` green.

## Slice 2 — DB foundation

- [x] **T2.1** `src/db/schema/fields.ts`: logical field helpers, each returning a
  `{ pg, sqlite }` column builder pair (uuid/text, timestamptz/ISO text,
  jsonb/text, `text[]`/JSON text, boolean, date, bigint→number).
  *done when:* unit test builds one table both ways and asserts column parity.
- [x] **T2.2** Tables in `pg.ts` and `sqlite.ts` from `fields.ts`:
  `deployment_settings`, `schema_meta` (both with the singleton guard),
  `user`, `user_token`, `api_token`, `session`. Constraints and indexes per
  `data-model.md`, incl. the `user_token` partial unique and the `user`
  `lower(email)` unique / `COLLATE NOCASE`.
  *done when:* `drizzle-kit generate` produces a first migration for each
  dialect; `drizzle-kit check` green for both.
- [x] **T2.3** `src/db/schema/types.ts`: canonical row/insert types for those
  tables. `src/db/schema/version.ts` with `SUPPORTED_SCHEMA_RANGE`.
  *done when:* `tsc --noEmit` passes; a type-level test pins the row shape.
- [x] **T2.4** Adapters: `src/db/adapters/postgres.ts` (postgres.js, `search_path`),
  `src/db/adapters/sqlite.ts` (`PRAGMA foreign_keys = ON`, `journal_mode = WAL`,
  busy timeout). A `makeDb(url)` that picks the adapter from the URL scheme.
  *done when:* an integration test connects to each (Postgres via a service
  container / local, SQLite via a temp file) and runs `select 1`.
- [x] **T2.5** `UnitOfWork`: `uow.run(fn)`, `tx.lockVehicle(id)`,
  `tx.lockSettings()`. Postgres uses `FOR UPDATE`; SQLite brackets
  `BEGIN IMMEDIATE`/`COMMIT`/`ROLLBACK` with a synchronous body.
  *done when:* a test proves rollback on throw, commit on return, and that a
  promise-returning SQLite callback throws early.
- [x] **T2.6** `src/db/schema/mappers.ts` + repo base: `rowToDomain` /
  `domainToRow` per table; `Number.isSafeInteger` guard on the bigint fields.
  *done when:* round-trip test per table on both adapters.
- [x] **T2.7** Repositories for the slice-2 tables (`SettingsRepo`, `UserRepo`
  subset, `UserTokenRepo`, `ApiTokenRepo`, `SessionRepo`) against the ports.
  *done when:* repository tests pass in the `[postgres, sqlite]` matrix.
- [x] **T2.8** Fixture loader in `test/support`: direct full-privilege
  connection, seeds either adapter; add `clean` (users only, no vehicles yet).
  *done when:* the loader seeds both adapters and a test reads the rows back.

## Slice 3 — Bootstrap

- [x] **T3.1** Privilege probe: Postgres `has_schema_privilege` /
  `has_table_privilege` per the `data-model.md` grant lists, each false mapped
  to the `GRANT` line; SQLite = file writable + `PRAGMA foreign_keys` settable.
  *done when:* a test with a deliberately under-granted Postgres role gets the
  exact missing-grant message (AC-2).
- [x] **T3.2** `bin/chotu.ts` `bootstrap`: run migrations for the active
  dialect, write `schema_meta`, validate against `SUPPORTED_SCHEMA_RANGE`.
  *done when:* a fresh temp DB is migrated and `schema_meta` is set; a
  tampered version stops startup (FR-1.3).
- [x] **T3.3** Seed `deployment_settings` (flags or defaults) and the first
  admin via all three credential paths (`--admin-email`+`--admin-password`;
  `user_token` `set_password` link; seeded `scott@chotu.local`/`tiger` with
  `must_change_password`). Issue one `api_token`, print once.
  *done when:* each path produces a usable admin row; the `scott` path sets the
  flag and prints the warning (AC-1).
- [x] **T3.4** Startup guards in `env.ts` / `index.ts`: refuse SQLite when
  `CHOTU_ENV=production` (FR-1.10); refuse to start in production while a seeded
  default-password admin exists (FR-1.6).
  *done when:* both refusals are covered by tests (AC-12) and print why.
- [ ] **T3.5** `chotu token issue` / `token revoke`.
  *done when:* issue prints a `cht_` token once; revoke marks it; a CLI test
  covers both.

## Slice 4 — Cross-cutting middleware + auth core

- [ ] **T4.1** Middleware: `request-id`, `logging` with the redaction list,
  `cors` (from `CORS_ALLOWED_ORIGINS`), `error` (the `{code,message,details}`
  body), mounted in `app.ts`.
  *done when:* tests assert the error body shape and that a redacted field never
  appears in a captured log line.
- [ ] **T4.2** `domain/errors.ts` closed union + HTTP mapping table from
  `plan.md` section 12.
  *done when:* a test enumerates every code and its status.
- [ ] **T4.3** Password sign-in (`@node-rs/argon2`), `session` create (`chs_`),
  cookie + response-body credential (Q-11). Generic failure message.
  *done when:* a good sign-in returns a session; a wrong password returns the
  same generic `401`; rate-limit not yet required here.
- [ ] **T4.4** Auth middleware: resolve `chs_` session vs `cht_` token by
  prefix; load the `user`; reject `deactivated` (FR-2.5); set `ctx.user`. Update
  `api_token.last_used_at` off the main transaction (FR-5.2).
  *done when:* session, token, expired, revoked, and deactivated cases each
  return the right status.
- [ ] **T4.5** `must-change-password` gate middleware (FR-4.5); sign-out
  (FR-2.4).
  *done when:* a `must_change_password` user gets `403 password_change_required`
  on everything except change-password; sign-out revokes.
- [ ] **T4.6** API token routes: create (`cht_`, once), list, revoke (FR-5).
  Several active per user.
  *done when:* contract tests for the three routes pass on both adapters.
- [ ] **T4.7** Rate-limit middleware (token bucket, per IP + per account,
  `TRUSTED_PROXY` handling, `429` + `Retry-After`) on sign-in and the reset and
  invite routes when they land.
  *done when:* a burst past the draft threshold returns `429` with the header.
- [ ] **T4.8** OpenAPI pipeline: `contract/build.ts`, `pnpm openapi:write`
  writes `openapi.yaml`, `GET /openapi.yaml` and `GET /healthz` served
  unauthenticated (FR-19). CI OpenAPI gates go live; add the `BREAKING-OPENAPI:`
  trailer check to `oasdiff`.
  *done when:* `openapi.yaml` is committed, `git diff --exit-code` clean after
  regen, Spectral passes, health returns the schema version.

## Slice 5a — User profile + audit

- [ ] **T5a.1** `audit_log` table (both dialects) + `AuditRepo`; the audit
  `INSERT` runs inside the caller's `uow.run`.
  *done when:* `drizzle-kit check` green both dialects; a test shows the audit
  row rolls back with a failed mutation.
- [ ] **T5a.2** `test/support` audit-delta helper: wrap a call, assert
  `audit_log` grew by exactly 1 with the expected `action`.
  *done when:* the helper is used in one passing test.
- [ ] **T5a.3** Profile routes: `GET`/`PATCH` own profile (display name, unit
  system, time zone; currency is read-only USD). No entry rewrite on a unit
  change (FR-7.1, FR-7.2).
  *done when:* contract tests pass on both adapters.
- [ ] **T5a.4** Self-delete (FR-7.3): removes the user's vehicles, entries,
  tokens, sessions, identities; audit row without personal content; blocked for
  the last active admin (FR-7.4).
  *done when:* cascade verified; last-admin self-delete rejected.

## Slice 5b — Admin read

- [ ] **T5b.1** `admin` gate middleware (role check, not just a valid
  credential).
  *done when:* a non-admin credential gets `403` on an admin route.
- [ ] **T5b.2** `GET /admin/users` list (email, role, status, created, vehicle
  count; no entry contents) and `GET /admin/users/:id` detail (adds last
  sign-in, linked identities, active token count) — FR-8.1, FR-8.2.
  *done when:* contract tests pass; no fuel-entry field appears in either
  response schema.

## Slice 5c — Admin mutations + INV-6

- [ ] **T5c.1** Create user directly (FR-8.3); deactivate / reactivate
  (FR-8.4) with immediate session+token cut-off.
  *done when:* a deactivated user's existing session returns `401` next request.
- [ ] **T5c.2** Trigger reset for a user (FR-8.5 / FR-4.4) — issues a
  `user_token` `reset`; audited.
  *done when:* audit-delta test passes; the link is returned or sent per config.
- [ ] **T5c.3** Grant / revoke admin (FR-8.7); delete user + data (FR-8.6) with
  explicit confirm.
  *done when:* contract tests pass; delete cascades like self-delete.
- [ ] **T5c.4** INV-6 last-admin lock: all of demote, deactivate, delete run in
  `uow.run` after `tx.lockSettings`; refuse with `last_admin`. Add the
  `last-admin` fixture and a `Promise.all` contention test (Postgres race;
  SQLite serialisation).
  *done when:* the fixture proves all three are blocked; the race test never
  reaches zero admins (AC-8).
- [ ] **T5c.5** Audit assertions across every 5c action (AC-9).
  *done when:* one audit-delta assertion per action, all green.

## Slice 6a — Invitations

- [ ] **T6a.1** `invitation` table + `InvitationRepo` (both dialects).
  *done when:* `drizzle-kit check` green; repo tests pass.
- [ ] **T6a.2** `POST /admin/invitations` (email, invited role, expiry → single
  use link) and `POST /invitations/accept` (set display name + password,
  consume) — FR-3.2, FR-3.3, FR-3.4.
  *done when:* accept creates the user; an expired / reused / unknown token is
  rejected with the specific code.
- [ ] **T6a.3** `invite` fixture (pending, expired, accepted); rate-limit
  accept.
  *done when:* fixture loads; a burst on accept returns `429`.

## Slice 6b — Registration policy + verification

- [ ] **T6b.1** Policy switch on `deployment_settings.registration_policy`
  (FR-3.1) via `PATCH /admin/settings`; FR-9.2 guard on removing `password`.
  *done when:* removing `password` while a user has no identity is rejected
  `auth_method_required`.
- [ ] **T6b.2** `open` self-register: `POST /register` creates an unverified
  user + a `user_token` `verify`; `POST /verify` consumes it and sets
  `email_verified_at`; unverified users cannot sign in (FR-3.5).
  *done when:* the flow works; the verify link is returned when `EMAIL_*` is
  unset (R-2 interim).

## Slice 7 — OIDC

- [ ] **T7.1** `oidc_provider` and `oidc_login` tables + repos + `identity`
  table + `IdentityRepo` (both dialects; FKs per `data-model.md`).
  *done when:* `drizzle-kit check` green; repo tests pass.
- [ ] **T7.2** Admin provider CRUD (FR-6.1, FR-9.3): secret write-only, never
  returned; delete rejected `provider_in_use` unless `force` (then unlink +
  re-check FR-6.3).
  *done when:* contract tests pass; a GET never includes the secret.
- [ ] **T7.3** `GET /auth/oidc/:key/start` (create `oidc_login`, redirect) and
  `/callback` (hash `state`, look up by `state_hash`, validate token+nonce,
  match/create `identity`, enforce domains/groups, auto-provision on
  `sso_auto`, consume, start session) — FR-6.2, FR-6.4.
  *done when:* the mock issuer flow completes and an out-of-domain sign-in is
  rejected (AC-11).
- [ ] **T7.4** Link / unlink an identity for a signed-in user; unlink refused
  when it would leave no sign-in method (FR-6.3).
  *done when:* link works; the last-method unlink is rejected
  `auth_method_required`.
- [ ] **T7.5** Mock OIDC issuer in `test/support`: discovery doc, JWKS, signed
  ID tokens, configurable `email` / `groups`. `oidc` fixture.
  *done when:* `openid-client` v6 validates the mock tokens end to end.

## Slice 8 — Vehicles

- [ ] **T8.1** `vehicle` table + `VehicleRepo` (both dialects); `name` unique
  per user among non-archived; FK `on delete restrict`.
  *done when:* `drizzle-kit check` green; repo tests pass.
- [ ] **T8.2** `units/` module: `toCanonical` / `fromCanonical`, half-away-from-
  zero rounding, `roundVolume`, `formatPrice`, distance display precision.
  *done when:* property test — imperial round trip is exact, metric round trip
  is stable at display precision (FR-15.4).
- [ ] **T8.3** Vehicle routes: create (starting odometer in the caller's units),
  list, get, update, archive / unarchive, delete with cascade flag; wrong-owner
  → `404` (FR-11).
  *done when:* contract tests on both adapters; the isolation-matrix test covers
  every vehicle route.

## Slice 9a — Fuel entries core

- [ ] **T9a.1** `fuel_entry` table + `FuelEntryRepo` (both dialects); index
  `(vehicle_id, entry_date desc, created_at desc)`; FK `on delete restrict`;
  per-row `CHECK`s.
  *done when:* `drizzle-kit check` green; repo tests pass.
- [ ] **T9a.2** Create / get / update / delete for an owned, non-archived
  vehicle; store canonical integers + `source_unit_system` + `source_payload`;
  response carries canonical + display projection (FR-12, FR-15.3).
  *done when:* contract tests pass; a metric create reads back the same display
  value.
- [ ] **T9a.3** INV-3 (archived vehicle rejects writes) and INV-4 (entry date
  ≤ 2 days ahead in the user tz).
  *done when:* both rejections covered with the right codes.

## Slice 9b — Odometer progression

- [ ] **T9b.1** INV-2: in `uow.run` after `tx.lockVehicle`, read both
  neighbours in `(entry_date, created_at, id)` order, check non-decreasing and
  the first entry against `vehicle.initial_odometer_mi_e3`; reject
  `odometer_decrease`; allow a tie.
  *done when:* the `odometer-decrease` fixture (adjacent pair + mid-sequence
  back-date) drives passing tests.
- [ ] **T9b.2** Contention test: concurrent creates on one vehicle — Postgres
  real race, SQLite serialisation / `SQLITE_BUSY`.
  *done when:* no run produces a decreasing adjacent pair.

## Slice 9c — History + journey

- [ ] **T9c.1** List entries: default order `entry_date desc, created_at desc`,
  date-range filter, cursor pagination with the `(entry_date, created_at, id)`
  tiebreak stable under insert/delete; response states filter, order, page size
  (FR-14).
  *done when:* a pagination test inserts and deletes mid-scroll and never skips
  or repeats a row.
- [ ] **T9c.2** AC-5 journey suite over a real socket: invite → accept → sign in
  → add vehicle → add fill-up → correct entry, bearer only, no DB access.
  *done when:* the journey test passes against both adapters.

## Slice 10 — Reconciliation + export

- [ ] **T10.1** `reconcile/` check registry: `duplicate`, `orphaned`,
  `odometer-tie`, `odometer-decrease`, `missing-field`, `out-of-range`
  (FR-17.3).
  *done when:* each fixture (`duplicate`, `orphaned`, `odometer-decrease`,
  `invalid-values`) produces exactly its expected findings; `clean` produces
  none.
- [ ] **T10.2** `GET /reconcile` (per-user) and `GET /admin/reconcile`
  (deployment-wide: record id + user id + check code only, no field values) —
  FR-17.1, FR-17.2.
  *done when:* contract tests pass; the admin response schema has no entry
  field.
- [ ] **T10.3** `GET /export` (per-user JSON: `schemaVersion`, `canonicalUnits`,
  `fuelVolumePrecision`, data) and `GET /admin/export` (all tables, secrets
  excluded) — FR-16, FR-18.1.
  *done when:* a round-trip test rebuilds the user's dataset from the export in
  a fresh account (loader, not an API import).

## Slice 11 — Hardening

- [ ] **T11.1** Fill OpenAPI descriptions for LLM callers on every route
  (FR-19.3); Spectral rule for description length.
  *done when:* Spectral passes with the description rule on.
- [ ] **T11.2** Isolation-matrix test covers **every** user-scoped route
  (vehicles, entries, reconcile, export); audit-delta assertion on **every**
  admin/security action (AC-7, AC-9).
  *done when:* both matrices enumerate the full route list with no gaps.
- [ ] **T11.3** Confirm every AC-1..AC-12 has a named test; add a
  `test/support/ac-coverage.test.ts` that asserts the mapping.
  *done when:* the coverage test lists a test id for each AC.
- [ ] **T11.4** Tune rate-limit thresholds from the spec NFR into config
  defaults; redaction audit over all log call sites.
  *done when:* a log-scan test finds no secret-bearing field logged.
- [ ] **T11.5** `pnpm -w run verify` and full CI green; tag the slice.
  *done when:* CI green on `build/m1`; BUILD STATE marked M1 complete.

---

## Deferred (not M1)

`chotu` CLI beyond bootstrap/token (M1.5), the SPA, data import + restore
(`0002`/M2), R-1/R-2/R-3 research items.
