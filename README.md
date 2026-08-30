# chotu-app

An open-source, self-hostable replacement for Drivvo. It tracks one vehicle's
fuel, service, and expense history and keeps that history accurate and easy to
maintain.

Tracked in Linear: [Chotu](https://linear.app/onepeakstudios/project/chotu-d0a7059fe23c)

## Status

Spec stage. No application code yet.

- [specs/constitution.md](specs/constitution.md) — fixed decisions: mission,
  stack, principles, contract enforcement.
- [specs/0001-m1-trusted-fuel-logging/](specs/0001-m1-trusted-fuel-logging/) —
  the first slice: an API-first, contract-enforced fuel-logging service.
- [specs/README.md](specs/README.md) — how specs and the CI gates work.

The HTTP API is the priority. A person operates Chotu with an LLM chat client or
another HTTP client until the SPA is built.

## Getting started

```bash
cp .env.example .env.local   # then fill in real values
```

`.env.local` is git-ignored. Never commit real secrets. See
[CONTRIBUTING.md](CONTRIBUTING.md) for the full setup and the list of which
values are safe to expose to a browser.

## Contributing

Read [CONTRIBUTING.md](CONTRIBUTING.md). Every commit must be signed off with
`git commit -s` (Developer Certificate of Origin).

## Security

Report vulnerabilities through GitHub private vulnerability reporting. Do not
open a public issue. See [SECURITY.md](SECURITY.md).

## License

Copyright (C) 2026 Gourab Mitra.

Licensed under the GNU Affero General Public License v3.0. See [LICENSE](LICENSE).

You may run, study, modify, and share this software. If you distribute a
modified version, or run one as a network service, you must make the complete
source of that version available to its users under the same license.
