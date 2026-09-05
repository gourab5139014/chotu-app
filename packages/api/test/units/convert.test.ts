import { describe, expect, it } from "vitest";

import {
  fromCanonical,
  roundDistance,
  roundHalfAwayFromZero,
  toCanonical,
} from "../../src/units";

describe("roundHalfAwayFromZero", () => {
  it("rounds ties away from zero in both directions", () => {
    expect(roundHalfAwayFromZero(0.5)).toBe(1);
    expect(roundHalfAwayFromZero(-0.5)).toBe(-1);
    expect(roundHalfAwayFromZero(2.5)).toBe(3);
    expect(roundHalfAwayFromZero(-2.5)).toBe(-3);
  });

  it("survives IEEE754 representation error at the halfway point", () => {
    // 1.005 * 100 is 100.49999999999999 in IEEE754 double.
    expect(roundHalfAwayFromZero(1.005 * 100)).toBe(101);
  });
});

// A spread of non-round decimals, deliberately avoiding values that sit
// exactly on a rounding boundary (unrelated to the property under test).
const SAMPLE_DISTANCES_MI = [0, 0.001, 0.037, 0.5, 1, 12.345, 999.999, 54321.006];
const SAMPLE_VOLUMES_GAL = [0, 0.001, 0.037, 0.5, 1, 8.451, 20.999, 123.456];

describe("units: imperial round trip is exact (FR-15.4)", () => {
  it("distance: create then read returns the exact input", () => {
    for (const mi of SAMPLE_DISTANCES_MI) {
      const canonical = toCanonical(mi, "imperial", "distance");
      expect(canonical).toBe(Math.round(mi * 1000));
      expect(fromCanonical(canonical, "imperial", "distance")).toBe(mi);
    }
  });

  it("volume: create then read returns the exact input", () => {
    for (const gal of SAMPLE_VOLUMES_GAL) {
      const canonical = toCanonical(gal, "imperial", "volume");
      expect(canonical).toBe(Math.round(gal * 1000));
      expect(fromCanonical(canonical, "imperial", "volume")).toBe(gal);
    }
  });

  it("a US user's values need no conversion at all", () => {
    // 100.000 mi and 12.000 gal store as exactly 100000 / 12000.
    expect(toCanonical(100, "imperial", "distance")).toBe(100_000);
    expect(toCanonical(12, "imperial", "volume")).toBe(12_000);
  });
});

describe("units: metric round trip is stable at display precision (FR-15.4)", () => {
  // The canonical mi_e3 storage quantum (~0.0008 km max rounding error) is far
  // below the fixed 1-decimal-km display (100 m), so a metric user editing an
  // odometer sees no visible drift — distance gets the strongest guarantee.
  const MAX_DISTANCE_DRIFT_KM = 0.001;

  it("distance: round trip drift stays within the storage quantum", () => {
    for (let km = 0; km <= 2000; km += 0.37) {
      const canonical = toCanonical(km, "metric", "distance");
      const back = fromCanonical(canonical, "metric", "distance");
      expect(Math.abs(back - km)).toBeLessThan(MAX_DISTANCE_DRIFT_KM);
    }
  });

  it("a concrete example: 100.0 km displays as 100.0 km after a round trip", () => {
    const canonical = toCanonical(100, "metric", "distance");
    const back = fromCanonical(canonical, "metric", "distance");
    expect(roundDistance(back)).toBe(100);
  });

  // Volume's gal_e3 storage quantum (~0.0019 L max rounding error) is close to
  // the finest configured fuel_volume_precision (3 decimal L = 0.001 L
  // granularity), so — unlike distance — a metric round trip is not always
  // visually exact at 3 digits. The drift stays comfortably inside one
  // storage quantum regardless of precision, which is the property this
  // canonical-integer design (D-1) actually guarantees.
  const MAX_VOLUME_DRIFT_L = 0.002;

  it("volume: round trip drift stays within the storage quantum", () => {
    for (let l = 0; l <= 200; l += 0.53) {
      const canonical = toCanonical(l, "metric", "volume");
      const back = fromCanonical(canonical, "metric", "volume");
      expect(Math.abs(back - l)).toBeLessThan(MAX_VOLUME_DRIFT_L);
    }
  });
});
