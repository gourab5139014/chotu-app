# 0001 — Open questions

Resolve each before or during the plan step. Record the decision here and in the
spec, then remove the question.

## Q-1 Legacy schema review and data migration (deferred)

**Not started, by direction of the project lead.** The Linear delivery sequence
phase 1 covers this. It becomes spec `0002`.

Scope when it starts:

- Inventory the two prior prototypes. Known: `~/Workspace/carmanager`. The second
  prototype is unidentified — **Q-1a: which repository is the second prototype?**
- Catalog the legacy schema and its mistakes. Candidates from prior notes:
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
- **B.** Reject a tie unless the later entry has `volume_ml` consistent with a
  top-up on the same reading.
- **C.** Reject all ties.

A tie is common when someone logs two fills on the same day without driving. Lean
A. Confirm.

## Q-3 Future-date window

FR-6.4 and INV-4 use "at most one day in the future". Time-zone edge cases and
travel across date lines make zero tolerance annoying. Confirm one day, or pick
another window.

## Q-4 Volume precision

`data-model.md` D-1 stores volume as integer millilitres. A pump shows three
decimals of a litre or gallon. Integer millilitres holds that. Confirm, or store
integer thousandths of a litre to match pump display exactly.

## Q-5 Conversion tolerance

FR-8.4 wants a lossless round trip for display. Define the tolerance, for example
"the displayed value with two decimals is identical after a create then read".

## Q-6 Export format

FR-9. Options:

- **A.** One JSON document, Chotu's own shape, schema-versioned. (lean)
- **B.** CSV per entity.
- **C.** Drivvo-compatible CSV, to ease switching.

Lean A for M1. B or C can come later. Confirm.

## Q-7 Import round trip in M1

FR-9.3. Is import required for the first M1 cut, or is export plus the
reconciliation report enough, with import landing in `0002` alongside the legacy
migration? Lean: export in `0001`, import in `0002`. Confirm.

## Q-8 Token model

FR-2. One token at a time, or several named tokens? Rotation via a CLI command is
in the draft. Confirm one active token is enough for M1.

## Q-9 SQLite concurrency

Single-user, single-writer. SQLite in WAL mode is fine for this. Confirm no
requirement forces PostgreSQL-only behaviour in M1.

## Q-10 Deployment target

The constitution says one target, one production environment, chosen later.
Name it before the plan: a small VM with a process manager, a container host, or
a platform. Affects the bootstrap and config story.
