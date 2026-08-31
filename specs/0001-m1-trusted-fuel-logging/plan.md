# 0001 — Plan

- **Status:** draft, revised after independent review, awaiting approval
- **Prereq:** `spec.md`, `data-model.md`, `user-stories.md` are reviewed.
- **Related:** `../constitution.md`, `../research-backlog.md`
- **Produces next:** `tasks.md` after this plan is approved.

Names the components, the contracts between them, the build order, and the
risks. No code. FR / AC / INV references point at `spec.md` and `data-model.md`.

## 0. Constitution deviations recorded here

- The constitution tech table lists Playwright for end-to-end. M1 has no UI, so
  end-to-end is a Vitest suite over a real socket instead. The plan commit body
  records this.

## 1. Approach

Build one `packages/api` service. Drive every capability from the HTTP API. Keep
two machine-readable sources of truth — the Zod route schemas and the Drizzle
table schemas — and generate everything else. CI blocks drift
(`specs/README.md` gate list).

Build in vertical slices in the order in section 18, each ending green on the
full CI pipeline. The build is resumable: `tasks.md` holds a `BUILD STATE`
header and a checkbox per task, one commit per verified task on a long-lived
branch.

## 2. Workspace and tooling

pnpm workspace. One package now, room for `cli` (M1.5) and `web` later.

```
chotu-app/
  package.json                 workspace root, shared scripts
  pnpm-workspace.yaml
  tsconfig.base.json           strict, moduleResolution NodeNext, target ES2022
  .nvmrc                       20
  eslint.config.js             flat config, typescript-eslint + local rules
  vitest.workspace.ts
  openapi.yaml                 generated, committed
  packages/
    api/
      package.json
      tsconfig.json
      drizzle.pg.config.ts     Postgres: out db/migrations/postgres
      drizzle.sqlite.config.ts SQLite:   out db/migrations/sqlite
      src/
        index.ts               compose app, start @hono/node-server
        env.ts                 parse + validate process env with zod
        app.ts                 build the Hono app, mount middleware + routes
        contract/              OpenAPI document builder + generated types
        routes/                @hono/zod-openapi definitions, one file per resource
        middleware/            request-id, logging+redaction, cors, rate-limit,
                               auth, must-change-password, admin, error
        domain/
          ports.ts             repo + UnitOfWork interfaces the services depend on
          errors.ts            closed union of error codes
          <service>.ts         users, vehicles, fuelEntries, reconcile, export ...
        auth/                  password, session, api-token, oidc, guards
        units/                 canonical integer conversion
        reconcile/             check registry + runner
        export/                JSON export builder
        db/
          schema/
            fields.ts          shared field-spec helpers (name -> {pg, sqlite})
            pg.ts              Postgres tables built from fields.ts
            sqlite.ts         SQLite tables built from fields.ts
            types.ts          the canonical row/insert types the domain uses
          adapters/
            postgres.ts       postgres.js client + UnitOfWork (FOR UPDATE)
            sqlite.ts         better-sqlite3 client + UnitOfWork (BEGIN IMMEDIATE)
          migrations/
            postgres/          drizzle-kit output + journal
            sqlite/            drizzle-kit output + journal
          repositories/       implement ports.ts per adapter, with a row-mapping layer
          bootstrap.ts        privilege probe, migrate, seed, issue token
        bin/
          chotu.ts             CLI entry: bootstrap, token issue, token revoke
      test/
        fixtures/              the nine fixtures from data-model.md
        support/               mock OIDC issuer, adapter harness, fixture loader
        contract/              response-vs-openapi assertions, isolation matrix
        journey/               end-to-end API journeys (AC-5, AC-11, AC-12)
```

### Dual-dialect Drizzle — the mechanics

`drizzle-kit` is per dialect. There are **two** of everything schema-related:

