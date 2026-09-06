import { describe, expect, it } from "vitest";

import { AppError } from "../../src/domain/errors";
import { assertOdometerProgression } from "../../src/domain/odometer";
import type { FuelEntryRow } from "../../src/db/schema/types";
import { odometerDecrease } from "../support/fixtures";

function e(over: Partial<FuelEntryRow>): FuelEntryRow {
  return {
    id: "id",
    vehicleId: "v",
    entryDate: "2026-01-01",
    odometerMiE3: 0,
    volumeGalE3: 1,
    totalCostUsdCents: 0,
    currencyCode: "USD",
    isFullTank: true,
    notes: null,
    sourceUnitSystem: "imperial",
    sourcePayload: {},
    createdAt: new Date("2026-01-01T00:00:00Z"),
    updatedAt: new Date("2026-01-01T00:00:00Z"),
    ...over,
  };
}

const INITIAL = 10_000_000;

describe("assertOdometerProgression (INV-2)", () => {
  const existing = [
    e({ id: "a", entryDate: "2026-01-05", odometerMiE3: 10_100_000 }),
    e({ id: "b", entryDate: "2026-01-15", odometerMiE3: 10_300_000 }),
  ];

  it("accepts an appended entry that keeps the sequence non-decreasing", () => {
    expect(() =>
      assertOdometerProgression(
        existing,
        INITIAL,
        {
          id: "c",
          entryDate: "2026-01-25",
          createdAt: new Date("2026-01-25T00:00:00Z"),
          odometerMiE3: 10_400_000,
        },
        "create",
      ),
    ).not.toThrow();
  });

  it("rejects an appended entry that decreases against its predecessor", () => {
    try {
      assertOdometerProgression(
        existing,
        INITIAL,
        {
          id: "c",
          entryDate: "2026-01-25",
          createdAt: new Date("2026-01-25T00:00:00Z"),
          odometerMiE3: 10_200_000,
        },
        "create",
      );
      throw new Error("expected a throw");
    } catch (err) {
      expect(err).toBeInstanceOf(AppError);
      expect((err as AppError).code).toBe("odometer_decrease");
    }
  });

  it("allows an exact tie", () => {
    expect(() =>
      assertOdometerProgression(
        existing,
        INITIAL,
        {
          id: "c",
          entryDate: "2026-01-25",
          createdAt: new Date("2026-01-25T00:00:00Z"),
          odometerMiE3: 10_300_000,
        },
        "create",
      ),
    ).not.toThrow();
  });

  it("rejects a first entry below the vehicle's starting odometer", () => {
    expect(() =>
      assertOdometerProgression(
        [],
        INITIAL,
        {
          id: "c",
          entryDate: "2026-01-02",
          createdAt: new Date("2026-01-02T00:00:00Z"),
          odometerMiE3: 9_999_000,
        },
        "create",
      ),
    ).toThrow();
  });

  it("rejects a back-dated entry that lands mid-sequence and decreases", () => {
    expect(() =>
      assertOdometerProgression(
        existing,
        INITIAL,
        {
          id: "c",
          entryDate: "2026-01-10", // between a and b
          createdAt: new Date("2026-01-30T00:00:00Z"),
          odometerMiE3: 10_050_000, // < a
        },
        "create",
      ),
    ).toThrow();
  });

  it("on update, an entry replaces its old self — a fix that restores order passes", () => {
    const broken = [
      e({ id: "a", entryDate: "2026-01-05", odometerMiE3: 10_100_000 }),
      e({ id: "b", entryDate: "2026-01-15", odometerMiE3: 10_050_000 }), // currently decreasing
    ];
    expect(() =>
      assertOdometerProgression(
        broken,
        INITIAL,
        {
          id: "b",
          entryDate: "2026-01-15",
          createdAt: broken[1]!.createdAt,
          odometerMiE3: 10_200_000, // corrected upward
        },
        "update",
      ),
    ).not.toThrow();
  });

  it("flags the seeded odometer-decrease fixture as violating INV-2", () => {
    // Feeding the fixture's own last entry back as an unchanged 'update'
    // still trips the check, because the rest of the stored sequence is bad.
    const entries = [...odometerDecrease.entries];
    const last = entries[entries.length - 1]!;
    expect(() =>
      assertOdometerProgression(
        entries,
        odometerDecrease.vehicle.initialOdometerMiE3,
        {
          id: last.id,
          entryDate: last.entryDate,
          createdAt: last.createdAt,
          odometerMiE3: last.odometerMiE3,
        },
        "update",
      ),
    ).toThrow();
  });
});
