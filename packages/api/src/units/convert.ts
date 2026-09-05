/**
 * Pure unit conversion. Only canonical integers cross the persistence
 * boundary (D-1): `odometer_mi_e3`, `volume_gal_e3`, `total_cost_usd_cents`.
 * Rounding is half away from zero at every step (plan.md section 5).
 */

export type UnitSystem = "imperial" | "metric";
export type Quantity = "distance" | "volume" | "money";

/** 1 mile = 1.609344 km, exactly (the international mile definition). */
const KM_PER_MILE = 1.609344;
/** 1 US gallon = 3.785411784 L, exactly. */
const LITERS_PER_US_GALLON = 3.785411784;

const SCALE: Record<Quantity, number> = {
  distance: 1000, // mi -> mi_e3
  volume: 1000, // US gal -> gal_e3
  money: 100, // USD -> cents
};

// A tiny nudge in the rounding direction absorbs IEEE754 representation error
// at an exact halfway point (e.g. 1.005 * 100 can render as
// 100.49999999999999) without changing the result anywhere else.
const EPS = 1e-9;

/** Round half away from zero (ties round away from 0, not toward +Infinity). */
export function roundHalfAwayFromZero(x: number): number {
  return x >= 0 ? Math.floor(x + 0.5 + EPS) : Math.ceil(x - 0.5 - EPS);
}

/**
 * Convert `value`, given in the caller's unit system, to the canonical
 * integer for `quantity`. Money has no unit-system conversion (FR-15.5).
 */
export function toCanonical(
  value: number,
  unitSystem: UnitSystem,
  quantity: Quantity,
): number {
  let base = value; // miles, US gallons, or USD
  if (unitSystem === "metric") {
    if (quantity === "distance") base = value / KM_PER_MILE;
    else if (quantity === "volume") base = value / LITERS_PER_US_GALLON;
  }
  return roundHalfAwayFromZero(base * SCALE[quantity]);
}

/** Convert a canonical integer back to a real number in the caller's unit system. */
export function fromCanonical(
  canonical: number,
  unitSystem: UnitSystem,
  quantity: Quantity,
): number {
  const base = canonical / SCALE[quantity]; // miles, US gallons, or USD
  if (unitSystem === "metric") {
    if (quantity === "distance") return base * KM_PER_MILE;
    if (quantity === "volume") return base * LITERS_PER_US_GALLON;
  }
  return base;
}