- `db/schema/pg.ts` and `db/schema/sqlite.ts`, each built from the same
  `fields.ts` helpers so the column set cannot drift. `fields.ts` maps a logical
  field to a `pg` builder and a `sqlite` builder (uuid/text, timestamptz/ISO
  text, jsonb/typed vs text/JSON, `text[]` vs JSON text, boolean mapping,
  `date`).
- Two drizzle configs, two migration histories under
  `db/migrations/{postgres,sqlite}/`, two journals.
- CI runs `drizzle-kit generate` and `drizzle-kit check` once per dialect
  (section 15). A missing or diverged migration in either fails.

The inferred types from `pgTable` and `sqliteTable` differ (Date vs string
timestamps, typed vs string JSON, number vs 0/1 booleans). `db/schema/types.ts`
declares the **canonical row and insert types** the domain uses. Each repository
has a thin mapping function per table, `rowToDomain` / `domainToRow`, that
normalises both dialects to those canonical types. The domain layer never sees a
Drizzle inferred type.

### Numeric type for the canonical integers

`odometer_mi_e3`, `volume_gal_e3`, `total_cost_usd_cents` are JS `number`. Max
realistic odometer is 2,000,000 mi = 2e9 thousandths, far under
`Number.MAX_SAFE_INTEGER` (9.007e15). Volume and cost are far smaller. Drizzle's
`bigint` column is read back as a string on some drivers, so the mapping layer
parses to `number` and a guard asserts `Number.isSafeInteger`.

### Key dependencies (pin exact versions at setup)

| Concern | Choice | Note |
|---|---|---|
| HTTP | `hono` + `@hono/node-server` | in-process `app.request()` for tests, real socket for journey tests |
| API contract | `@hono/zod-openapi`, `zod` | Zod schema is the source, emits OpenAPI 3.1 |
| ORM | `drizzle-orm`, `drizzle-kit` | `drizzle-orm/postgres-js` and `drizzle-orm/better-sqlite3` |
| PG driver | `postgres` (postgres.js) | supports `SELECT ... FOR UPDATE`, works with drizzle |
| SQLite driver | `better-sqlite3` | synchronous; `PRAGMA foreign_keys = ON`, `journal_mode = WAL`; dev and test only (FR-1.10) |
| Password hash | `@node-rs/argon2` | Argon2id, prebuilt binaries, no node-gyp |
| OIDC RP | `openid-client` v6 | Authorization Code + PKCE (FR-6.2), wrapped behind `auth/oidc/` |
| IDs | `uuidv7` | time-ordered keys (D-4) |
| Rate limit | in-house token bucket over a pluggable store | memory store now (FR-2.6) |
| Lint | `eslint` + `typescript-eslint` | flat config; local rules for the isolation guard |
| Test runner | `vitest` | unit + repository + contract + journey |
| Spec lint | `@stoplight/spectral-cli` | CI gate 1 |
| Breaking-change | `oasdiff` (binary) | CI gate 2 |

### Plan decisions to confirm in review

- `openid-client` v6 as the OIDC RP, wrapped so a swap is local.
- `@node-rs/argon2` over `argon2` (avoids node-gyp on CI and dev machines).
- `postgres.js` over `pg`.
- Tests hit the app in-process via `app.request()`, plus one real-socket journey
  suite. No Playwright in M1 (no UI). Constitution deviation recorded in
  section 0.
- Rate-limit store is in-memory for M1; a shared store waits for R-1.

## 3. Request flow

```
HTTP request
  -> request-id
  -> structured log + redaction        (drop passwords, tokens, cookies, entry values)
  -> cors                              (CORS_ALLOWED_ORIGINS; noop when empty)
  -> rate-limit                        (sign-in, reset request, invite accept; FR-2.6)
  -> auth                              (resolve chs_ session or cht_ token; load the user row;
                                        reject 401 if the user is deactivated; set ctx.user; FR-2.2, FR-2.5)
  -> must-change-password gate         (403 password_change_required except change-password; FR-4.5)
  -> admin gate                        (admin routes only; FR-8/9/10; constitution principle 8)
  -> zod-openapi route handler         (validate request, shape response)
  -> domain service                    (typed, no HTTP, no SQL dialect)
  -> ports (repo + UnitOfWork)         (interfaces in domain/ports.ts)
  -> Drizzle adapter                   (postgres or sqlite)
  -> database
```

