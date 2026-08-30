# 0001 — User stories

- **Status:** draft, awaiting review
- **Related:** `spec.md`, `data-model.md`, `open-questions.md`, `../constitution.md`

## Actor model

- **User** — an account holder. Signs in, manages only their own vehicles and
  fuel entries. Strict isolation: no cross-user vehicle sharing in this scope.
- **Administrator** — a user account with deployment-management rights. An admin
  is still a normal user for their own vehicles. An admin can read accounts and
  data-integrity findings. An admin **cannot** read a user's fuel entries.
- **Deployment** — one running Chotu instance with its own database and its own
  set of users. Every deployment can have multiple users. Every user can have
  multiple vehicles.

## Scope tags

- **[M1]** — in the first milestone. M1 is API only. Every [M1] story is
  satisfiable over HTTP with a bearer credential and no UI.
- **[M1.5]** — the first-party `chotu` CLI.
- **[P3]** — delivery phase 3, "trustworthy insights", after M1.

## Registration and auth decisions

- A fresh deployment starts **invite-only**. Open self-registration and SSO
  auto-provisioning are admin toggles per deployment.
- Auth methods:
  - Browser and SPA: OIDC Authorization Code with PKCE, or email and password.
  - CLI and agents: a per-user API token, or OIDC Device Authorization Grant.
  - Every client sends a bearer credential. The API never sees a password after
    sign-in.
- Admin endpoints require the admin role, not only a valid credential.

---

## User stories — end user

### Epic U-A: Account and session

- **U-1 [M1]** As a user, I want to create an account with email and password,
  so that I can keep my own vehicle history.
- **U-2 [M1]** As a user, I want to accept an invitation link, so that I can
  join a deployment that is invite-only.
- **U-3 [M1]** As a user, I want to sign in with an external identity provider,
  so that I reuse an identity I already have and manage no extra password.
  *AC: OIDC Authorization Code with PKCE for browser clients.*
- **U-4 [M1]** As a user, I want to link an external identity to my existing
  account, so that I can switch sign-in methods without losing data.
- **U-5 [M1]** As a user, I want to sign in and receive a session, so that I can
  use the app.
- **U-6 [M1]** As a user, I want to sign out, so that my session cannot be
  reused on a shared device.
- **U-7 [M1]** As a user, I want to change my password, so that I can keep a
  password account secure.
- **U-8 [M1]** As a user, I want to reset a forgotten password by email, so that
  I can regain access. *Applies to password accounts only.*
- **U-9 [M1]** As a user, I want to delete my account and all my data, so that I
  control my footprint.

### Epic U-B: Profile and preferences

- **U-10 [M1]** As a user, I want to set my display name, so that the app
  addresses me correctly.
- **U-11 [M1]** As a user, I want to set my unit system, metric or imperial, so
  that I enter and read values in familiar units.
- **U-12 [M1]** As a user, I want to set my currency, so that fuel costs are
  recorded consistently.
- **U-13 [M1]** As a user, I want to set my time zone, so that entry dates and
  the future-date check behave correctly.
- **U-14 [M1]** As a user, I want a unit or currency change to not rewrite past
  entries, so that history stays accurate.
- **U-15 [P3]** As a user, I want to choose my consumption-unit convention, for
  example MPG or L/100km or km/L, independent of the metric or imperial toggle,
  so that economy figures read the way I expect.

### Epic U-C: Vehicles

- **U-16 [M1]** As a user, I want to add a vehicle with a name and a starting
  odometer, so that I can log fill-ups against it.
- **U-17 [M1]** As a user, I want to add optional make, model, year, and fuel
  type, so that my records are complete.
- **U-18 [M1]** As a user, I want to keep several vehicles, so that I can track a
  household fleet.
- **U-19 [M1]** As a user, I want to list and view my vehicles, so that I can
  pick one to work with.
- **U-20 [M1]** As a user, I want to edit a vehicle's details, so that I can fix
  mistakes.
- **U-21 [M1]** As a user, I want to archive a vehicle I no longer use, so that
  it leaves my active list but keeps its history.
- **U-22 [M1]** As a user, I want to unarchive a vehicle, so that I can resume
  logging.
- **U-23 [M1]** As a user, I want deletion of a vehicle with history to require
  an explicit confirmation, so that I do not lose records by accident.

### Epic U-D: Fuel entries

- **U-24 [M1]** As a user, I want to log a fill-up in one step — date, odometer,
  volume, total cost, full-tank flag, optional notes — so that logging takes
  under 30 seconds.
- **U-25 [M1]** As a user, I want to enter values in my own unit system, so that
  I do not convert by hand.
