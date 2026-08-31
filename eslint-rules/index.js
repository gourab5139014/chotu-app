/**
 * Local ESLint rules for chotu.
 *
 * `no-unscoped-entity-query` is the INV-9 isolation guard: raw `vehicle` or
 * `fuel_entry` table access is only allowed inside its repository module, so
 * every read and write is scoped to the calling user. It is a stub until the
 * schema and repositories exist (slices 8 and 9); it reports nothing now.
 */

/** @type {import("eslint").Rule.RuleModule} */
const noUnscopedEntityQuery = {
  meta: {
    type: "problem",
    docs: {
      description:
        "Ban raw vehicle/fuel_entry table access outside its repository module.",
    },
    schema: [],
    messages: {
      unscoped:
        "Raw {{table}} access outside its repository. Route it through the repo so it is user-scoped (INV-9).",
    },
  },
  create() {
    return {};
  },
};

export default {
  meta: { name: "eslint-plugin-local" },
  rules: {
    "no-unscoped-entity-query": noUnscopedEntityQuery,
  },
};
