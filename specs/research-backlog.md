# Research backlog

Items that need investigation before a decision. None blocks M1. Each should end
in a short written recommendation, added here and folded into the relevant spec.

## R-1 Deployment target and portability

**Question.** Where does a Chotu deployment run, and how do we keep the choice
swappable?

- Compare deployment options: a small VM with a process manager, a container
  host, a managed container platform, and a serverless or edge runtime.
- Include emerging AI-native application deployment approaches and what they
  require of an app.
- The API process must stay stateless. PostgreSQL is the only stateful
  dependency. Configuration comes from the environment. No host coupling.
- Output: a recommended default target for the first production deployment, plus
  a short list of what the code must avoid so a target swap stays cheap.

Origin: `0001` open question Q-10.

## R-2 Transactional email in an AI-native workflow

**Question.** How should Chotu send email verification, password reset, and
invitation links?

- Survey what current agentic and AI-native development workflows do for
  outbound transactional email in a self-hosted app.
- Options to weigh: require SMTP configuration, integrate a provider API, return
  the link in the API response for manual delivery, or a policy that picks one
  based on configuration.
- Consider local development and test, where no real email should be sent.
- Output: a recommended default and the configuration surface.

Origin: `0001` open question Q-12. Interim behaviour in the spec: return the
link in the API response when no delivery channel is configured.

## R-3 Secret storage for a self-hosted app

**Question.** How does a self-hosted Chotu store secrets such as OIDC client
secrets and the session-signing key?

- Compare an encrypted-at-rest value in the database with a deployment key,
  against an environment-variable or secret-file reference.
- Consider key rotation, backups, and the bootstrap story.
- Leaning, stated by the project lead: support both.
- Output: a recommended default, the fallback, and the key-management steps a
  self-hoster must follow.

Origin: `0001` open question Q-13.
