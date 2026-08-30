# 0001 — M1: Trusted fuel logging

- **Status:** draft, awaiting review
- **Milestone:** Linear M1 — Trusted fuel logging
- **Slice type:** vertical slice, API first
- **Depends on:** none
- **Related:** `data-model.md`, `open-questions.md`, `../constitution.md`

## Context

Chotu's first milestone makes single-vehicle fuel logging trustworthy. A person
must be able to add a vehicle, record fill-ups, correct mistakes, and trust the
stored history.

The HTTP API is the priority. A person operates Chotu with an LLM chat client or
another HTTP client until the SPA exists. Every requirement below is met at the
API level first. The SPA is the last slice of this milestone and may move later.

## Goal

M1 is done when all of the following are true.

1. A developer can point Chotu at a PostgreSQL or a SQLite database, run
   bootstrap, and start the API.
2. A person with a bearer token can create their profile, add a vehicle, and
   record, list, edit, and delete fuel entries over HTTP.
3. The API rejects invalid data with a clear, machine-readable error. Odometer
   progression, units, positive amounts, and ownership are all enforced.
4. A person can export their data and run reconciliation checks that report
   duplicate, orphaned, or invalid records.
5. `openapi.yaml` describes every endpoint. Contract tests pass against both
   adapters.

## Primary journeys

Each journey is a sequence of API calls now, and a screen flow later.

1. **Onboard.** Create the profile with unit and currency preferences.
2. **Add a vehicle.** Create a vehicle with a name and a starting odometer.
3. **Log a fill-up.** Post a fuel entry: date, odometer, volume, total cost,
   full-tank flag, optional notes.
4. **Review history.** List fuel entries for a vehicle, newest first, paginated.
5. **Correct an entry.** Update or delete a fuel entry. The history and any
   later reconciliation stay consistent.
6. **Export.** Download all data in a documented format.

## Functional requirements

### FR-1 Bootstrap and schema lifecycle

- FR-1.1 Chotu reads database connection details and a bootstrap credential from
  configuration.
- FR-1.2 An explicit `bootstrap` command, and an opt-in check on startup, create
  or upgrade only Chotu-owned schema objects.
- FR-1.3 Bootstrap records and validates a schema version. A version mismatch
  that the running build cannot handle stops startup with an actionable error.
- FR-1.4 Missing or insufficient privileges stop bootstrap with an actionable
  error that names the missing grant. No objects outside the Chotu-owned schema
  are created or altered.
- FR-1.5 The minimum privilege set for each adapter is documented.
- FR-1.6 Routine API flows use a role that cannot alter schema.

### FR-2 Authentication

- FR-2.1 Bootstrap issues one bearer token and prints it once. It is stored only
  as a hash.
- FR-2.2 Every endpoint except health and the OpenAPI document requires a valid
  bearer token.
- FR-2.3 An invalid or missing token returns `401` with the standard error body.
- FR-2.4 A command can issue a replacement token and revoke the previous one.

### FR-3 Profile

- FR-3.1 Exactly one profile exists. A second create attempt returns `409`.
- FR-3.2 The profile holds display name, unit system (`metric` or `imperial`),
  and an ISO-4217 currency code.
- FR-3.3 Get and update the profile. A unit or currency change does not rewrite
  stored entries. Stored values are canonical. See `data-model.md`.

### FR-4 Vehicle

- FR-4.1 Create a vehicle with a name and a starting odometer in canonical
  units. Optional: make, model, year, fuel type.
- FR-4.2 List vehicles. Get one vehicle.
- FR-4.3 Update a vehicle's editable fields.
- FR-4.4 Archive and unarchive a vehicle. An archived vehicle is hidden from the
  default list and rejects new fuel entries. Its history stays readable.
- FR-4.5 A vehicle cannot be hard-deleted while fuel entries reference it.
  Deleting a vehicle with entries requires an explicit cascade flag.
- FR-4.6 Every vehicle belongs to the profile. This ownership is enforced in the
  database and checked in the API.

### FR-5 Fuel entry

- FR-5.1 Create a fuel entry for a non-archived vehicle: entry date, odometer,
  volume, total cost, full-tank flag, optional notes.
- FR-5.2 List fuel entries for a vehicle. Default order is by entry date
  descending, then by creation time descending. Support a date range filter and
  cursor pagination.
- FR-5.3 Get one fuel entry.
- FR-5.4 Update any editable field of a fuel entry. Re-run the invariant checks.
- FR-5.5 Delete a fuel entry. The delete is a hard delete. Reconciliation and
  history recompute correctly afterward.
- FR-5.6 Every fuel entry belongs to a vehicle owned by the profile. Enforced in
  the database and checked in the API.

### FR-6 Validation and invariants

- FR-6.1 Volume is greater than zero. Total cost is zero or greater.
- FR-6.2 Odometer is a non-negative integer in canonical units.
- FR-6.3 Odometer progression: within one vehicle, a later entry, ordered by
  entry date then creation time, has an odometer greater than or equal to the
  previous entry. A decrease is rejected with a specific error code. A tie is
  allowed and flagged by reconciliation, not blocked. *(Confirm the tie rule —
  see `open-questions.md`.)*
- FR-6.4 Entry date is not more than one day in the future in the profile's
  time zone. *(Confirm the window.)*
- FR-6.5 A create or update against an archived vehicle is rejected.
- FR-6.6 All rejections use the standard error body with a stable `code`.

### FR-7 History and retrieval

- FR-7.1 The list endpoint returns entries with their stored canonical values
  and a display projection in the profile's units.
