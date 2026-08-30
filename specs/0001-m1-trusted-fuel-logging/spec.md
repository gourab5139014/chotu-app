# 0001 — M1: Trusted fuel logging

- **Status:** draft, awaiting review
- **Milestone:** Linear M1 — Trusted fuel logging
- **Slice type:** vertical slice, API first, multi-user
- **Depends on:** none
- **Related:** `user-stories.md`, `data-model.md`, `open-questions.md`,
  `../constitution.md`

## Context

Chotu's first milestone makes vehicle fuel logging trustworthy on a
self-hosted, multi-user deployment. A signed-in user adds vehicles, records
fill-ups, corrects mistakes, and trusts the stored history. An administrator
runs the deployment: bootstrap, user management, access policy, and audit.

The HTTP API is the priority. A person operates Chotu with an LLM chat client or
another HTTP client. Every requirement below is met at the API level first. The
`chotu` CLI is M1.5. The web SPA is later.

## Goal

M1 is done when all of the following are true.

1. An admin can point Chotu at a PostgreSQL or a SQLite database, run bootstrap,
   get a first admin account, and start the API.
2. An admin can invite users. An invited person can create an account and sign
   in with email and password.
3. A signed-in user can manage their own vehicles and fuel entries over HTTP,
   and cannot see any other user's data.
4. The API rejects invalid data with a clear, machine-readable error. Odometer
   progression, units, positive amounts, ownership, and per-user isolation are
   all enforced.
5. A user can export their own data and run reconciliation checks. An admin can
   run a deployment-wide reconciliation that returns findings without fuel-entry
   contents.
6. Admin actions are written to an audit log.
7. `openapi.yaml` describes every endpoint. Contract tests pass against both
   adapters.

## Primary journeys

Each journey is a sequence of API calls now, and a screen flow later.

1. **Deploy and bootstrap.** *(admin)* Supply a database connection and
   bootstrap credentials. Chotu creates its schema, the deployment settings, a
   first admin account, and prints a one-time API token.
2. **Invite and join.** *(admin, then user)* Admin creates an invitation. The
   invited person accepts the link and sets a password.
3. **Sign in.** *(user)* Sign in with email and password. Receive a session
   credential usable by any HTTP client.
4. **Onboard.** *(user)* Set display name, unit system, currency, time zone.
5. **Add a vehicle.** *(user)* Create a vehicle with a name and a starting
   odometer.
6. **Log a fill-up.** *(user)* Post a fuel entry: date, odometer, volume, total
   cost, full-tank flag, optional notes.
7. **Review history.** *(user)* List fuel entries for a vehicle, newest first,
   paginated.
8. **Correct an entry.** *(user)* Update or delete a fuel entry. History and
   reconciliation stay consistent.
9. **Export.** *(user)* Download own data in a documented format.
10. **Operate.** *(admin)* List users, deactivate or delete an account, run
    deployment-wide reconciliation, read the audit log, take a backup.

## Functional requirements

### FR-1 Bootstrap and schema lifecycle

- FR-1.1 Chotu reads database connection details and a bootstrap credential from
  configuration.
- FR-1.2 An explicit `bootstrap` command, and an opt-in check on startup, create
  or upgrade only Chotu-owned schema objects.
- FR-1.3 Bootstrap records and validates a schema version. A version mismatch
  the running build cannot handle stops startup with an actionable error.
- FR-1.4 Missing or insufficient privileges stop bootstrap with an actionable
  error that names the missing grant. No objects outside the Chotu-owned schema
  are created or altered.
- FR-1.5 Bootstrap creates the `deployment_settings` singleton and the first
  `user` with the admin role. The operator supplies the admin email and a
  password, or bootstrap prints a one-time set-password link.
- FR-1.6 Bootstrap prints one API token for the first admin, once.
- FR-1.7 The minimum privilege set for each adapter is documented.
- FR-1.8 Routine API flows use a database role that cannot alter schema.

