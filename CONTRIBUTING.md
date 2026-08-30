# Contributing to chotu-app

Thanks for helping. This guide covers setup, secrets, and the pull request
process.

## License and sign-off

chotu-app is licensed under **AGPL-3.0**. By contributing, you agree that your
contribution is licensed under the same terms.

Every commit must carry a Developer Certificate of Origin sign-off:

```bash
git commit -s -m "your message"
```

The `-s` flag adds a `Signed-off-by:` line. It certifies that you wrote the
change or have the right to submit it under the project license. See
<https://developercertificate.org/>. A commit without a sign-off cannot be
merged.

## Prerequisites

- Node.js 20 or later
- Docker (for the local database), or your own Postgres instance
- `git`
- `pre-commit` (`pipx install pre-commit` or `brew install pre-commit`)

## Setup

```bash
# 1. Clone your fork
git clone https://github.com/<you>/chotu-app
cd chotu-app

# 2. Create your local env file
cp .env.example .env.local

# 3. Install the secret-scanning git hook
pre-commit install

# 4. Start the local database (throwaway credentials, no cloud account)
docker compose up -d        # once docker-compose.yml lands

# 5. Install dependencies and run
npm install                 # once package.json lands
npm run dev
```

You bring your own credentials. Chotu does not ship shared keys. For local work
the docker-compose database and the dummy values in `.env.example` are enough.
For a hosted database, set `DATABASE_URL` and `DATABASE_BOOTSTRAP_URL` to your
own instance.

### Bootstrap permissions

`DATABASE_BOOTSTRAP_URL` is used once at startup to create or upgrade Chotu's
own schema. The role needs `CREATE` and `ALTER` on the Chotu schema and nothing
outside it. Chotu never creates or alters objects in schemas it does not own.
If the role lacks a required grant, startup stops with an actionable error.

## Secrets: the rules

- Never commit a real secret. `.env`, `.env.local`, and `.env.*.local` are
  git-ignored. Keep it that way.
- `.env.example` holds keys and dummy values only.
- Any value that reaches the browser is **public**. Only publishable or
  client-safe identifiers may get a browser-exposed prefix. Server secrets
  (`APP_SECRET`, database URLs) stay server-side.
- The `pre-commit` hook runs `gitleaks` on every commit. If it blocks a commit,
  a secret is in your staged changes. Remove it. Do not bypass the hook.
- If a secret ever reaches a branch, even briefly: rotate it first, then clean
  history. Rotation is the fix. History rewriting is cleanup.

## Pull request process

1. Branch from `main`. Name it `feat/...`, `fix/...`, or `chore/...`.
2. Keep the change focused. One topic per pull request.
3. Sign off every commit (`git commit -s`).
4. CI must pass. It runs `gitleaks`, lint, typecheck, and tests. CI on a pull
   request runs with no repository secrets by design. Do not add workflows that
   need secrets on the `pull_request` or `pull_request_target` trigger.
5. A maintainer reviews and merges. First-time contributor workflows need
   maintainer approval before they run.

## Reporting security issues

Do not open a public issue for a vulnerability. See [SECURITY.md](SECURITY.md).
