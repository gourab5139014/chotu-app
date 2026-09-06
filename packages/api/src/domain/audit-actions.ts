/**
 * Every audit action code Chotu writes. `NewAuditLog.action` is typed to this
 * union, so a new audited action must be added here — and the audit matrix
 * test (AC-9) then requires coverage for it.
 */
export const AUDIT_ACTIONS = [
  "user.created",
  "user.registered",
  "user.deactivated",
  "user.reactivated",
  "user.reset_triggered",
  "user.deleted",
  "user.self_deleted",
  "user.auto_provisioned",
  "role.granted",
  "role.revoked",
  "settings.updated",
  "invitation.created",
  "invitation.accepted",
  "oidc_provider.created",
  "oidc_provider.updated",
  "oidc_provider.deleted",
  "oidc.signed_in",
  "identity.linked",
  "identity.unlinked",
] as const;

export type AuditAction = (typeof AUDIT_ACTIONS)[number];