### FR-2 Sign-in and sessions

- FR-2.1 A user signs in with email and password. On success the API creates a
  server-side session and returns an opaque session credential. It also sets an
  HttpOnly, Secure cookie for future browser use.
- FR-2.2 Every endpoint requires a valid session or API token, except: health,
  the OpenAPI document, sign-in, invitation acceptance, password-reset request
  and completion, and the OIDC callback.
- FR-2.3 An invalid or missing credential returns `401` with the standard error
  body. A wrong email or password returns the same generic message, to avoid
  account enumeration.
- FR-2.4 Sign-out revokes the current session.
- FR-2.5 A session expires after `deployment_settings.session_ttl_seconds`. A
  deactivated user's sessions and tokens stop working immediately.

### FR-3 Registration and invitations

- FR-3.1 The registration policy is `invite_only` by default, and is set in
  `deployment_settings`. An admin can change it to `open` or `sso_auto`.
- FR-3.2 An admin creates an invitation for an email, with an invited role of
  `user` or `admin`, and an expiry. The API returns a single-use link.
- FR-3.3 An invited person accepts the link, sets a display name and a password,
  and gets an account. The invitation is then consumed.
- FR-3.4 An expired, unknown, or already-accepted invitation is rejected with a
  specific error code.
- FR-3.5 With policy `open`, anyone may self-register with an email and a
  password. Email verification is required before first sign-in.
- FR-3.6 With policy `sso_auto`, a first successful OIDC sign-in whose claims
  match a provider's allowed domains or groups creates the account.

### FR-4 Password lifecycle

- FR-4.1 A signed-in user changes their password by supplying the current one.
- FR-4.2 Anyone may request a password reset for an email. The API responds the
  same whether or not the email exists.
- FR-4.3 A reset link is single-use and short-lived. Completing it sets a new
  password and revokes all of that user's sessions.
- FR-4.4 An admin may trigger a reset for a user, which sends or returns a reset
  link for that user.

### FR-5 API tokens

- FR-5.1 A signed-in user creates a personal API token with an optional label.
  The plaintext is returned once and stored only as a hash.
- FR-5.2 A user lists their tokens with label, creation time, and last-used
  time. The plaintext is never shown again.
- FR-5.3 A user revokes a token. A revoked token returns `401` at once.
- FR-5.4 A token carries the identity and permissions of its owning user. An
  admin's token carries the admin role.
- FR-5.5 If `deployment_settings.api_token_ttl_seconds` is set, tokens expire
  after that period.

### FR-6 External identity (OIDC)

- FR-6.1 An admin configures one or more OIDC providers: issuer, client id,
  client secret reference, scopes, allowed domains or groups, and whether
  auto-provisioning is on.
- FR-6.2 A user signs in through a configured provider with the Authorization
  Code flow and PKCE. On success the API links or creates the identity and
  starts a session.
- FR-6.3 A signed-in user links an external identity to their existing account,
  and unlinks one, provided at least one sign-in method remains.
- FR-6.4 Sign-in with a provider that is disabled, or with claims outside the
  allowed domains or groups, is rejected with a specific error code.
- FR-6.5 **Scope note.** OIDC endpoints and admin configuration ship in M1 and
  are contract-tested with a mock issuer. Interactive end-to-end sign-in needs a
  browser client or the M1.5 CLI device grant. The Device Authorization Grant
  itself is M1.5.

### FR-7 User profile and account

- FR-7.1 A user gets and updates their own profile: display name, unit system
  (`metric` or `imperial`), ISO-4217 currency, IANA time zone.
- FR-7.2 A unit or currency change does not rewrite stored entries. Stored
  values are canonical. See `data-model.md`.
- FR-7.3 A user deletes their own account. All of their vehicles, fuel entries,
  tokens, sessions, and identities are removed. The deletion is recorded in the
  audit log without personal content.
- FR-7.4 The last active admin cannot delete their own account. See FR-8.7.

