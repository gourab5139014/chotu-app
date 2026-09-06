import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const HERE = dirname(fileURLToPath(import.meta.url));
const testRoot = resolve(HERE, "..");

/**
 * AC-1..AC-12 traceability (T11.3). Each acceptance criterion in
 * specs/0001-m1-trusted-fuel-logging/spec.md maps to at least one named test.
 * A referenced file that goes missing, or an AC left without coverage, fails
 * this test.
 */
const COVERAGE: Record<string, Array<{ file: string; name: string }>> = {
  "AC-1": [
    {
      file: "db/bootstrap-seed.test.ts",
      name: "seedDeployment — each credential path yields a usable admin",
    },
    {
      file: "db/bootstrap-migrate.test.ts",
      name: "bootstrapSchema — migrates a fresh DB and records the version",
    },
  ],
  "AC-2": [
    {
      file: "db/bootstrap-probe.test.ts",
      name: "probePrivileges — an under-granted role gets the exact GRANT lines",
    },
  ],
  "AC-3": [
    {
      file: "routes/reconcile.test.ts",
      name: "a clean dataset returns no findings (FR-17.5)",
    },
    { file: "routes/journey.test.ts", name: "AC-5 journey (clean data end to end)" },
  ],
  "AC-4": [
    {
      file: "db/repositories.test.ts",
      name: "describeEachAdapter — repository suite runs on sqlite and postgres",
    },
    {
      file: "support/adapters.ts",
      name: "describeEachAdapter helper — both dialects in CI",
    },
  ],
  "AC-5": [
    {
      file: "routes/journey.test.ts",
      name: "invite -> accept -> sign in -> vehicle -> fill-up -> correction",
    },
  ],
  "AC-6": [
    { file: "reconcile/checks.test.ts", name: "runReconcile — check registry" },
    { file: "domain/odometer.test.ts", name: "assertOdometerProgression (INV-2)" },
    { file: "units/convert.test.ts", name: "units round-trip property tests" },
  ],
  "AC-7": [
    {
      file: "routes/isolation-matrix.test.ts",
      name: "isolation matrix — every user-scoped route",
    },
  ],
  "AC-8": [
    {
      file: "routes/admin-mutations.test.ts",
      name: "refuses to demote, deactivate, or delete the last active admin",
    },
    {
      file: "routes/admin-mutations.test.ts",
      name: "two concurrent demotions never reach zero admins",
    },
  ],
  "AC-9": [
    {
      file: "routes/audit-matrix.test.ts",
      name: "covers every AUDIT_ACTIONS entry with a clean single audit row",
    },
  ],
  "AC-10": [
    {
      file: "contract/openapi.test.ts",
      name: "the served document matches the committed openapi.yaml",
    },
  ],
  "AC-11": [
    {
      file: "routes/oidc.test.ts",
      name: "auto-provisions on first sign-in; rejects an out-of-domain identity",
    },
  ],
  "AC-12": [
    {
      file: "startup.test.ts",
      name: "production refuses to start with an unchanged seeded admin",
    },
    {
      file: "auth/change-password.test.ts",
      name: "a must-change-password user is gated on everything else",
    },
  ],
};

describe("AC-1..AC-12 coverage (T11.3)", () => {
  it("every acceptance criterion is present", () => {
    const expected = Array.from({ length: 12 }, (_, i) => `AC-${i + 1}`);
    expect(Object.keys(COVERAGE).sort()).toEqual(expected.sort());
  });

  it("every acceptance criterion names at least one test", () => {
    for (const [ac, refs] of Object.entries(COVERAGE)) {
      expect(refs.length, `${ac} has no test`).toBeGreaterThan(0);
      for (const ref of refs) {
        expect(ref.name.length, `${ac}: empty test name`).toBeGreaterThan(0);
      }
    }
  });

  it("every referenced test file exists", () => {
    for (const [ac, refs] of Object.entries(COVERAGE)) {
      for (const ref of refs) {
        expect(
          existsSync(resolve(testRoot, ref.file)),
          `${ac}: missing ${ref.file}`,
        ).toBe(true);
      }
    }
  });
});