The domain layer never imports Hono or a Drizzle dialect. Routes never build
SQL. FR-15 conversion, FR-13 invariants, and INV-9 isolation each live in one
place and are testable without a server.

## 4. Persistence contract and adapters

### Ports

`domain/ports.ts` declares `UserRepo`, `VehicleRepo`, `FuelEntryRepo`,
`TokenRepo`, `SessionRepo`, `UserTokenRepo`, `IdentityRepo`, `OidcLoginRepo`,
`InvitationRepo`, `AuditRepo`, `SettingsRepo`, `ReconcileRepo`, and a
`UnitOfWork`. Services get repos from a small container. Tests pass a real
adapter or an in-memory fake.

### UnitOfWork contract

`uow.run(async (tx) => { ... })` runs the callback in one transaction and
commits on resolve, rolls back on throw. **Rule:** the callback does only
database work and pure computation — no network, no timers, no `await` on
non-DB promises. `better-sqlite3` rejects a promise-returning transaction
callback outright, so the SQLite adapter does **not** use Drizzle's native
`transaction()` wrapper for the locking path; it brackets the work with explicit
`BEGIN IMMEDIATE` / `COMMIT` / `ROLLBACK` statements and a synchronous body.
`tx.lockVehicle(id)` and `tx.lockSettings()` take the row lock for the current
transaction: `SELECT ... FOR UPDATE` on Postgres; on SQLite the `BEGIN
IMMEDIATE` already holds the database write lock for the whole check-and-write. The `audit_log` insert for an action runs inside
the same `uow.run` as the mutation, so the pair commits or rolls back together
(AC-9).

### Adapter specifics

- `db/adapters/sqlite.ts` runs `PRAGMA foreign_keys = ON` and
  `PRAGMA journal_mode = WAL` on every connection. Without the first, INV-1 and
  the `on delete restrict` guards (FR-11.5, FR-12.6) do not hold and the
  `orphaned` fixture is meaningless.
- `db/adapters/postgres.ts` sets `search_path` to the Chotu schema and uses the
  low-privilege API role at runtime (FR-1.9).

### Locking summary

| Rule | Lock | Then |
|---|---|---|
| INV-2 odometer progression | vehicle row | read the two neighbours in `(entry_date, created_at, id)` order, check both, and check the earliest entry against `vehicle.initial_odometer_mi_e3` |
| INV-6 last active admin | `deployment_settings` singleton row | count `role='admin' AND status='active'`, apply the change, refuse if it would reach zero |

M1 uses application locks only. No database trigger or deferred constraint,
because a trigger would not port cleanly across Postgres and SQLite and the lock
already closes the race. Deliberate deviation from the data-model "trigger as a
backstop" note, now also recorded there.

## 5. Units

`units/` holds pure functions. Only canonical integers cross the persistence
boundary (D-1): `odometer_mi_e3`, `volume_gal_e3`, `total_cost_usd_cents`.

- `toCanonical(value, unitSystem, quantity)` / `fromCanonical(...)`.
- `imperial` is a direct scale. `metric` converts km→mi and L→gal with fixed
  factors, then scales. Rounding mode is **half away from zero** at every step,
  fixed in one place.
- `roundVolume(value, precision)` and `formatPrice(...)` apply
  `deployment_settings.fuel_volume_precision` (default 3, range 1..3). Storage
  stays scale 3; the setting only bounds accepted and displayed digits.
- Distance display: odometer is shown to 1 decimal mile for `imperial`, 1
  decimal km for `metric`. The `0.001 mi` storage quantum (~1.6 m) is below that,
  so a metric user editing an odometer sees no visible drift.
