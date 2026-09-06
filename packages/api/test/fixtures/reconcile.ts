import type { FuelEntryRow, VehicleRow } from "../../src/db/schema/types";
import type { ReconcileScope } from "../../src/reconcile";

/**
 * Pure `ReconcileScope` fixtures for the check registry (T10.1). Reconcile
 * functions are pure, so these are plain data — no DB seeding, which also lets
 * the fixtures carry values the DB CHECKs would reject (the `invalid-values`
 * case), representing imported or directly-edited data.
 */

const T0 = new Date("2026-05-01T00:00:00.000Z");

function vehicle(over: Partial<VehicleRow>): VehicleRow {
  return {
    id: "veh-1",
    userId: "user-1",
    name: "Car",
    make: null,
    model: null,
    year: null,
    fuelType: null,
    initialOdometerMiE3: 10_000_000,
    archivedAt: null,
    createdAt: T0,
    updatedAt: T0,
    ...over,
  };
}

function entry(over: Partial<FuelEntryRow>): FuelEntryRow {
  return {
    id: "ent-1",
    vehicleId: "veh-1",
    entryDate: "2026-05-02",
    odometerMiE3: 10_100_000,
    volumeGalE3: 12_000,
    totalCostUsdCents: 4500,
    currencyCode: "USD",
    isFullTank: true,
    notes: null,
    sourceUnitSystem: "imperial",
    sourcePayload: {},
    createdAt: T0,
    updatedAt: T0,
    ...over,
  };
}

/** A valid dataset — no findings (FR-17.5). */
export const cleanScope: ReconcileScope = {
  fuelVolumePrecision: 3,
  vehicles: [vehicle({})],
  entries: [
    entry({ id: "c1", entryDate: "2026-05-02", odometerMiE3: 10_100_000 }),
    entry({ id: "c2", entryDate: "2026-05-12", odometerMiE3: 10_400_000 }),
  ],
};

/** Two entries identical on (vehicle, date, odometer, volume, cost). */
export const duplicateScope: ReconcileScope = {
  fuelVolumePrecision: 3,
  vehicles: [vehicle({})],
  entries: [
    entry({ id: "d1", createdAt: new Date("2026-05-02T10:00:00Z") }),
    entry({ id: "d2", createdAt: new Date("2026-05-02T10:05:00Z") }),
    entry({ id: "d3", entryDate: "2026-05-20", odometerMiE3: 10_500_000 }),
  ],
};

/** An entry whose vehicle is not in the scope. */
export const orphanedScope: ReconcileScope = {
  fuelVolumePrecision: 3,
  vehicles: [],
  entries: [entry({ id: "o1", vehicleId: "missing-vehicle" })],
};

/** Values the DB CHECKs would reject — as if imported. */
export const invalidValuesScope: ReconcileScope = {
  fuelVolumePrecision: 3,
  vehicles: [vehicle({ id: "veh-bad", year: 1850 })],
  entries: [
    entry({ id: "iv1", vehicleId: "veh-bad", volumeGalE3: 0 }),
    entry({
      id: "iv2",
      vehicleId: "veh-bad",
      totalCostUsdCents: -100,
      currencyCode: "usd",
    }),
    entry({
      id: "iv3",
      vehicleId: "veh-bad",
      entryDate: "not-a-date",
      sourceUnitSystem: "furlongs" as never,
    }),
  ],
};

/** An adjacent tie (allowed at write time, flagged by reconciliation). */
export const odometerTieScope: ReconcileScope = {
  fuelVolumePrecision: 3,
  vehicles: [vehicle({})],
  entries: [
    entry({ id: "t1", entryDate: "2026-05-02", odometerMiE3: 10_100_000 }),
    entry({ id: "t2", entryDate: "2026-05-09", odometerMiE3: 10_100_000 }),
  ],
};
