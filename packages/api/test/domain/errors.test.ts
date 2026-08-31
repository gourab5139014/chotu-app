import { describe, expect, it } from "vitest";

import {
  AppError,
  ERROR_STATUS,
  err,
  type ErrorCode,
} from "../../src/domain/errors";

const ALL_CODES: ErrorCode[] = [
  "validation_error",
  "unauthorized",
  "forbidden",
  "password_change_required",
  "not_found",
  "email_taken",
  "invitation_consumed",
  "conflict",
  "odometer_decrease",
  "last_admin",
  "auth_method_required",
  "rate_limited",
  "internal_error",
];

describe("error model", () => {
  it("every code has a 4xx/5xx status", () => {
    for (const code of ALL_CODES) {
      const status = ERROR_STATUS[code];
      expect(status).toBeGreaterThanOrEqual(400);
      expect(status).toBeLessThan(600);
    }
    expect(Object.keys(ERROR_STATUS).sort()).toEqual([...ALL_CODES].sort());
  });

  it("AppError.status and toBody reflect the code", () => {
    const e = new AppError("not_found", "nope");
    expect(e.status).toBe(404);
    expect(e.toBody()).toEqual({ code: "not_found", message: "nope" });

    const withDetails = err.validation("bad", { field: "email" });
    expect(withDetails.status).toBe(400);
    expect(withDetails.toBody()).toEqual({
      code: "validation_error",
      message: "bad",
      details: { field: "email" },
    });
  });

  it("constructors produce the expected codes and statuses", () => {
    expect(err.unauthorized().status).toBe(401);
    expect(err.forbidden().status).toBe(403);
    expect(err.passwordChangeRequired().code).toBe("password_change_required");
    expect(err.emailTaken().status).toBe(409);
    expect(err.odometerDecrease().status).toBe(422);
    expect(err.lastAdmin().status).toBe(422);
    expect(err.authMethodRequired().status).toBe(422);
    expect(err.rateLimited().status).toBe(429);
  });
});