- Property test (FR-15.4): for `imperial`, create then read returns the exact
  input. For `metric`, the displayed value at its display precision is
  unchanged after a create-then-read round trip.

## 6. Validation and invariants — where each lives

| Rule | Enforced by |
|---|---|
| positive volume, non-negative cost and odometer, enum membership, FK, `fuel_volume_precision` 1..3, single-row guards | generated DB `CHECK` / FK / unique index |
| INV-1 ownership chain | FKs on both dialects (`PRAGMA foreign_keys = ON` for SQLite) + repo methods that always scope by `userId` |
| INV-2 odometer progression, both neighbours + `initial_odometer` floor | `FuelEntryRepo` inside `uow.run` with `tx.lockVehicle` |
| INV-3 archived vehicle read-only for entries | `FuelEntry` service |
| INV-4 future date <= 2 days in the user's tz | `FuelEntry` service (needs `user.time_zone`) |
| INV-6 last active admin | `User` service inside `uow.run` with `tx.lockSettings` |
| INV-7 email uniqueness | `lower(email)` unique index + friendly `email_taken` mapping |
| INV-8 identity uniqueness | `(provider_key, subject)` unique index |
| INV-9 per-user isolation | every user-scoped repo method takes `userId` and joins through `vehicle`; an ESLint local rule bans raw `fuelEntry`/`vehicle` table refs outside their repo module; the isolation matrix test (section 14) |
| FR-2.5 deactivated user | auth middleware loads the user and rejects `deactivated` on every request |
| FR-6.3 unlink only if a sign-in method remains | `Identity` service: refuse the unlink when it would leave no `password_hash` and no other `identity` |
| FR-9.2 keep `password` available | `Settings` service: refuse removing `password` from `allowed_auth_methods` while any `user` has no `identity` |

## 7. Bootstrap and schema lifecycle

`bin/chotu.ts` exposes `bootstrap`, `token issue`, `token revoke`.

`bootstrap` (FR-1):
1. Connect with `DATABASE_BOOTSTRAP_URL`. Probe privileges: on Postgres,
   `has_schema_privilege` / `has_table_privilege` per the concrete grant list in
   `data-model.md`; a false result prints the exact `GRANT` to run (FR-1.4,
   AC-2). On SQLite, check the file is writable and `PRAGMA foreign_keys` sets.
2. Apply the migrations for the active dialect. Write `schema_meta` (version,
   build, `applied_at`). The build carries `SUPPORTED_SCHEMA_RANGE` in
   `db/schema/version.ts`; a `schema_meta.schema_version` outside it stops
   startup (FR-1.3).
3. Create the `deployment_settings` singleton from flags or defaults
   (`invite_only`, `imperial`, `USD`, `America/New_York`,
   `fuel_volume_precision=3`, TTLs).
4. Create the first admin: `--admin-email` + `--admin-password`; or issue a
   `user_token` with `purpose='set_password'` and print the link; or seed
   `scott@chotu.local` / `tiger` with `must_change_password` and a printed
   warning (FR-1.5).
5. Issue one `api_token` for that admin, print once (FR-1.7).

Startup (`index.ts` via `env.ts`): mode from `CHOTU_ENV`. In `production`,
refuse to start if any admin still holds an unchanged seeded default password
(FR-1.6, AC-12), and refuse a SQLite `DATABASE_URL` (FR-1.10). Runtime uses
`DATABASE_URL` with the API role.

## 8. Auth

### Sessions (FR-2)
Opaque 256-bit id with a `chs_` prefix, stored as SHA-256 in `session`. Sent as
an `HttpOnly Secure SameSite=Lax` cookie and echoed in the sign-in response body
for headless clients (Q-11, constitution). Sign-out and reset revoke. TTL from
settings. A state-changing route accepts the bearer value or a non-simple header,
not the cookie alone; full CSRF handling for the future SPA is deferred and
noted here.

