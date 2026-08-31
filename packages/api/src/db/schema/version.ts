/**
 * Schema version this build understands. Written to `schema_meta` by bootstrap
 * and validated on startup (FR-1.3). Bump `CURRENT_SCHEMA_VERSION` and widen
 * `SUPPORTED_SCHEMA_RANGE` only when a migration changes a contract the running
 * code depends on.
 */
export const CURRENT_SCHEMA_VERSION = 1;

export const SUPPORTED_SCHEMA_RANGE = { min: 1, max: 1 } as const;

export function isSchemaSupported(version: number): boolean {
  return (
    Number.isInteger(version) &&
    version >= SUPPORTED_SCHEMA_RANGE.min &&
    version <= SUPPORTED_SCHEMA_RANGE.max
  );
}
