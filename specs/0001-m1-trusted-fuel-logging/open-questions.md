# 0001 — Open questions

Resolve each before or during the plan step. Record the decision here and in the
spec, then remove the question.

## Q-1 Legacy schema review and data migration (deferred)

**Not started, by direction of the project lead.** The Linear delivery sequence
phase 1 covers this. It becomes spec `0002`.

### Prior prototypes and infrastructure (resolved)

| Prototype | Repo | Local clone | Backend | Frontend host |
|---|---|---|---|---|
| 1 — carmanager | https://github.com/gourab5139014/carmanager | `~/Workspace/carmanager` | Supabase project `cofmlyvqhxjkmyzbtrsy` | — |
| 2 — crunch-my-car | https://github.com/gourab5139014/crunch-my-car | `~/Workspace/crunch-my-car` | Supabase project `yiejtkppiwhzedyfeyuv` | Vercel `crunch-my-car` |

- carmanager: last local commit `c7666f0` (2026-05-18), "multi-tenant
  environment isolation via schema-per-environment".
- crunch-my-car: last local commit `015fb19` (2026-05-31), "unify display units
  under global user profile (issue #22)".
- A Render dashboard exists (`dashboard.render.com`). Identify which prototype it
  hosts during the review.
- Access to the Supabase projects and any Render service is needed before the
  export step.

### Scope when it starts

- Catalog each legacy schema and its mistakes. Candidates from prior notes:
  no `vehicle_id` on early rows, client-side computed `distance`, dashboard data
  committed to git, schema split across `dev` and `legacy`.
- Extract reusable modules only: Drivvo import and parsing, metrics and unit
  conversion, migration fixtures, receipt preprocessing, analytics queries.
- Export the existing data. Roughly 181 refuelings were mentioned in prior notes.
- Produce a migration plan that maps legacy rows to the canonical model in
  `data-model.md`, with reconciliation on both sides.

This must not block `0001`. The canonical schema is designed fresh.

## Q-2 Odometer ties

INV-2 lets two entries share an odometer value. Options:

- **A.** Allow the tie, report it in reconciliation. (current draft)
- **B.** Reject a tie unless the later entry has `volume_gal_e3` consistent with
  a top-up on the same reading.
- **C.** Reject all ties.

A tie is common when someone logs two fills on the same day without driving. Lean
A. Confirm.

## Q-3 Future-date window

FR-13.4 and INV-4 use "at most one day in the future" in the owning user's time
zone. Time-zone edge cases and travel across date lines make zero tolerance
annoying. Confirm one day, or pick another window.

## Q-4 Canonical unit scale

**Resolved:** the product targets the United States market, so the database
stores US customary units. Distance in miles, volume in US gallons, money in
USD cents. The API converts to and from a user's preference at the edge. See
`data-model.md` D-1.

Still to confirm — the integer scale:

- Distance: integer thousandths of a mile (`0.001 mi`). Covers trip-meter
  granularity with headroom. Alternative: hundredths.
- Volume: integer thousandths of a US gallon (`0.001 gal`). Matches a pump's
  three-decimal display. Alternative: ten-thousandths.
- Money: integer cents. No sub-cent case in M1.

Confirm the scales, or pick alternatives.

## Q-5 Conversion tolerance

FR-15.4 wants a lossless round trip for display. Define the tolerance, for
example "the displayed value with two decimals is identical after a create then
read".

## Q-6 Export format

FR-16. Options:

- **A.** One JSON document, Chotu's own shape, schema-versioned. (lean)
- **B.** CSV per entity.
- **C.** Drivvo-compatible CSV, to ease switching.

Lean A for M1. B or C can come later. Confirm.

## Q-7 Import round trip in M1

FR-16.3. Is import required for the first M1 cut, or is export plus the
reconciliation report enough, with import landing in `0002` alongside the legacy
migration? Lean: export in `0001`, import in `0002`. Confirm.

## Q-8 Token model

FR-5. Several named tokens per user is the current draft. Confirm, or cap at one
active token per user for M1.

## Q-9 SQLite concurrency

Multi-user now, but low volume and a single API process. SQLite in WAL mode
serialises writes and should hold. Confirm no requirement forces PostgreSQL-only
behaviour in M1, and set an expected concurrent-user ceiling for SQLite.

## Q-10 Deployment target

The constitution says one target, one production environment, chosen later.
Name it before the plan: a small VM with a process manager, a container host, or
a platform. Affects the bootstrap and config story.

## Q-11 Headless password sign-in

FR-2.1 returns an opaque session credential and also sets a cookie. Confirm a
non-browser client (curl, an LLM chat client) may hold and send that session
credential as a bearer value, or require such clients to use an API token only.

## Q-12 Email delivery

FR-3.5 email verification, FR-4.2 password reset, and FR-3.2 invitations may need
outbound email. Options: require SMTP configuration, or return the link in the
API response for a self-hoster to deliver by hand, or both by policy. Lean: both,
default to returning the link when no SMTP is configured. Confirm.

## Q-13 OIDC client secret storage

`data-model.md` D-5. Encrypt provider secrets at rest with a deployment key, or
store an environment-variable reference only. Lean: support both, prefer the
environment reference for a single-provider self-host. Confirm.

## Q-14 Rate-limit thresholds

Non-functional "Auth hardening". Set concrete limits for sign-in,
password-reset request, and invitation acceptance, and whether the limit is per
IP, per account, or both.

## Q-15 Deployment restore

FR-18.2 defers restore tooling. Confirm restore is `0002` or later, and that a
documented manual restore from the backup file is acceptable for M1.

## Q-16 Admin bootstrap credential

FR-1.5. Prefer the operator to pass an admin email and password to `bootstrap`,
or to have `bootstrap` always print a one-time set-password link. Lean: accept
either, print the link when no password is supplied. Confirm.
