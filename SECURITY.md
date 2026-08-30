# Security Policy

## Supported versions

chotu-app is pre-release. Only the `main` branch receives security fixes.

## Reporting a vulnerability

**Do not open a public issue for a security problem.**

Report it through GitHub private vulnerability reporting:

1. Go to the repository **Security** tab.
2. Select **Report a vulnerability**.
3. Describe the issue, the impact, and steps to reproduce.

This opens a private channel between you and the maintainers.

## What to expect

- An acknowledgement within 5 working days.
- An assessment of severity and affected versions.
- A fix on `main`, and a coordinated disclosure once the fix is available.

## Scope

In scope: the application code in this repository.

Out of scope: issues in third-party dependencies (report those upstream),
misconfiguration of a self-hosted deployment, and any secret a user commits to
their own fork.

## Handling a leaked secret

If a credential is exposed in this repository or a fork:

1. Rotate or revoke the credential immediately. Assume it is already scraped.
2. Invalidate sessions or tokens issued from it.
3. Then rewrite history to remove the value and force-push.

Rotation is the fix. History rewriting is cleanup, not remediation.
