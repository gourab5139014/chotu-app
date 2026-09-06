import type {
  DeploymentSettingsRow,
  FuelEntryRow,
  UserRow,
  VehicleRow,
} from "../../src/db/schema/types";

/**
 * The `odometer-decrease` fixture: one vehicle whose stored entries already
 * violate INV-2 in two ways — an adjacent decreasing pair, and a back-dated
 * entry that lands mid-sequence below its new neighbours. Seeded directly
 * through the repos (the API would reject these), so reconciliation (slice 10)
 * has something to flag and the INV-2 domain check has a realistic input.
 * See specs/0001-m1-trusted-fuel-logging/data-model.md "Fixtures".
 */

const T0 = new Date("2026-04-01T00:00:00.000Z");

export const odoSettings: DeploymentSettingsRow = {
  id: "singleton",
  deploymentName: "Odometer Fixture",
  registrationPolicy: "invite_only",
  allowedAuthMethods: ["password"],
  defaultUnitSystem: "imperial",
  defaultCurrencyCode: "USD",
  defaultTimeZone: "America/New_York",
  fuelVolumePrecision: 3,
  sessionTtlSeconds: 3600,
  apiTokenTtlSeconds: null,
  createdAt: T0,
  updatedAt: T0,
};

export const odoUser: UserRow = {
  id: "00000000-0000-7000-8000-00000000d001",
  email: "driver@example.com",
  emailVerifiedAt: T0,
  displayName: "Driver",
  role: "user",
  status: "active",
  passwordHash: "argon2id$odo",
  mustChangePassword: false,
  unitSystem: "imperial",
  currencyCode: "USD",
  timeZone: "America/New_York",
  createdAt: T0,
  updatedAt: T0,
  deactivatedAt: null,
};

export const odoVehicle: VehicleRow = {
  id: "00000000-0000-7000-8000-00000000d100",
  userId: odoUser.id,
  name: "Wagon",
  make: null,
  model: null,
  year: null,
  fuelType: null,
  initialOdometerMiE3: 10_000_000,
  archivedAt: null,
  createdAt: T0,
  updatedAt: T0,
};

function entry(over: Partial<FuelEntryRow>): FuelEntryRow {
  return {
    id: "00000000-0000-7000-8000-00000000e000",
    vehicleId: odoVehicle.id,
    entryDate: "2026-04-02",
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

/**
 * Ordered by (entry_date, created_at, id). Entry `e3` decreases against `e2`
 * (adjacent pair). Entry `e2b` is back-dated between `e1` and `e2` with an
 * odometer below `e1` (mid-sequence decrease).
 */
export const odoEntries: readonly FuelEntryRow[] = [
  entry({
    id: "00000000-0000-7000-8000-00000000e001",
    entryDate: "2026-04-02",
    odometerMiE3: 10_100_000,
  }),
  entry({
    id: "00000000-0000-7000-8000-00000000e002",
    entryDate: "2026-04-10",
    odometerMiE3: 10_500_000,
  }),
  entry({
    id: "00000000-0000-7000-8000-00000000e003",
    entryDate: "2026-04-18",
    odometerMiE3: 10_400_000, // < e2 — adjacent decrease
  }),
  entry({
    id: "00000000-0000-7000-8000-00000000e004",
    entryDate: "2026-04-05", // back-dated, lands between e1 and e2
    odometerMiE3: 10_050_000, // < e1 — mid-sequence decrease
  }),
];

export const odometerDecrease = {
  settings: odoSettings,
  user: odoUser,
  vehicle: odoVehicle,
  entries: odoEntries,
} as const;

export type OdometerDecreaseFixture = typeof odometerDecrease;
