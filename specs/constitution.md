# Chotu constitution

The fixed decisions for the project. Change these only with a clear reason and a
note in the commit body. Everything in a feature spec must stay consistent with
this document.

Source of the product definition: the Linear project
[Chotu](https://linear.app/onepeakstudios/project/chotu-d0a7059fe23c) and its
milestone **M1 — Trusted fuel logging**.

## Mission

Build an open-source, self-hostable replacement for Drivvo. It makes each user's
vehicle fuel, service, and expense history trustworthy and easy to maintain.
Personal-first: one person self-hosts and invites a small number of others.

Target market: the United States. The database stores US customary units. A
user may still view and enter data in metric.

The first release succeeds when a person can:

1. Add a vehicle.
2. Record a fuel fill-up in under 30 seconds.
3. Review, edit, or delete past entries.
4. See accurate fuel cost and efficiency history.

## Actors

- **User** — an account holder. Signs in, manages only their own vehicles and
  fuel entries. No cross-user vehicle sharing in this scope.
- **Administrator** — a user account with deployment-management rights. Still a
  normal user for their own vehicles. Can read accounts and data-integrity
  findings. **Cannot** read a user's fuel entries.
- **Deployment** — one running Chotu instance with its own database and its own
  set of users. Multiple users per deployment. Multiple vehicles per user.

## Clients

The API is the product. Every client is equal and talks to the API over HTTP.

1. **HTTP API** — the primary surface for the first release.
2. **`chotu` CLI** — first-party, ships in M1.5.
3. **AI agents** — Claude Code or similar, driving the API or the CLI.
4. **Web SPA** — built after the API workflow runs in production.
5. **Third-party HTTP clients** — anything reading `openapi.yaml`.

## Product boundary

**In scope for the first release**

- Multi-user authentication with an administrator role and per-user data
  isolation.
- Sign-in with email and password, or with an external identity provider.
- Invitations, password reset, and self-service account deletion.
- Admin user-management and per-deployment access policy.
- An audit log of admin actions.
- Vehicle creation and editing. Multiple vehicles per user.
- Manual fuel-entry logging: date, odometer, volume, total cost, notes.
- Entry history with edit and delete.
- Consistent unit conversion. A per-user currency setting, fixed to USD in M1.
- Per-user data export and reconciliation checks.

**Deferred until the core loop is validated**

- Receipt scanning, OCR, and AI extraction.
- Service and other expense tracking.
- Fuel analytics beyond entry capture and reconciliation. Cost, consumption,
  and efficiency views are delivery phase 3.
- Cross-user or shared-vehicle access.
- SAML and other non-OIDC single sign-on.
- MCP server and voice input.
- Multiple deployment targets, staging environments, and complex CI/CD.

## Technology decisions

| Area | Decision | Reason |
|---|---|---|
| Language | TypeScript, `strict` mode | One typed contract from the database to the UI. |
| Runtime | Node.js 22 LTS | Current LTS. pnpm 11 needs Node >= 22.13 and GitHub Actions is deprecating Node 20 tooling. |
| Package manager | pnpm workspace | Clean module boundaries. Room for more packages later. |
| API service | Hono | Small, portable, runs on Node now and elsewhere later. |
| API contract | OpenAPI 3.1, authored with `@hono/zod-openapi` | One Zod schema per payload. The spec is generated from code, so they cannot drift. A published OpenAPI document also lets an LLM chat client drive the API. |
| Auth: identity | OIDC — Authorization Code with PKCE for browsers, Device Authorization Grant for the CLI and agents. Plus email and password. | Reuse existing identities and support browserless clients. No SAML in this scope. |
| Auth: API credential | Per-user API token. Bearer only. Stored as a hash. | A token suits a script, the CLI, or an LLM chat client. The API never sees a password after sign-in. |
| Auth: sessions | Server-side sessions. Opaque session id in an HttpOnly cookie for browsers, and returned in the sign-in response body so a non-browser client can send it as a bearer value. | Simple to revoke. No token parsing on the client. Works headless (Q-11). |
| Registration | Invite-only by default. Open sign-up and SSO auto-provisioning are per-deployment admin toggles. | Safe default for a self-hosted instance with no extra anti-abuse work. |
| Frontend | Vite + React, mobile-first SPA | Separate deployable. Talks to the API only over HTTP. Built after the API workflow runs in production. |
| CLI | `chotu`, ships in M1.5 | First-party client. Authenticates with an API token or the OIDC Device Grant. Machine-readable output. |
| Persistence | Drizzle ORM | SQL-first. Types are inferred with no codegen step. Supports the launch adapters. |
| Database engines | PostgreSQL for staging and production. SQLite for local development and the test suite. | PostgreSQL is the deployment database. SQLite keeps the persistence boundary honest on every developer machine and in CI. |
| Migrations | `drizzle-kit` | One change per migration file. `drizzle-kit check` detects drift. |
| Tests | Vitest (unit and contract), Playwright (end-to-end) | Contract tests run against both engines. |
| Deployment | One target, one production environment. Target chosen after research item R-1. | The API is deployment-agnostic, so the target can be swapped. Add infrastructure only when usage or collaborators require it. |

### Repository shape

```
chotu-app/
  packages/
    api/          Hono service, route handlers, OpenAPI, persistence layer
      src/
        domain/       canonical domain model and typed domain functions
        auth/         sessions, OIDC, API tokens, password hashing
        db/           Drizzle schema, adapters, migrations, bootstrap
        routes/       HTTP routes; zod-openapi definitions
        contract/     generated OpenAPI document and generated types
    cli/          `chotu` CLI (M1.5), consumes openapi.yaml
    web/          Vite + React SPA (after the API is in production)
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
2. **One application and API boundary.** Every client — CLI, agent, SPA,
   third-party — calls the API over HTTP only. No client reaches a database.
   No capability exists in one client and not the API.
3. **One canonical domain model.** User, vehicle, and fuel entry are defined
   once. Domain and persistence functions are typed.
4. **Per-user isolation.** Every query for vehicle or fuel-entry data is scoped
   to the calling user. The database enforces the ownership chain. An admin role
   grants deployment management, not read access to another user's fuel entries.
5. **Database-agnostic application code.** All database-specific code lives in
   the persistence layer behind a stable contract. Add engines as tested
   adapters, never as branches in application code.
6. **Self-bootstrapping schema.** A developer supplies a database connection and
   credentials that can bootstrap the schema. On startup or an explicit command,
   Chotu creates and migrates its own objects, validates the schema version,
   then serves requests. Chotu never creates or alters objects it does not own.
   Insufficient permissions stop startup with an actionable error.
7. **Constraints live in the database.** Required fields, ownership, odometer
   validity, and fuel-entry consistency are enforced by the schema, not only by
   application validation.
8. **Least privilege.** Routine application flows use a low-privilege database
   role. Bootstrap uses a separate, documented, higher-privilege role. Admin API
   endpoints require the admin role, not only a valid credential.
9. **Reuse is selective.** Carry forward Drivvo import and parsing, metrics and
   unit conversion, migration fixtures, and analytics queries. Do not carry
   forward duplicated CRUD paths, legacy schemas, or unreviewed automation.
10. **Deployment-agnostic.** The API process is stateless. PostgreSQL is the only
    stateful dependency. Configuration comes from the environment. Nothing
    couples the code to one host, so a deployment target can be swapped.

## Research backlog

Open investigations that do not block M1 live in `specs/research-backlog.md`:
R-1 deployment target and portability, R-2 transactional email in an AI-native
workflow, R-3 secret storage for a self-hosted app. Each ends in a written
recommendation folded back into this document or a spec.

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
2. **Core logging loop.** Multi-user auth: registration by invitation, sign-in
   with password or OIDC, password reset, user profile. Admin user-management
   and access policy. Vehicle create, view, edit, archive. Manual fuel entry
   with validation and metric/imperial support. History, edit, delete. Per-user
   isolation throughout. *Exit:* the add-vehicle then add-fill-up then
   correct-entry journey works for a signed-in user, over the API first and on a
   phone-sized screen later.
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

- **User** — an account holder. Holds unit, currency, and time-zone
  preferences. Owns vehicles and fuel entries.
- **Administrator** — a user with deployment-management rights. See Actors.
- **Deployment** — one running Chotu instance, one database, one set of users.
- **Identity** — an external login linked to a user, from an OIDC provider.
- **Invitation** — a single-use link that lets one person create an account on
  an invite-only deployment.
- **Session** — server-side state for a signed-in browser client, keyed by an
  opaque id in an HttpOnly cookie.
- **API token** — a per-user bearer credential for scripts, the CLI, and agents.
- **Vehicle** — one car owned by a user. Fuel entries attach to it.
- **Fuel entry** — one recorded fill-up. Also called a refueling.
- **Full tank** — a fill-up that filled the tank. Needed for a valid economy
  calculation over the interval since the previous full tank.
- **Canonical units** — the single internal representation. US customary units
  stored as integers, because the product targets the United States market.
  Input and display convert to and from it. See
  `specs/0001-m1-trusted-fuel-logging/data-model.md`.
- **Bootstrap** — the startup step that creates or upgrades Chotu's own schema
  objects and validates the schema version.
- **Adapter** — a database-engine-specific implementation of the persistence
  contract.