### API tokens (FR-5)
`cht_` prefix + 256-bit random, shown once, stored as SHA-256 in `api_token`
with `user_id` and `label`. Several active per user (Q-8 = A). Optional expiry
from `api_token_ttl_seconds`. The auth middleware picks session vs token by
prefix and updates `last_used_at` on a token hit (FR-5.2), outside the request's
main transaction.

### Passwords (FR-4)
`@node-rs/argon2` Argon2id, parameters fixed in `auth/password.ts`. Reset,
verify, and set-password tokens all live in `user_token` (`purpose`), 256-bit
random, SHA-256 at rest, short TTL, single use. A partial unique index on
`(user_id, purpose) WHERE used_at IS NULL` keeps at most one unused token per
purpose per user; issuing a new one deletes the prior unused row. Expiry is
enforced in the application. `must_change_password` gate is middleware (FR-4.5).
Change-password accepts a session or a token so the seeded admin can clear it
(FR-4.1).

### OIDC (FR-6)
`openid-client` RP behind `auth/oidc/`. Per provider: discovery from
`issuer_url`, Authorization Code + PKCE. Routes `GET /auth/oidc/:key/start` and
`GET /auth/oidc/:key/callback`, both in the FR-2.2 unauth list. `start` creates
an `oidc_login` row (`state_hash`, `code_verifier`, `nonce`, `redirect_to`,
short `expires_at`) and redirects. The random `state` is the login-CSRF binding:
`callback` hashes the incoming `state`, looks up by `state_hash`, rejects an
unknown, expired, or already-consumed row, validates the token and nonce,
matches or creates `identity` by `(provider_key, sub)`, enforces
`allowed_email_domains` / `allowed_groups`, auto-provisions when enabled and
policy is `sso_auto`, marks the `oidc_login` consumed, and starts a session.
Deleting a provider that has linked `identity` rows is rejected
(`provider_in_use`) unless the admin passes `force`, which unlinks them first
and then re-checks FR-6.3 per affected user; `oidc_login` rows cascade.
Client secret is write-only over the API; stored per R-3 (plan default:
environment reference; DB-encrypted value supported later). Tests use the mock
issuer (section 14). The Device Authorization Grant is M1.5.

### Rate limiting (FR-2.6, NFR)
Token-bucket middleware on sign-in, reset request, invite accept. Keyed per IP
and per account. The client IP is the socket peer address unless
`TRUSTED_PROXY=true`, in which case the last hop of `X-Forwarded-For` is used;
never trust the header by default. Draft limits from the spec NFR, read from
config. `429` + `Retry-After`.

### Expired-row cleanup
`session`, `user_token`, and `oidc_login` accumulate dead rows. A sweep deletes
expired rows on startup and on a cheap interval; each lookup also deletes the
row it finds expired. No external scheduler.

## 9. Reconciliation

`reconcile/` holds a registry of checks, each `(scope) => Finding[]`:
`duplicate` (same vehicle, entry date, odometer, volume, total cost),
`orphaned`, `odometer-tie`, `odometer-decrease`, `missing-field`,
`out-of-range` (FR-17.3). A per-user run scopes to one user (FR-17.1). The
deployment run iterates users and returns `{recordId, userId, checkCode,
message}` with no field values (FR-17.2, INV-9). Read-only.

## 10. Export

`export/` builds one JSON document: `{schemaVersion, canonicalUnits,
fuelVolumePrecision, exportedAt, profile, vehicles[], fuelEntries[]}` (FR-16,
Q-6 = A). Per-user for a user; all tables for an admin backup (FR-18.1) with
secrets excluded. No import in M1.

## 11. OpenAPI pipeline

`contract/build.ts` assembles the document from the `@hono/zod-openapi`
registry. `pnpm openapi:write` writes `openapi.yaml`. The API serves the same
document at `GET /openapi.yaml`; `GET /healthz` returns liveness and the applied
schema version (FR-19.1, FR-19.4), both unauthenticated. CI regenerates and runs
`git diff --exit-code` (gate 3, FR-19.2).

