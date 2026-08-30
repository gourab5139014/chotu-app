# Specs

Chotu follows spec-driven development. A spec is the source of truth. Code is a
generated, verifiable artifact that realizes the spec.

## Layout

```
specs/
  constitution.md                 fixed decisions: mission, stack, principles, contract rules
  NNNN-<slug>/
    spec.md                       requirements, acceptance criteria, out of scope
    data-model.md                 canonical domain model and constraints (the data contract)
    plan.md                       design and approach (added after spec review)
    tasks.md                      dependency-ordered task list (added after plan review)
    open-questions.md             unresolved decisions for this slice
```

Numbers are zero-padded and never reused. `0001` is the first slice.

## Workflow

1. **Spec.** Write `spec.md` and `data-model.md`. State intent in domain
   language. Add an explicit "Out of scope" section.
2. **Review.** A human reviews the spec before any design work.
3. **Plan.** Add `plan.md`. Name the components, the contracts, and the risks.
4. **Review.** A human reviews the plan.
5. **Tasks.** Add `tasks.md`. Small, ordered, each traceable to a spec section.
6. **Implement.** One task at a time. Change the contract file first. Run
   codegen. Never hand-edit generated files.
7. **Verify.** CI and a reviewer check the code against the spec.

## Rules

- Change `openapi.yaml` before changing an API route.
- Change the Drizzle schema before writing a migration.
- A PR that changes an endpoint without the spec fails CI.
- Cite the spec in the commit body, for example
  `Implements specs/0001-m1-trusted-fuel-logging/spec.md#fuel-entry`.
- Specs are durable. They outlive the code that realizes them.

## CI gates (all blocking)

1. Spec lint — Spectral on `openapi.yaml`
2. Breaking-change check — `oasdiff` against the base branch
3. Codegen is current — run every generator, then `git diff --exit-code`
4. Schema drift — `drizzle-kit check`
5. Typecheck — `tsc --noEmit`
6. Contract tests — live API responses validate against `openapi.yaml`, per adapter
7. Unit and end-to-end tests
