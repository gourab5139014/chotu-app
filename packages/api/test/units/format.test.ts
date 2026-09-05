import { describe, expect, it } from "vitest";

import { formatPrice, roundDistance, roundVolume } from "../../src/units";

describe("roundVolume", () => {
  it("rounds to the given precision, half away from zero", () => {
    expect(roundVolume(12.3456, 3)).toBe(12.346);
    expect(roundVolume(12.3456, 2)).toBe(12.35);
    expect(roundVolume(12.3456, 1)).toBe(12.3);
    expect(roundVolume(1.005, 2)).toBe(1.01);
  });
});

describe("roundDistance", () => {
  it("always rounds to 1 decimal", () => {
    expect(roundDistance(12.34)).toBe(12.3);
    expect(roundDistance(12.35)).toBe(12.4);
    expect(roundDistance(0.049)).toBe(0);
  });
});

describe("formatPrice", () => {
  it("formats USD cents as dollars.cents, always 2 decimals", () => {
    expect(formatPrice(0)).toBe("0.00");
    expect(formatPrice(5)).toBe("0.05");
    expect(formatPrice(150)).toBe("1.50");
    expect(formatPrice(123456)).toBe("1234.56");
  });

  it("formats a negative amount with a leading minus", () => {
    expect(formatPrice(-150)).toBe("-1.50");
  });
});