### FR-8 Admin: user management

- FR-8.1 An admin lists users with email, role, status, created time, and a
  vehicle count. No fuel-entry contents are returned.
- FR-8.2 An admin creates a user directly, or by invitation (FR-3.2).
- FR-8.3 An admin deactivates and reactivates a user. A deactivated user cannot
  sign in and all their sessions and tokens stop working. Their data is kept.
- FR-8.4 An admin triggers a password reset for a user (FR-4.4).
- FR-8.5 An admin deletes a user and all their data, with an explicit confirm.
- FR-8.6 An admin grants and revokes the admin role on another user.
- FR-8.7 No operation may leave the deployment with zero active admins.
  Demoting, deactivating, or deleting the last active admin is rejected with
  `last_admin`.

### FR-9 Admin: access policy and deployment configuration

- FR-9.1 An admin reads and updates `deployment_settings`: deployment name,
  registration policy, allowed auth methods, default unit system, default
  currency, default time zone, session TTL, API-token TTL.
- FR-9.2 `allowed_auth_methods` must stay non-empty. Removing `password` is
  rejected while any user has no linked identity.
- FR-9.3 An admin performs create, read, update, and delete on OIDC providers
  (FR-6.1). A secret value is write-only over the API and never returned.

### FR-10 Admin: audit log

- FR-10.1 The API appends an audit record for every admin and security action:
  invitations, account creation, role changes, activation changes, deletions,
  policy changes, OIDC provider changes, secret rotation, and password resets.
- FR-10.2 Each record has an actor, an action code, an optional target, a
  human-readable summary, a timestamp, and structured metadata with no secrets.
- FR-10.3 An admin lists and filters the audit log. There is no update or delete
  path.

### FR-11 Vehicle

- FR-11.1 A user creates a vehicle with a name and a starting odometer in
  canonical units. Optional: make, model, year, fuel type.
- FR-11.2 A user lists their vehicles and gets one by id.
- FR-11.3 A user updates a vehicle's editable fields.
- FR-11.4 A user archives and unarchives a vehicle. An archived vehicle is
  hidden from the default list and rejects new fuel entries. Its history stays
  readable.
- FR-11.5 A vehicle cannot be hard-deleted while fuel entries reference it.
  Deleting a vehicle with entries requires an explicit cascade flag.
- FR-11.6 Every vehicle belongs to exactly one user. Ownership is enforced by a
  foreign key and re-checked in the API. A request for a vehicle the caller does
  not own returns `404`.

### FR-12 Fuel entry

- FR-12.1 A user creates a fuel entry for a non-archived vehicle they own:
  entry date, odometer, volume, total cost, full-tank flag, optional notes.
- FR-12.2 A user lists fuel entries for a vehicle they own. Default order is by
  entry date descending, then creation time descending. Support a date range
  filter and cursor pagination.
- FR-12.3 A user gets one fuel entry they own.
- FR-12.4 A user updates any editable field of a fuel entry they own. Re-run the
  invariant checks.
- FR-12.5 A user hard-deletes a fuel entry they own. History and reconciliation
  recompute correctly afterward.
- FR-12.6 Every fuel entry belongs to a vehicle owned by the calling user,
  through the chain in `data-model.md` INV-1. A request for an entry the caller
  does not own returns `404`.

### FR-13 Validation and invariants

- FR-13.1 Volume is greater than zero. Total cost is zero or greater.
- FR-13.2 Odometer is a non-negative integer in canonical units.
- FR-13.3 Odometer progression: within one vehicle, a later entry, ordered by
  entry date then creation time, has an odometer greater than or equal to the
  previous entry and the vehicle's starting odometer. A decrease is rejected
  with `odometer_decrease`. A tie passes the write and is flagged by
  reconciliation. *(Confirm the tie rule — see `open-questions.md`.)*
- FR-13.4 Entry date is at most one day in the future in the owning user's time
  zone. *(Confirm the window.)*
