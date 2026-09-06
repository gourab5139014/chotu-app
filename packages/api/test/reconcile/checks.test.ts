import { describe, expect, it } from "vitest";

import { runReconcile, type ReconcileScope } from "../../src/reconcile";
import {
  cleanScope,
  duplicateScope,
  invalidValuesScope,
  odometerTieScope,
  orphanedScope,
} from "../fixtures/reconcile";
import { odometerDecrease } from "../support/fixtures";

const codesFor = (scope: ReconcileScope) =>
  runReconcile(scope)
    .map((f) => `${f.recordId}:${f.checkCode}`)
    .sort();

describe("runReconcile — check registry (T10.1)", () => {
  it("clean produces no findings (FR-17.5)", () => {
    expect(runReconcile(cleanScope)).toEqual([]);
  });

  it("duplicate: every member of a duplicate group is flagged (and a same-odometer copy is also a tie)", () => {
    expect(codesFor(duplicateScope)).toEqual([
      "d1:duplicate",
      "d2:duplicate",
      "d2:odometer_tie",
    ]);
  });

  it("orphaned: an entry with a missing vehicle is flagged", () => {
    expect(codesFor(orphanedScope)).toEqual(["o1:orphaned"]);
  });

  it("odometer_tie: an adjacent tie is flagged on the later entry", () => {
    expect(codesFor(odometerTieScope)).toEqual(["t2:odometer_tie"]);
  });

  it("odometer-decrease fixture: the decreases are flagged, nothing else spurious", () => {
    const scope: ReconcileScope = {
      fuelVolumePrecision: 3,
      vehicles: [odometerDecrease.vehicle],
      entries: [...odometerDecrease.entries],
    };
    const codes = codesFor(scope);
    // e004 is back-dated below e001; e003 decreases against e002.
    expect(codes).toContain(
      "00000000-0000-7000-8000-00000000e003:odometer_decrease",
    );
    expect(codes).toContain(
      "00000000-0000-7000-8000-00000000e004:odometer_decrease",
    );
    expect(codes.every((c) => c.endsWith(":odometer_decrease"))).toBe(true);
  });

  it("invalid-values: volume, cost, currency, date, unit system, and vehicle year", () => {
    const findings = runReconcile(invalidValuesScope);
    const byId = new Map<string, string[]>();
    for (const f of findings) {
      byId.set(f.recordId, [...(byId.get(f.recordId) ?? []), f.checkCode]);
    }
    expect(byId.get("iv1")).toContain("out_of_range"); // volume 0
    expect(byId.get("iv2")).toEqual(
      expect.arrayContaining(["out_of_range", "missing_field"]), // negative cost + bad currency
    );
    expect(byId.get("iv3")).toEqual(
      expect.arrayContaining(["missing_field"]), // bad date + bad unit system
    );
    expect(byId.get("veh-bad")).toContain("out_of_range"); // year 1850
  });
});
