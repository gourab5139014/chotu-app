# 0001 — Open questions

Record a decision here and in the spec, then move the item to **Resolved**.
Research items that do not block M1 live in `../research-backlog.md`.

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
- Import lands here too, in `0002` / M2. It is not in M1. See Resolved Q-7.

This must not block `0001`. The canonical schema is designed fresh.

## Open

### Q-8 API token model — needs a decision

**Which token.** This is the **per-user API token** from FR-5. It is not the
browser session, and not the one-time token that `bootstrap` prints. A user
creates one so a non-browser caller can act as them: the `chotu` CLI, an LLM
chat client such as Claude Code, a cron job, a script. It is a bearer string.
The API stores only its hash. It carries the user's identity and role.

**The choice.** How many can be active at once per user?

- **A — several named tokens (draft).** Like GitHub personal access tokens. One
  labelled `cli`, one `claude-code`, one `backup-cron`. Each is listed and
  revoked on its own. Revoking one does not disturb the others. Optional
  per-token expiry from `deployment_settings.api_token_ttl_seconds`.
- **B — one active token per user.** Creating a token revokes the previous one.
  Simpler to reason about. A leaked token and a rotation are the same action.
  A user who runs two tools shares one secret between them.

Recommendation: **A**. It matches U-49 (list, revoke, reissue) and the fact that
a person will likely wire the API into more than one tool. Confirm A, or pick B.

## Resolved

- **Q-2 Odometer ties → A.** A later entry may share the previous odometer
  value. The write succeeds. Reconciliation reports the tie. A strict decrease
  is still rejected. Applied to `spec.md` FR-13.3 and `data-model.md` INV-2.
- **Q-3 Future-date window → 2 days.** `entry_date` may be at most two days
  after today in the user's time zone, to absorb date-line and travel cases.
  Applied to FR-13.4 and INV-4.
- **Q-4 Canonical unit scale → exact, three decimals for fuel.** Distance and
  volume are stored exactly, not as binary floats. Volume carries three
  fractional digits by default. Money is integer USD cents. See Q-5 for the
  configurable part, and `data-model.md` D-1 for the storage form.
- **Q-5 Fuel volume precision → a per-install setting.** `fuel_volume_precision`
  in `deployment_settings`, default `3`, range `1..3`. The admin sets it during
  setup. It governs the fractional digits the API accepts, the value it stores,
  and every displayed volume and derived price-per-gallon. Applied to
  `data-model.md` and `spec.md` FR-15.
- **Q-6 Export format → A.** One JSON document, Chotu's own shape,
  schema-versioned. CSV and Drivvo-compatible exports can come later.
- **Q-7 Import in M1 → no.** M1 ships export only. Import is M2, alongside the
  legacy migration in `0002`. Applied to FR-16.3 and the scope list.
- **Q-9 SQLite scope → development and test only.** Staging and production run
  PostgreSQL. SQLite stays a supported adapter so the persistence boundary is
  exercised in local work and CI, not as a deployment target. Applied to
  `constitution.md` and `spec.md` non-functionals.
- **Q-11 Headless password sign-in → allowed.** A non-browser client may hold
  the opaque session credential returned by sign-in and send it as a bearer
  value. The same request also sets the browser cookie. Applied to FR-2.1.
- **Q-14 Rate limits → yes.** Sign-in, password-reset request, and invitation
  acceptance are rate limited, per IP and per account. Concrete thresholds are
  set during the plan. Draft starting point: sign-in 10/min/IP and 5/min/account,
  reset request 3/hour/IP and 3/hour/account, invitation acceptance 10/hour/IP.
- **Q-15 Restore → out of M1.** Restore tooling is `0002` or later. A documented
  manual restore from the backup file is acceptable for M1. Applied to FR-18.2.
- **Q-16 Admin bootstrap credential → the `scott` / `tiger` Easter egg.** If the
  operator supplies no admin credentials, `bootstrap` seeds the first admin as
  `scott@chotu.local` with password `tiger`, a nod to the classic Oracle demo
  account. Guardrails: the account is flagged `must_change_password`; the API
  refuses to serve non-development traffic while a default-credential admin
  still has the unchanged password; `bootstrap` prints a clear warning. The
  operator may instead pass an email and password, or take a one-time
  set-password link. Applied to FR-1.5, FR-1.6, and `data-model.md`.

## Moved to research backlog

Non-blocking for M1. Tracked in `../research-backlog.md`.

- **Q-10 Deployment target → R-1.** Research deployment hardware and
  virtualization options, including emerging AI-native application deployment.
  The application must stay deployment-agnostic so a target can be swapped.
- **Q-12 Transactional email → R-2.** Research how AI-native development
  workflows send verification, reset, and invitation email. Find the
  recommended pattern.
- **Q-13 OIDC client secret storage → R-3.** Research secret storage for
  self-hosted apps. Leaning: support both an encrypted-at-rest value and an
  environment reference.