- **U-26 [M1]** As a user, I want the app to reject an odometer that goes
  backwards, so that my mileage stays trustworthy.
- **U-27 [M1]** As a user, I want clear, specific errors when an entry is
  invalid, so that I can correct it quickly.
- **U-28 [M1]** As a user, I want to list a vehicle's fuel history newest first,
  with a date filter and paging, so that I can review it.
- **U-29 [M1]** As a user, I want to view one entry in full, so that I can check
  what I recorded.
- **U-30 [M1]** As a user, I want to edit an entry, so that I can fix a wrong
  reading, with the invariant checks re-run.
- **U-31 [M1]** As a user, I want to delete an entry, so that I can remove a
  mistaken record, with history recomputing correctly.

### Epic U-E: Trust and insight  *(phase 3)*

Fuel-only. All values computed on read. Inspired by the Drivvo analytics set.

- **U-32 [P3]** As a user, I want fuel economy computed only between two
  full-tank fills, so that the figure is correct.
- **U-33 [P3]** As a user, I want first fill-ups and partial fills to show no
  economy figure rather than a misleading one, so that I trust the number.
- **U-34 [P3]** As a user, I want cost over time for a vehicle, by month and by a
  custom range, so that I understand my spend.
- **U-35 [P3]** As a user, I want average, best, and worst economy for a vehicle
  over a chosen range, so that I can spot changes.
- **U-36 [P3]** As a user, I want cost per distance over time, so that I see the
  true running cost.
- **U-37 [P3]** As a user, I want price-per-volume history, so that I see what I
  paid per litre or gallon over time.
- **U-38 [P3]** As a user, I want total distance for a period, so that I know how
  much I drove.
- **U-39 [P3]** As a user, I want total volume and total spend for a period, plus
  lifetime running totals, so that I have the headline numbers.
- **U-40 [P3]** As a user, I want fill-up frequency — average days and average
  distance between fills — so that I understand my usage pattern.
- **U-41 [P3]** As a user, I want to compare two of my vehicles on one metric, so
  that I can judge them side by side.
- **U-42 [P3]** As a user, I want a monthly and an annual summary at a glance, so
  that I get a periodic picture without building it myself.
- **U-43 [P3]** As a user, I want a recent-activity feed across all my vehicles,
  so that I see what I logged lately.
- **U-44 [P3]** As a user, I want to export a report as CSV, so that I can use it
  elsewhere. PDF may come later.

Out of scope until the services module: spend by category, cost projections, and
maintenance reminders.

### Epic U-F: Portability

- **U-45 [M1]** As a user, I want to export all my data in one documented file,
  so that I am not locked in.
- **U-46 [M1]** As a user, I want a reconciliation check on my own data that
  reports duplicates, gaps, and odometer problems, so that I can clean it up.
- **U-47 [P3]** As a user, I want to import a previous export into a fresh
  account, so that I can move between deployments. *(Import timing — see
  `open-questions.md` Q-7.)*

### Epic U-G: API access

- **U-48 [M1]** As a user, I want to create a personal API token, so that I can
  drive Chotu from a script or an LLM chat client.
- **U-49 [M1]** As a user, I want to list, revoke, and reissue my tokens, so
  that I can rotate a leaked credential.
- **U-50 [M1]** As a user, I want to read the OpenAPI document without auth, so
  that a client can learn the API.
- **U-51 [M1]** As a user, I want every capability above available over the API,
  so that I never depend on a UI.
- **U-52 [M1]** As a user, I want endpoint descriptions written plainly enough
  that an LLM client can call the API correctly from the document alone, so that
  agent use works without extra glue.

### Epic U-H: Terminal and agent use  *(M1.5)*

- **U-53 [M1.5]** As a user, I want a first-party `chotu` CLI, so that I can
  manage vehicles and log fill-ups from my terminal with no browser or app.
- **U-54 [M1.5]** As a user, I want the CLI to authenticate with a pasted API
  token or with a browserless device sign-in, so that SSO works where I cannot
  complete a browser redirect. *AC: OAuth 2.0 Device Authorization Grant for the
  SSO path.*
- **U-55 [M1.5]** As a user, I want CLI commands to emit machine-readable
  output, so that I can pipe Chotu into scripts and other tools.
- **U-56 [M1.5]** As a user, I want an AI agent such as Claude Code to operate
  Chotu through the API or the CLI, so that I can log and query by chatting.
- **U-57 [M1.5]** As a user, I want the CLI in one install step, so that setup is
  fast.

---

## User stories — administrator