- FR-7.2 Pagination is stable under inserts and deletes. A cursor encodes the
  sort key, not an offset.
- FR-7.3 The list response states the applied filter, order, and page size.

### FR-8 Units and currency

- FR-8.1 The database stores canonical units only. Distance in metres. Volume in
  millilitres. Money in minor currency units. See `data-model.md`.
- FR-8.2 Requests may send values in the profile's unit system. The API converts
  on the way in and records the source unit on the entry for audit.
- FR-8.3 Responses include both the canonical values and a display projection.
- FR-8.4 Conversion is lossless enough that a round trip through the API returns
  the same displayed value. *(Define the tolerance — see `open-questions.md`.)*

### FR-9 Export

- FR-9.1 An endpoint returns all profile, vehicle, and fuel-entry data in one
  documented, machine-readable file.
- FR-9.2 The export states the schema version and the canonical units.
- FR-9.3 The export is enough to rebuild the dataset in a fresh install.
  *(Round-trip import is phase 1 of the delivery sequence but may land after the
  first M1 cut — confirm.)*

### FR-10 Reconciliation checks

- FR-10.1 An endpoint runs checks over the dataset and returns a report.
- FR-10.2 Checks cover: duplicate entries, orphaned entries, odometer ties and
  decreases, missing required fields, and out-of-range values.
- FR-10.3 The report lists each finding with the record id, the check code, and
  a human-readable message. It does not change data.
- FR-10.4 A clean dataset returns an empty findings list.

### FR-11 OpenAPI document

- FR-11.1 The API serves `openapi.yaml` at a fixed path without auth.
- FR-11.2 The committed `openapi.yaml` matches what the running API serves. CI
  fails on any difference.
- FR-11.3 Every endpoint documents its request schema, response schema, and
  error codes. Descriptions are written so an LLM client can call the API
  correctly from the document alone.

## Non-functional requirements

- **Portability.** All requirements pass against PostgreSQL and SQLite. No
  database-specific code outside the persistence layer.
- **Error format.** One error body shape across the API: `code`, `message`,
  `details`. Codes are stable and documented.
- **Latency.** A single fuel-entry create is one API call and completes well
  within the 30-second logging goal on a phone network.
- **Observability.** Structured request logs. No secret values in logs. Full
  telemetry is out of scope for M1.
- **Safety.** Least-privilege database role for API flows. Bootstrap role is
  separate and documented.

## Acceptance criteria

Traceable to the Linear M1 acceptance criteria, restated at the API level.

- **AC-1.** A developer provides a connection and bootstrap credentials. Chotu
  creates or upgrades only its own schema objects, validates the version, and
  starts. *(Linear AC 1.)*
- **AC-2.** Missing or insufficient bootstrap privileges stop startup with an
  actionable error. No objects outside the Chotu-owned schema change.
  *(Linear AC 2.)*
- **AC-3.** A clean dataset can be entered through the API with no duplicate,
  orphaned, or invalid records. The reconciliation endpoint returns no findings.
  *(Linear AC 3.)*
- **AC-4.** Database-specific behaviour stays in the persistence layer.
  Migrations and the full test suite pass for PostgreSQL and SQLite.
  *(Linear AC 4.)*
- **AC-5.** A person completes the core journey — add vehicle, add fill-up,
  correct entry — entirely over HTTP with a bearer token, with no database
  access and no manual repair. The SPA meets the same journey on a phone-sized
  screen in a later slice. *(Linear AC 5, re-sequenced per the constitution.)*
- **AC-6.** Core validation and reconciliation behaviour is covered by automated
  tests and repeatable fixtures. *(Linear AC 6.)*
- **AC-7.** `openapi.yaml` is complete, served by the API, and identical to the
  committed copy. Contract tests assert every response validates against it.

## Out of scope

From the Linear M1 out-of-scope list, plus the re-sequencing.

- The SPA and any screen work, until the API workflow runs in production.
- Supporting database engines beyond PostgreSQL and SQLite.
- Managing a developer's database infrastructure, backups, or access control
  beyond documenting bootstrap requirements.
- Fuel analytics beyond entry capture and the basic reconciliation report.
  Cost, consumption, and efficiency views are phase 3.
- Service tracking and general expenses.
- Receipt scanning, OCR, and AI extraction.
- Multi-user, multi-tenant, and shared-vehicle support.
- MCP server, voice input, and external integrations.
- Additional deployment environments and complex CI/CD.

## Deferred, tracked

- **Legacy schema review and data migration.** The Linear delivery sequence
  phase 1 calls for inventorying the prior prototypes, exporting existing data,
  and reconciling migration history. This is **not started** and is out of scope
  for this spec. It becomes spec `0002`. It must not block the canonical schema
  in `data-model.md`, which is designed fresh. See `open-questions.md`.

## Traceability

| This spec | Linear |
|---|---|
| FR-1 | M1 deliverables: bootstrap flow, documented minimum permissions |
| FR-2 | M1 deliverable: single-user sign-in |
| FR-3 | M1 deliverable: profile setup |
| FR-4 | M1 deliverable: vehicle create, view, edit, archive |
| FR-5 | M1 deliverable: manual fuel-entry flow, history, edit, delete |
| FR-6 | M1 deliverable: validation and ownership rules |
| FR-8 | M1 deliverable: metric and imperial units |
| FR-10 | M1 deliverable: reconciliation checks and fixtures |
| AC-1..AC-6 | Linear M1 acceptance criteria 1..6 |
