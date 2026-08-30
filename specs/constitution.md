# Chotu constitution

The fixed decisions for the project. Change these only with a clear reason and a
note in the commit body. Everything in a feature spec must stay consistent with
this document.

Source of the product definition: the Linear project
[Chotu](https://linear.app/onepeakstudios/project/chotu-d0a7059fe23c) and its
milestone **M1 — Trusted fuel logging**.

## Mission

Build an open-source, personal-first replacement for Drivvo. It makes one
vehicle's fuel, service, and expense history trustworthy and easy to maintain.

The first release succeeds when a person can:

1. Add a vehicle.
2. Record a fuel fill-up in under 30 seconds.
3. Review, edit, or delete past entries.
4. See accurate fuel cost and efficiency history.

## Product boundary

**In scope for the first release**

- Single-user authentication and profile.
- Vehicle creation and editing.
- Manual fuel-entry logging: date, odometer, volume, total cost, notes.
- Entry history with edit and delete.
- Basic metrics: cost over time, fuel economy, recent activity.
- Consistent unit conversion and a canonical currency setting.
- Data export and basic reconciliation checks.

**Deferred until the core loop is validated**

- Receipt scanning, OCR, and AI extraction.
- Service and other expense tracking.
- Multi-user, multi-tenant, or shared-vehicle support.
- MCP, voice input, external integrations, and agent workflows.
- Multiple deployment targets, staging environments, and complex CI/CD.

## Technology decisions

| Area | Decision | Reason |
|---|---|---|
| Language | TypeScript, `strict` mode | One typed contract from the database to the UI. |
| Runtime | Node.js 20 LTS | Widest support for the ORM, drivers, and codegen tools. |
| Package manager | pnpm workspace | Clean module boundaries. Room for more packages later. |
| API service | Hono | Small, portable, runs on Node now and elsewhere later. |
| API contract | OpenAPI 3.1, authored with `@hono/zod-openapi` | One Zod schema per payload. The spec is generated from code, so they cannot drift. A published OpenAPI document also lets an LLM chat client drive the API. |
| Auth (first release) | Static bearer token, issued by the bootstrap step | Single user. A token suits an LLM chat client or any HTTP client. Session and cookie auth wait for the SPA. |
| Frontend | Vite + React, mobile-first SPA | Separate deployable. Talks to the API only over HTTP. Built after the API workflow runs in production. |
| Persistence | Drizzle ORM | SQL-first. Types are inferred with no codegen step. Supports the launch adapters. |
| Database adapters at launch | PostgreSQL and SQLite | SQLite for local work and single-user self-host. PostgreSQL for real deployments. Two adapters prove the portability boundary from day one. |
| Migrations | `drizzle-kit` | One change per migration file. `drizzle-kit check` detects drift. |
| Tests | Vitest (unit and contract), Playwright (end-to-end) | Contract tests run against every adapter. |
| Deployment | One target, one production environment | Add infrastructure only when usage or collaborators require it. |

### Repository shape

```
chotu-app/
  packages/
    api/          Hono service, route handlers, OpenAPI, persistence layer
      src/
        domain/       canonical domain model and typed domain functions
        db/           Drizzle schema, adapters, migrations, bootstrap
        routes/       HTTP routes; zod-openapi definitions
        contract/     generated OpenAPI document and generated types
    web/          Vite + React SPA
      src/
        api/          generated client and types from openapi.yaml
  specs/          this directory
  openapi.yaml    the published API contract (generated, committed)
```

## Architecture principles

1. **API first.** The HTTP API is the product surface for the first release. A
   person drives it with an LLM chat client or any HTTP client, guided by the
   OpenAPI document. The SPA is built only after the API workflow runs in
   production. Every API capability must be complete and usable without a UI.
2. **One application and API boundary.** The SPA, and any other client, call the
   API over HTTP only. No client reaches a database.
3. **One canonical domain model.** Profile, vehicle, and fuel entry are defined
   once. Domain and persistence functions are typed.
4. **Database-agnostic application code.** All database-specific code lives in
   the persistence layer behind a stable contract. Add engines as tested
   adapters, never as branches in application code.
5. **Self-bootstrapping schema.** A developer supplies a database connection and
   credentials that can bootstrap the schema. On startup or an explicit command,
   Chotu creates and migrates its own objects, validates the schema version,
   then serves requests. Chotu never creates or alters objects it does not own.
   Insufficient permissions stop startup with an actionable error.
6. **Constraints live in the database.** Required fields, ownership, odometer
   validity, and fuel-entry consistency are enforced by the schema, not only by
   application validation.
7. **Least privilege.** Routine application flows use a low-privilege role.
   Bootstrap uses a separate, documented, higher-privilege role.
8. **Reuse is selective.** Carry forward Drivvo import and parsing, metrics and
   unit conversion, migration fixtures, and analytics queries. Do not carry
   forward duplicated CRUD paths, legacy schemas, or unreviewed automation.

## Contract enforcement

The API contract and the data contract each have one machine-readable source of
truth. Every downstream artifact is generated. CI blocks drift.

- **API contract.** Zod schemas in `packages/api/src/routes` are the source.
  `@hono/zod-openapi` emits `openapi.yaml`. The web client and its types are
  generated from `openapi.yaml`. Requests and responses are validated against
  the Zod schemas at runtime in development and test.
- **Data contract.** The Drizzle schema in `packages/api/src/db/schema` is the
  source. Migrations are generated from it. Row and insert types are inferred
  from it. `drizzle-kit check` fails CI when schema and migrations disagree.
- **Contract tests.** Vitest runs the live API and asserts every response
  validates against `openapi.yaml`. The suite runs against PostgreSQL and
  SQLite.

See `specs/README.md` for the full CI gate list and the per-PR rules.

## Delivery sequence

From the Linear project. Each phase is a vertical slice with an exit criterion.

1. **Foundation and data integrity.** Inventory the prior prototypes. Export
   existing data and reconcile migration history. Define the canonical schema.
   Add validation, ownership rules, fixtures, and reconciliation checks.
   *Exit:* a clean local dataset imports or enters with no duplicate, orphaned,
   or invalid records.
2. **Core logging loop.** Sign-in and profile. Vehicle create, view, edit,
   archive. Manual fuel entry with validation and metric/imperial support.
   History, edit, delete. *Exit:* the add-vehicle then add-fill-up then
   correct-entry journey works on a phone-sized screen.
3. **Trustworthy insights.** Recent activity and fuel-history views. Consistent
   cost, consumption, and efficiency. Explicit handling of incomplete or
   first-fill-up data. Export and reconciliation checks. *Exit:* metrics match a
   known fixture and are understandable from the history screen.
4. **Personal dogfooding and hardening.** Use Chotu for real entries. Track
   friction and discrepancies as issues. Add tests for the core journey and
   regressions. *Exit:* repeated personal use produces accurate history with no
   manual database repair.
5. **Validate the next module.** After sustained use, pick one of service
   tracking, general expenses, or receipt capture, with evidence from real use.
   Repeat the vertical-slice approach.

Phases 1 and 2 together are milestone **M1**. See
`specs/0001-m1-trusted-fuel-logging/`.

**Sequencing note (project lead, 2026-08-30).** The HTTP API is the priority.
Within M1, deliver and productionize the API for phases 1 and 2 first. A person
operates Chotu through an LLM chat client or another HTTP client until the SPA
exists. The SPA is the last slice of M1 and may move to a later milestone. Every
M1 acceptance criterion that mentions a screen is also met at the API level
first. The Linear milestone should be updated to record this order.

## Execution rules

- Small, outcome-based issues and pull requests.
- One active implementation slice at a time.
- Every pull request states acceptance criteria, adds tests where practical, and
  reports a short manual dogfood result.
- Do not auto-approve personal pull requests. Review is a quality boundary.
- Keep Linear issues current so project status stays accurate.

## Glossary

- **Profile** — the single account holder. Holds unit and currency preferences.
- **Vehicle** — one car owned by the profile. Fuel entries attach to it.
- **Fuel entry** — one recorded fill-up. Also called a refueling.
- **Full tank** — a fill-up that filled the tank. Needed for a valid economy
  calculation over the interval since the previous full tank.
- **Canonical units** — the single internal representation. Input and display
  convert to and from it. See `specs/0001-m1-trusted-fuel-logging/data-model.md`.
- **Bootstrap** — the startup step that creates or upgrades Chotu's own schema
  objects and validates the schema version.
- **Adapter** — a database-engine-specific implementation of the persistence
  contract.
