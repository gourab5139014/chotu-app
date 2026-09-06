import type { FuelEntryRow, VehicleRow } from "../db/schema/types";
import { compareEntryOrder } from "../domain/odometer";

/**
 * Reconciliation: read-only checks over a user's data (FR-17). Each check is a
 * pure function of a `ReconcileScope`. `odometer_decrease`, `missing_field`,
 * and `out_of_range` cannot fire on API-only data (the DB CHECKs and FR-13.3
 * block them) — they are safety nets for `0002` import and any direct database
 * change (FR-17.3).
 */

export type ReconcileCheckCode =
  | "duplicate"
  | "orphaned"
  | "odometer_tie"
  | "odometer_decrease"
  | "missing_field"
  | "out_of_range";

export interface Finding {
  checkCode: ReconcileCheckCode;
  recordType: "fuel_entry" | "vehicle";
  recordId: string;
  /** The owning vehicle, when known. */
  vehicleId: string | null;
  /** Human-readable, no field values — safe for the admin report too. */
  message: string;
}

export interface ReconcileScope {
  vehicles: readonly VehicleRow[];
  entries: readonly FuelEntryRow[];
  fuelVolumePrecision: number;
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const CURRENCY_RE = /^[A-Z]{3}$/;

function entryFinding(
  checkCode: ReconcileCheckCode,
  e: FuelEntryRow,
  message: string,
): Finding {
  return {
    checkCode,
    recordType: "fuel_entry",
    recordId: e.id,
    vehicleId: e.vehicleId,
    message,
  };
}

/** Same vehicle, entry date, odometer, volume, and total cost (FR-17.3). */
function checkDuplicates(scope: ReconcileScope): Finding[] {
  const groups = new Map<string, FuelEntryRow[]>();
  for (const e of scope.entries) {
    const key = [
      e.vehicleId,
      e.entryDate,
      e.odometerMiE3,
      e.volumeGalE3,
      e.totalCostUsdCents,
    ].join("|");
    const bucket = groups.get(key);
    if (bucket) bucket.push(e);
    else groups.set(key, [e]);
  }
  const out: Finding[] = [];
  for (const members of groups.values()) {
    if (members.length < 2) continue;
    for (const e of members) {
      out.push(
        entryFinding(
          "duplicate",
          e,
          "Duplicate of another entry (same vehicle, date, odometer, volume, and cost).",
        ),
      );
    }
  }
  return out;
}

/** An entry whose vehicle is not in the dataset. */
function checkOrphaned(scope: ReconcileScope): Finding[] {
  const vids = new Set(scope.vehicles.map((v) => v.id));
  return scope.entries
    .filter((e) => !vids.has(e.vehicleId))
    .map((e) =>
      entryFinding(
        "orphaned",
        e,
        "Entry references a vehicle that is not in this dataset.",
      ),
    );
}

/** Odometer ties and decreases against the preceding reading (INV-2). */
function checkOdometerSequence(scope: ReconcileScope): Finding[] {
  const out: Finding[] = [];
  for (const v of scope.vehicles) {
    const seq = scope.entries
      .filter((e) => e.vehicleId === v.id)
      .slice()
      .sort(compareEntryOrder);
    let prev = v.initialOdometerMiE3;
    let prevIsEntry = false;
    for (const e of seq) {
      if (e.odometerMiE3 < prev) {
        out.push(
          entryFinding(
            "odometer_decrease",
            e,
            "Odometer is lower than the preceding reading.",
          ),
        );
      } else if (e.odometerMiE3 === prev && prevIsEntry) {
        out.push(
          entryFinding(
            "odometer_tie",
            e,
            "Odometer is unchanged from the preceding entry.",
          ),
        );
      }
      prev = e.odometerMiE3;
      prevIsEntry = true;
    }
  }
  return out;
}

/** Structurally absent or malformed required fields (import safety net). */
function checkMissingFields(scope: ReconcileScope): Finding[] {
  const out: Finding[] = [];
  for (const e of scope.entries) {
    const bad: string[] = [];
    if (!DATE_RE.test(e.entryDate)) bad.push("entry_date");
    if (!CURRENCY_RE.test(e.currencyCode)) bad.push("currency_code");
    if (e.sourceUnitSystem !== "imperial" && e.sourceUnitSystem !== "metric") {
      bad.push("source_unit_system");
    }
    if (e.sourcePayload == null || typeof e.sourcePayload !== "object") {
      bad.push("source_payload");
    }
    if (bad.length > 0) {
      out.push(
        entryFinding(
          "missing_field",
          e,
          `Missing or malformed required field(s): ${bad.join(", ")}.`,
        ),
      );
    }
  }
  return out;
}

/** Values outside the documented per-row constraints (import safety net). */
function checkOutOfRange(scope: ReconcileScope): Finding[] {
  const out: Finding[] = [];
  for (const e of scope.entries) {
    const bad: string[] = [];
    if (!(e.volumeGalE3 > 0)) bad.push("volume must be greater than zero");
    if (e.totalCostUsdCents < 0) bad.push("total cost must be zero or greater");
    if (e.odometerMiE3 < 0) bad.push("odometer must be zero or greater");
    if (
      !Number.isSafeInteger(e.volumeGalE3) ||
      !Number.isSafeInteger(e.totalCostUsdCents) ||
      !Number.isSafeInteger(e.odometerMiE3)
    ) {
      bad.push("a canonical value is not a safe integer");
    }
    if (bad.length > 0) {
      out.push(entryFinding("out_of_range", e, `Out of range: ${bad.join("; ")}.`));
    }
  }
  for (const v of scope.vehicles) {
    if (v.year != null && (v.year < 1900 || v.year > 2100)) {
      out.push({
        checkCode: "out_of_range",
        recordType: "vehicle",
        recordId: v.id,
        vehicleId: v.id,
        message: "Vehicle year is outside 1900..2100.",
      });
    }
    if (v.initialOdometerMiE3 < 0) {
      out.push({
        checkCode: "out_of_range",
        recordType: "vehicle",
        recordId: v.id,
        vehicleId: v.id,
        message: "Vehicle starting odometer is negative.",
      });
    }
  }
  return out;
}

const CHECKS = [
  checkDuplicates,
  checkOrphaned,
  checkOdometerSequence,
  checkMissingFields,
  checkOutOfRange,
];

/** Run every check and return the findings in a stable order. */
export function runReconcile(scope: ReconcileScope): Finding[] {
  const findings = CHECKS.flatMap((check) => check(scope));
  return findings.sort(
    (a, b) =>
      a.recordId.localeCompare(b.recordId) ||
      a.checkCode.localeCompare(b.checkCode),
  );
}
