/**
 * The API error model. One body shape, a closed set of codes, a fixed
 * code -> HTTP status map. See specs/0001-m1-trusted-fuel-logging/spec.md
 * FR-13.6 and plan.md section 12.
 */

export type ErrorCode =
  | "validation_error"
  | "unauthorized"
  | "forbidden"
  | "password_change_required"
  | "not_found"
  | "email_taken"
  | "invitation_consumed"
  | "conflict"
  | "odometer_decrease"
  | "last_admin"
  | "auth_method_required"
  | "provider_in_use"
  | "rate_limited"
  | "internal_error";

export const ERROR_STATUS: Record<ErrorCode, number> = {
  validation_error: 400,
  unauthorized: 401,
  forbidden: 403,
  password_change_required: 403,
  not_found: 404,
  email_taken: 409,
  invitation_consumed: 409,
  conflict: 409,
  odometer_decrease: 422,
  last_admin: 422,
  auth_method_required: 422,
  provider_in_use: 409,
  rate_limited: 429,
  internal_error: 500,
};

export interface ErrorBody {
  code: ErrorCode;
  message: string;
  details?: unknown;
}

export class AppError extends Error {
  constructor(
    public readonly code: ErrorCode,
    message: string,
    public readonly details?: unknown,
  ) {
    super(message);
    this.name = "AppError";
  }

  get status(): number {
    return ERROR_STATUS[this.code];
  }

  toBody(): ErrorBody {
    return this.details === undefined
      ? { code: this.code, message: this.message }
      : { code: this.code, message: this.message, details: this.details };
  }
}

export const err = {
  validation: (message = "Invalid request", details?: unknown) =>
    new AppError("validation_error", message, details),
  unauthorized: (message = "Authentication required") =>
    new AppError("unauthorized", message),
  forbidden: (message = "Not allowed") => new AppError("forbidden", message),
  passwordChangeRequired: () =>
    new AppError(
      "password_change_required",
      "Change your password before using the API.",
    ),
  notFound: (message = "Not found") => new AppError("not_found", message),
  emailTaken: () =>
    new AppError("email_taken", "That email is already registered."),
  invitationConsumed: () =>
    new AppError(
      "invitation_consumed",
      "This invitation is expired, unknown, or already used.",
    ),
  conflict: (message: string) => new AppError("conflict", message),
  odometerDecrease: () =>
    new AppError(
      "odometer_decrease",
      "The odometer would go backwards relative to a neighbouring entry.",
    ),
  lastAdmin: () =>
    new AppError(
      "last_admin",
      "The deployment must keep at least one active admin.",
    ),
  authMethodRequired: (message = "At least one sign-in method must remain.") =>
    new AppError("auth_method_required", message),
  providerInUse: (
    message = "This provider has linked identities. Pass force to unlink them and delete it.",
  ) => new AppError("provider_in_use", message),
  rateLimited: (message = "Too many requests. Try again later.") =>
    new AppError("rate_limited", message),
};