### Epic A-A: Deployment bootstrap

- **A-1 [M1]** As an admin, I want to supply database connection and bootstrap
  credentials, so that Chotu can create its own schema.
- **A-2 [M1]** As an admin, I want bootstrap to create only Chotu-owned objects
  and stop with an actionable error on missing privileges, so that my database
  stays safe.
- **A-3 [M1]** As an admin, I want bootstrap to create the first admin account,
  so that I can sign in immediately after install.
- **A-4 [M1]** As an admin, I want the minimum required database privileges
  documented, so that I can grant least privilege.

### Epic A-B: User management

- **A-5 [M1]** As an admin, I want to invite or create user accounts, so that I
  control who joins.
- **A-6 [M1]** As an admin, I want to list users with their status and vehicle
  count, so that I can see deployment usage. *No fuel-entry contents.*
- **A-7 [M1]** As an admin, I want to deactivate and reactivate a user, so that
  I can suspend access without deleting data.
- **A-8 [M1]** As an admin, I want to trigger a password reset for a user, so
  that I can help someone locked out.
- **A-9 [M1]** As an admin, I want to delete a user and their data, with
  confirmation, so that I can honour a removal request.
- **A-10 [M1]** As an admin, I want to grant and revoke the admin role, so that
  another trusted person can help operate the deployment.
- **A-11 [M1]** As an admin, I want the deployment to always keep at least one
  admin, so that it cannot be locked out.

### Epic A-C: Access policy and configuration

- **A-12 [M1]** As an admin, I want to choose the registration policy —
  invite-only, open, or SSO auto-provision — so that the deployment matches its
  audience. Default is invite-only.
- **A-13 [M1]** As an admin, I want to choose which sign-in methods are allowed —
  password, external identity, or both — so that it matches my security policy.
- **A-14 [M1]** As an admin, I want to connect one or more OIDC providers, so
  that I control sign-in centrally.
- **A-15 [M1]** As an admin, I want external-identity users provisioned
  automatically on first sign-in, optionally restricted to certain email domains
  or IdP groups, so that onboarding is controlled and automatic.
- **A-16 [M1]** As an admin, I want to set deployment defaults for units and
  currency, so that new users start sensibly.
- **A-17 [M1]** As an admin, I want to name the deployment, so that users know
  which instance they are on.
- **A-18 [M1]** As an admin, I want to set session and token lifetime policy, so
  that I can match my security needs.

### Epic A-D: Operations and data integrity

- **A-19 [M1]** As an admin, I want to see deployment health and the applied
  schema version, so that I know the instance is sound.
- **A-20 [M1]** As an admin, I want to apply pending schema migrations when I
  deploy a new version, so that upgrades are controlled.
- **A-21 [M1]** As an admin, I want to run a deployment-wide reconciliation
  report, so that I can find data problems across all users. The report lists
  record ids and check codes, not fuel-entry contents.
- **A-22 [M1]** As an admin, I want a full deployment export for backup, so that
  I can restore after a failure.
- **A-23 [P3]** As an admin, I want to restore a deployment from an export, so
  that I can recover. *(Restore tooling timing — see `open-questions.md`.)*

### Epic A-E: Security and audit

- **A-24 [M1]** As an admin, I want an audit log of admin actions, so that
  account changes are traceable.
- **A-25 [M1]** As an admin, I want to rotate deployment-level secrets, so that a
  leak is contained.
- **A-26 [M1]** As an admin, I want admin endpoints to require the admin role,
  not only a valid credential, so that a normal user cannot manage the
  deployment.

---

## Consequences for the other specs

Recorded here so the rewrites stay consistent.

- **Constitution.** Replace single-user framing with the actor model above.
  Auth section gains OIDC Authorization Code, OIDC Device Grant, and per-user API
  tokens. Add the clients list: API, `chotu` CLI, AI agents, SPA, third-party
  HTTP clients.
- **`data-model.md`.** `profile` becomes `user`. Add `identity` for external
  logins, `invitation`, `session`, `password_reset`, `deployment_settings`, and
  `audit_log`. `api_token`, `vehicle` gain `user_id`. Add a role attribute on
  `user`. Ownership chain becomes fuel_entry to vehicle to user.
- **`spec.md`.** FR-2 grows from one bootstrap token to full multi-user auth.
  Add functional requirements for user management, registration policy, OIDC,
  and the audit log. Acceptance criteria gain multi-user isolation and
  admin-visibility limits.
- **Linear.** Update the Chotu project and M1 milestone to record multi-user,
  the admin role, and SSO, replacing the "single-user" text.