**Breaking-change note (gate 2).** `oasdiff` compares base vs head. A run that
reports a breaking change fails **unless** the head commit message carries a
`BREAKING-OPENAPI: <reason>` trailer, which is the deliberate acknowledgement
and also feeds the changelog.

Every route documents request, response, `security`, and error codes, with prose
aimed at an LLM caller (FR-19.3).

## 12. Error model

One body: `{ code, message, details? }`. `code` is a closed union in
`domain/errors.ts`, listed in every route's OpenAPI responses. HTTP mapping:
validation `400`; auth `401`; wrong-owner surfaces as `404` for vehicle and
entry (FR-11.6, FR-12.6); `403` `password_change_required`; `409` `email_taken`,
`invitation_consumed`; `422` `odometer_decrease`, `last_admin`,
`auth_method_required` (FR-6.3, FR-9.2); `429` rate-limited.

## 13. Observability

`middleware/logging.ts`: one structured line per request — request id, method,
path, status, duration, user id when present. A redaction list drops passwords,
tokens, cookies, and fuel-entry field values from any logged object (NFR
observability). No telemetry backend in M1.

## 14. Testing

| Layer | Tool | What |
|---|---|---|
| unit | vitest | units conversion + rounding, invariant helpers, error mapping, token and password helpers |
| repository | vitest + adapter harness | each repo method on Postgres and SQLite; the INV-2 and INV-6 lock paths under `Promise.all` contention |
| contract | vitest | `app.request()` for every route, assert the response validates against `openapi.yaml` (AC-10); the whole file runs twice, matrix `[postgres, sqlite]` (AC-4) |
| isolation matrix | vitest | table over every vehicle and fuel-entry route: a request as user A with user B's id returns `404`; an admin credential cannot read a user's entries (AC-7) |
| audit delta | vitest helper | wrap each admin/security call, assert `audit_log` grew by exactly 1 with the right `action` (AC-9) |
| journey | vitest + `@hono/node-server` | the AC-5 sequence over a real socket; the AC-12 production-guard and `must_change_password` path; the AC-11 OIDC flow against the mock issuer |

- **Mock OIDC issuer** (`test/support/oidc-issuer.ts`): serves an OIDC discovery
  document, a JWKS with one key, and signs ID tokens so `openid-client` v6
  signature and nonce validation pass. Configurable `email` / `groups` claims.
- **Contention on SQLite** is not a true race (`better-sqlite3` is synchronous):
  the SQLite contention test asserts serialisation and `SQLITE_BUSY` handling.
  The real race assertion is the Postgres run.
- **Fixture loader** uses a test-only direct connection with full privileges, so
  it can seed `orphaned` (FK off for that insert). See `data-model.md` fixtures.
- Postgres in CI: a `services: postgres` container. SQLite: a temp file per test
  file. The adapter harness parametrises repository and contract tests over
  `['postgres', 'sqlite']`.

## 15. CI pipeline

One workflow. Jobs map to the `specs/README.md` gates. Timing:

- The **Drizzle halves** of gate 3 (per-dialect `generate` then diff) and gate 4
  (`drizzle-kit check` per dialect) are blocking **from slice 2**, when the
  first schema lands.
- The **OpenAPI halves** — gate 1 (Spectral), gate 2 (`oasdiff`), and the
  `openapi.yaml` diff in gate 3 — are no-op until `openapi.yaml` first exists in
  **slice 4**, then blocking.
- Gates 5–7 grow with the code and are blocking throughout.

1. `spec-lint` — Spectral on `openapi.yaml`.
2. `breaking-change` — `oasdiff` base vs head; fail on a breaking change unless
   the head commit carries `BREAKING-OPENAPI:`.
3. `codegen-clean` — `pnpm openapi:write` then `git diff --exit-code`; and
   `drizzle-kit generate` for **each** dialect then `git diff --exit-code`.
