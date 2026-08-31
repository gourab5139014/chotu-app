import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { run, type Io } from "../src/cli";

function capture(): Io & { lines: string[]; errs: string[] } {
  const lines: string[] = [];
  const errs: string[] = [];
  return {
    lines,
    errs,
    out: (l) => lines.push(l),
    err: (l) => errs.push(l),
  };
}

describe("chotu CLI (SQLite)", () => {
  let dir: string;
  let prevUrl: string | undefined;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "chotu-cli-"));
    prevUrl = process.env["DATABASE_URL"];
    process.env["DATABASE_URL"] = `file:${join(dir, "cli.db")}`;
    delete process.env["DATABASE_BOOTSTRAP_URL"];
  });

  afterEach(() => {
    if (prevUrl == null) delete process.env["DATABASE_URL"];
    else process.env["DATABASE_URL"] = prevUrl;
    rmSync(dir, { recursive: true, force: true });
  });

  it("bootstrap then token issue then token revoke", async () => {
    const b = capture();
    expect(await run(["bootstrap", "--admin-email", "op@x.com", "--admin-password", "hunter2hunter2"], b)).toBe(0);
    expect(b.lines.join("\n")).toMatch(/API token: cht_/);

    const iss = capture();
    expect(await run(["token", "issue", "--user", "op@x.com", "--label", "cli"], iss)).toBe(0);
    const token = iss.lines[0]?.split(/\s+/)[0] ?? "";
    expect(token.startsWith("cht_")).toBe(true);

    const rev = capture();
    expect(await run(["token", "revoke", "--token", token], rev)).toBe(0);
    expect(rev.lines.join("\n")).toMatch(/revoked/);

    // second revoke of the same token: nothing active
    const rev2 = capture();
    expect(await run(["token", "revoke", "--token", token], rev2)).toBe(1);
  });

  it("token issue for an unknown user errors", async () => {
    const b = capture();
    await run(["bootstrap"], b); // seedDefault
    const iss = capture();
    await expect(run(["token", "issue", "--user", "ghost@x.com"], iss)).rejects.toThrow(
      /No user with email/,
    );
  });

  it("unknown command returns 2", async () => {
    const io = capture();
    expect(await run(["wat"], io)).toBe(2);
    expect(io.errs.join("\n")).toMatch(/Unknown command/);
  });
});
