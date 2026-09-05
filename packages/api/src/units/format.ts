import { roundHalfAwayFromZero } from "./convert";

/**
 * Display formatting. Storage always stays the exact canonical integer
 * (D-1); these only bound the digits the API accepts and shows (FR-15.6).
 */

/** Round a display volume (gallons or liters) to `precision` fractional digits (1..3). */
export function roundVolume(value: number, precision: number): number {
  const factor = 10 ** precision;
  return roundHalfAwayFromZero(value * factor) / factor;
}

/** Fixed 1 decimal place — mi for imperial, km for metric (plan.md section 5). */
export function roundDistance(value: number): number {
  return roundHalfAwayFromZero(value * 10) / 10;
}

/** USD cents -> a "1234.56" string, always 2 decimals. The only M1 currency (FR-15.5). */
export function formatPrice(cents: number): string {
  const sign = cents < 0 ? "-" : "";
  const abs = Math.round(Math.abs(cents));
  const dollars = Math.trunc(abs / 100);
  const remainder = abs % 100;
  return `${sign}${dollars}.${String(remainder).padStart(2, "0")}`;
}