4. `schema-drift` — `drizzle-kit check` for **each** dialect.
5. `typecheck` — `tsc --noEmit` across the workspace.
6. `contract` — the contract + isolation-matrix suites, matrix `[postgres, sqlite]`.
7. `test` — unit, repository, audit-delta, and journey suites, matrix
   `[postgres, sqlite]`.

Slice 1 rewrites the existing `ci.yml` Node steps for **pnpm** (`pnpm install
--frozen-lockfile`, `pnpm -r test`, `pnpm` cache) — they are npm today. The
`gitleaks` job stays. All jobs keep `permissions: contents: read` and use no
secrets, so they run on fork PRs.

## 16. Configuration surface

`env.ts` validates these. Replaces the reverted `.env.example`; lands with
slice 1. Old-name mapping so nothing is lost:

| New var | Was | Purpose |
|---|---|---|
| `CHOTU_ENV` | *(new)* | `development` or `production`; gates SQLite and the seeded-admin guard |
| `DATABASE_URL` | same | runtime connection, API role; scheme picks the adapter. Dev default `file:./chotu.db` (SQLite; constitution) |
| `DATABASE_BOOTSTRAP_URL` | same | bootstrap connection, DDL role |
| `PORT` | same | HTTP port |
| `CHOTU_BASE_URL` | `PUBLIC_APP_URL` | public base URL, for OIDC redirect URIs and links |
| `SESSION_SIGNING_KEY` | `APP_SECRET` | HMAC key for the session cookie. The OIDC flow uses the server-side `oidc_login` row, so its `state` is the CSRF binding and needs no cookie |
| `TRUSTED_PROXY` | *(new, optional)* | `true` to read the client IP from the last `X-Forwarded-For` hop for rate limiting |
| `CORS_ALLOWED_ORIGINS` | same | browser origins; empty in an API-only deployment |
| `RATE_LIMIT_*` | *(new, optional)* | overrides for the draft thresholds |
| `EMAIL_*` | *(new, optional)* | when unset, links are returned in the API response (R-2 interim) |

The dev-time database is SQLite (constitution). A `docker-compose.yml` with
Postgres is provided for parity testing, not required to run the app.

## 17. Risks

| Risk | Mitigation |
|---|---|
| Two Drizzle schemas drift | both built from `fields.ts`; both `drizzle-kit check` runs are CI gates from slice 2; no feature merges adapter-red |
| `better-sqlite3` sync transaction rejects real async in `uow.run` | the UnitOfWork contract forbids non-DB await; a lint note and a test that a violating callback throws early |
| SQLite `BEGIN IMMEDIATE` contention / `SQLITE_BUSY` | busy-timeout set on the connection; contention test asserts serialisation; production is Postgres |
| SQLite FK enforcement off by default | `PRAGMA foreign_keys = ON` on every connection; a test asserts a bad FK insert fails on SQLite |
| `openid-client` v6 API churn | wrapped in `auth/oidc/`; mock-issuer tests pin behaviour |
| `@hono/zod-openapi` cannot express a response shape | hand-write that schema fragment; the codegen-clean gate still holds |
| `bigint` columns read back as strings | mapping layer parses to `number` with a `Number.isSafeInteger` guard |
| Rate-limit memory store is per-process | acceptable for single-process M1; R-1 decides the target and a shared store then |
| Transactional email undecided (R-2) | interim: return links in the response; no code path depends on a provider |
| Secret storage undecided (R-3) | interim: env reference for the OIDC secret and signing key; schema already allows a stored encrypted value later |
| Privilege probe misses a grant | probe is `has_*_privilege`-based per the concrete list, not trial DDL; each false maps to a `GRANT` line |
| Scope creep from the SPA or CLI | both out of this plan; `packages/` layout leaves room without a rewrite |

## 18. Build sequence