- FR-13.5 A create or update against an archived vehicle is rejected.
- FR-13.6 All rejections use the standard error body with a stable `code`.

### FR-14 History and retrieval

- FR-14.1 The list endpoint returns entries with stored canonical values and a
  display projection in the user's units.
- FR-14.2 Pagination is stable under inserts and deletes. A cursor encodes the
  sort key, not an offset.
- FR-14.3 The list response states the applied filter, order, and page size.

### FR-15 Units and currency

- FR-15.1 The database stores canonical units only. Distance in metres. Volume
  in millilitres. Money in minor currency units. See `data-model.md`.
- FR-15.2 Requests may send values in the user's unit system. The API converts
  on the way in and records the source unit on the entry for audit.
- FR-15.3 Responses include both the canonical values and a display projection.
- FR-15.4 Conversion is lossless enough that a round trip through the API
  returns the same displayed value. *(Define the tolerance.)*

### FR-16 Export

- FR-16.1 A user exports all their own profile, vehicle, and fuel-entry data in
  one documented, machine-readable file.
- FR-16.2 The export states the schema version and the canonical units.
- FR-16.3 The export is enough to rebuild that user's dataset in a fresh
  account. *(Round-trip import timing — see `open-questions.md` Q-7.)*

### FR-17 Reconciliation checks

- FR-17.1 A user runs checks over their own data and gets a report.
- FR-17.2 An admin runs a deployment-wide reconciliation. The admin report
  carries record ids, the owning user id, and check codes only. It carries no
  fuel-entry field values.
- FR-17.3 Checks cover: duplicate entries, orphaned entries, odometer ties and
  decreases, missing required fields, and out-of-range values.
- FR-17.4 A report lists each finding with the record id, the check code, and a
  human-readable message. It does not change data.
- FR-17.5 A clean dataset returns an empty findings list.

### FR-18 Deployment backup

- FR-18.1 An admin triggers a full deployment export for backup: all tables,
  schema version, canonical units. Secrets are excluded or referenced, never
  emitted in plaintext.
- FR-18.2 Restore tooling is out of scope for the first M1 cut. See
  `open-questions.md`.

### FR-19 OpenAPI document

- FR-19.1 The API serves `openapi.yaml` at a fixed path without auth.
- FR-19.2 The committed `openapi.yaml` matches what the running API serves. CI
  fails on any difference.
- FR-19.3 Every endpoint documents its request schema, response schema, auth
  requirement, and error codes. Descriptions are written so an LLM client can
  call the API correctly from the document alone.

## Non-functional requirements

- **Portability.** Every requirement passes against PostgreSQL and SQLite. No
  database-specific code outside the persistence layer.
- **Isolation.** A request as user A never reads or writes user B's vehicles or
  fuel entries. The admin role does not widen this. Covered by the `isolation`
  fixture and explicit tests.
- **Auth hardening.** Argon2id for passwords. Rate limiting on sign-in,
  password-reset request, and invitation acceptance. Generic responses on
  sign-in and reset to avoid account enumeration. Tokens and session ids stored
  as hashes only.
- **Error format.** One error body shape across the API: `code`, `message`,
  `details`. Codes are stable and documented.
- **Latency.** A single fuel-entry create is one API call and completes well
  within the 30-second logging goal on a phone network.
- **Observability.** Structured request logs. No secret values, passwords,
  tokens, or fuel-entry contents in admin-facing logs. Full telemetry is out of
  scope for M1.
- **Auditability.** Every admin and security action produces exactly one audit
  record.

## Acceptance criteria

Traceable to the Linear M1 acceptance criteria, restated for a multi-user API.

- **AC-1.** An admin provides a connection and bootstrap credentials. Chotu
  creates or upgrades only its own schema objects, validates the version,
  creates the first admin, and starts. *(Linear AC 1.)*
