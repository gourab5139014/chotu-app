import { expect } from "vitest";

import { makeRepos } from "../../src/db/repositories";
import type { DbHandle } from "../../src/db/index";
import type { AuditLogRow } from "../../src/db/schema/types";

interface AuditExpectation {
  /** The `action` code the wrapped call must write. */
  action: string;
  /** How many audit rows the call must add. Default 1. */
  count?: number;
}

/**
 * Run `fn` and assert it appended exactly `count` (default 1) `audit_log`
 * rows, and that the newest row carries `action`. Returns `fn`'s result so a
 * test can keep asserting on it.
 *
 * Use it to pin the audit trail of an admin or security action (AC-9).
 */
export async function expectAuditDelta<T>(
  handle: DbHandle,
  expected: AuditExpectation,
  fn: () => T | Promise<T>,
): Promise<T> {
  const repos = makeRepos(handle);
  const before = await repos.audit.count();

  const result = await fn();

  const after = await repos.audit.count();
  const want = expected.count ?? 1;
  expect(
    after - before,
    `expected ${want} new audit row(s) for "${expected.action}", got ${
      after - before
    }`,
  ).toBe(want);

  const newest: AuditLogRow | undefined = (await repos.audit.list({ limit: 1 }))[0];
  expect(newest?.action).toBe(expected.action);

  return result;
}