Each step ends green on the pipeline. The Drizzle codegen and drift gates block
from step 2; the OpenAPI gates (Spectral, oasdiff, `openapi.yaml` diff) are
no-op until step 4 (section 15). This feeds `tasks.md`, which decomposes each
step into checkbox tasks with a `done when` command.

1. **Workspace + skeleton.** pnpm workspace, `packages/api`, tsconfig strict,
   ESLint flat config with the isolation local rule stub, vitest workspace, both
   drizzle configs. Rewrite `ci.yml` for pnpm and wire the section-15 jobs
   (mostly no-op until later). `env.ts` and the config surface.
2. **DB foundation.** `fields.ts` and both schemas for `deployment_settings`,
   `schema_meta`, `user`, `user_token`, `api_token`, `session`. Migrations for
   both dialects. Adapters with `PRAGMA` settings and the `UnitOfWork` (incl.
   `lockSettings`). `db/schema/types.ts` + row mappers. Repository tests on both
   adapters. `db/schema/version.ts` with `SUPPORTED_SCHEMA_RANGE`.
3. **Bootstrap.** `chotu bootstrap`: `has_*_privilege` probe with GRANT
   messages, migrate, seed settings and first admin (all three credential
   paths), issue token. `CHOTU_ENV` guards for SQLite-in-prod and the
   seeded-admin production block. AC-1, AC-2, AC-12.
4. **Cross-cutting middleware + auth core.** request-id, logging+redaction,
   cors, error model, rate-limit. Password sign-in, sessions (`chs_`),
   `must_change_password` gate, API tokens (`cht_`), sign-out, deactivated-user
   rejection. `openapi.yaml` is first written here, so the Spectral, oasdiff,
   and `openapi.yaml`-diff gates go live and become blocking from this step.
5a. **User profile.** Profile get/update, self-delete. `audit_log` table write
    path and the audit-delta test helper. AC-7 isolation baseline for profile.
5b. **Admin read.** Admin list users, get one user detail.
5c. **Admin mutations.** Create, deactivate/reactivate, trigger reset, delete,
    grant/revoke admin, INV-6 lock via `lockSettings`, `last-admin` fixture,
    audit assertions. AC-8, AC-9.
6a. **Invitations.** Invite create and accept (password path), invite fixtures.
6b. **Registration policy + verification.** Policy switch, `open` self-register,
    `user_token` `purpose='verify'` and the email-link interim (R-2).
7. **OIDC.** Provider CRUD, `oidc_login` store, `/start` and `/callback`, link
   and unlink with the FR-6.3 guard, auto-provision, FR-9.2 guard on removing
   `password`, mock issuer tests. AC-11.
8. **Vehicles.** CRUD, archive/unarchive, delete guard, ownership `404`. Units
   module wired for `initial_odometer`. Isolation matrix extended.
9a. **Fuel entries core.** Create/get/update/delete for an owned, non-archived
    vehicle. Units display projection. INV-3, INV-4. AC-3 path.
9b. **Odometer progression.** INV-2 both-neighbour + `initial_odometer` floor
    check under `lockVehicle`; `odometer-decrease` fixture; contention tests.
9c. **History + journey.** List with date filter and cursor pagination
    (`entry_date, created_at, id` tiebreak, FR-14.2), response metadata
    (FR-14.3). The AC-5 real-socket journey.
10. **Reconciliation + export.** Check registry, per-user and deployment runs,
    per-user export, admin backup export.
11. **Hardening.** OpenAPI prose for LLM callers, finish fixtures, complete the
    contract and isolation-matrix suites, confirm every AC has a named test,
    tune rate limits, redaction audit.

## 19. Out of this plan

- The `chotu` CLI beyond `bootstrap` and token commands (M1.5).
- The web SPA.
- Data import and deployment restore (`0002` / M2).
- R-1 deployment target, R-2 email delivery, R-3 secret storage — tracked in
  `../research-backlog.md`; the interim behaviours above keep M1 unblocked.