- **AC-2.** Missing or insufficient bootstrap privileges stop startup with an
  actionable error. No objects outside the Chotu-owned schema change.
  *(Linear AC 2.)*
- **AC-3.** A clean dataset can be entered through the API by a signed-in user
  with no duplicate, orphaned, or invalid records. Reconciliation returns no
  findings. *(Linear AC 3.)*
- **AC-4.** Database-specific behaviour stays in the persistence layer.
  Migrations and the full test suite pass for PostgreSQL and SQLite.
  *(Linear AC 4.)*
- **AC-5.** An invited user completes the core journey — sign in, add vehicle,
  add fill-up, correct entry — entirely over HTTP, with no database access and
  no manual repair. *(Linear AC 5, re-sequenced: API first, screen later.)*
- **AC-6.** Core validation and reconciliation behaviour is covered by automated
  tests and repeatable fixtures. *(Linear AC 6.)*
- **AC-7.** Isolation holds. The `isolation` fixture proves a request as user A
  cannot reach user B's data, and that an admin credential cannot read a user's
  fuel entries.
- **AC-8.** The `last-admin` fixture proves demote, deactivate, and delete are
  all blocked for the last active admin.
- **AC-9.** Every admin action in the test suite produces one audit record with
  an actor, an action code, and no secret content.
- **AC-10.** `openapi.yaml` is complete, served by the API, and identical to the
  committed copy. Contract tests assert every response validates against it.

## Out of scope

- The web SPA and any screen work.
- The `chotu` CLI and the OIDC Device Authorization Grant. Those are M1.5.
- Database engines beyond PostgreSQL and SQLite.
- SAML and other non-OIDC single sign-on.
- Cross-user or shared-vehicle access.
- Fuel analytics beyond entry capture and reconciliation. Cost, consumption, and
  efficiency views are delivery phase 3.
- Service tracking and general expenses.
- Receipt scanning, OCR, and AI extraction.
- MCP server and voice input.
- Deployment restore tooling, additional environments, and complex CI/CD.
- Managing a developer's database infrastructure, backups, or access control
  beyond documenting bootstrap requirements and providing the backup export.

## Deferred, tracked

- **Legacy schema review and data migration.** The Linear delivery sequence
  phase 1 calls for inventorying the prior prototypes, exporting existing data,
  and reconciling migration history. This is **not started** and is out of scope
  for this spec. It becomes spec `0002`. It must not block the canonical schema
  in `data-model.md`, which is designed fresh. See `open-questions.md` Q-1.

## Traceability

| This spec | User stories | Linear M1 |
|---|---|---|
| FR-1 | A-1..A-4 | bootstrap flow, documented minimum permissions |
| FR-2 | U-1, U-5, U-6 | single-user sign-in, now multi-user |
| FR-3 | U-2, A-5, A-12 | — (scope increase) |
| FR-4 | U-7, U-8, A-8 | — (scope increase) |
| FR-5 | U-48..U-49 | — (API-first addition) |
| FR-6 | U-3, U-4, A-14, A-15 | — (scope increase) |
| FR-7 | U-9..U-14 | profile setup |
| FR-8 | A-5..A-11 | — (scope increase) |
| FR-9 | A-12..A-18 | — (scope increase) |
| FR-10 | A-24, A-26 | — (scope increase) |
| FR-11 | U-16..U-23 | vehicle create, view, edit, archive |
| FR-12 | U-24..U-31 | manual fuel-entry flow, history, edit, delete |
| FR-13 | U-26, U-27 | validation and ownership rules |
| FR-15 | U-25 | metric and imperial units |
| FR-16 | U-45 | data export |
| FR-17 | U-46, A-21 | reconciliation checks and fixtures |
| FR-18 | A-22 | — (scope increase) |
| FR-19 | U-50..U-52 | — (API-first addition) |
| AC-1..AC-6 | — | Linear M1 acceptance criteria 1..6 |
| AC-7..AC-9 | — | isolation, last-admin, audit (scope increase) |
