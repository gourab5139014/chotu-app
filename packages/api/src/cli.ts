import { parseArgs } from "node:util";

import { issueApiToken, revokeApiToken } from "./auth/api-tokens";
import {
  AlreadySeededError,
  bootstrapDeployment,
  type AdminSpec,
} from "./db/bootstrap";
import { makeDb } from "./db/index";

export interface Io {
  out(line: string): void;
  err(line: string): void;
}

const consoleIo: Io = {
  out: (l) => {
    console.log(l);
  },
  err: (l) => {
    console.error(l);
  },
};

function dbUrl(): string | null {
  const url =
    process.env["DATABASE_BOOTSTRAP_URL"] ?? process.env["DATABASE_URL"];
  return url != null && url !== "" ? url : null;
}

/**
 * `chotu` CLI. Returns a process exit code.
 *   chotu bootstrap [--admin-email E --admin-password P] [--deployment-name N]
 *   chotu token issue --user EMAIL [--label L]
 *   chotu token revoke --token cht_...
 */
export async function run(argv: string[], io: Io = consoleIo): Promise<number> {
  const { positionals, values } = parseArgs({
    args: argv,
    allowPositionals: true,
    strict: false,
    options: {
      "admin-email": { type: "string" },
      "admin-password": { type: "string" },
      "deployment-name": { type: "string" },
      user: { type: "string" },
      label: { type: "string" },
      token: { type: "string" },
    },
  });

  const url = dbUrl();
  if (url == null) {
    io.err("Set DATABASE_BOOTSTRAP_URL (or DATABASE_URL) first.");
    return 2;
  }

  if (positionals[0] === "bootstrap") {
    return bootstrap(url, values, io);
  }
  if (positionals[0] === "token" && positionals[1] === "issue") {
    return tokenIssue(url, values, io);
  }
  if (positionals[0] === "token" && positionals[1] === "revoke") {
    return tokenRevoke(url, values, io);
  }

  io.err(
    `Unknown command: ${[positionals[0], positionals[1]].filter(Boolean).join(" ") || "(none)"}. ` +
      "Commands: bootstrap | token issue | token revoke",
  );
  return 2;
}

async function bootstrap(
  url: string,
  values: Record<string, unknown>,
  io: Io,
): Promise<number> {
  const email = values["admin-email"];
  const password = values["admin-password"];
  let admin: AdminSpec;
  if (typeof email === "string" && typeof password === "string") {
    admin = { email, password };
  } else if (typeof email === "string") {
    admin = { email };
  } else {
    admin = { seedDefault: true };
  }

  const handle = makeDb(url);
  try {
    const result = await bootstrapDeployment(handle, {
      build: process.env["CHOTU_BUILD"] ?? "dev",
      admin,
      ...(typeof values["deployment-name"] === "string"
        ? { settings: { deploymentName: values["deployment-name"] } }
        : {}),
    });
    io.out("bootstrap complete.");
    io.out(`  admin:     ${result.adminEmail}`);
    io.out(`  API token: ${result.apiToken}   (shown once)`);
    if (result.setPasswordToken != null) {
      const base = process.env["CHOTU_BASE_URL"] ?? "http://localhost:8787";
      io.out(
        `  set password: ${base}/auth/set-password?token=${result.setPasswordToken}`,
      );
    }
    for (const w of result.warnings) io.err(`  WARNING: ${w}`);
    return 0;
  } catch (err) {
    if (err instanceof AlreadySeededError) {
      io.err(err.message);
      return 3;
    }
    throw err;
  } finally {
    await handle.close();
  }
}

async function tokenIssue(
  url: string,
  values: Record<string, unknown>,
  io: Io,
): Promise<number> {
  const user = values["user"];
  if (typeof user !== "string") {
    io.err("token issue: --user EMAIL is required.");
    return 2;
  }
  const handle = makeDb(url);
  try {
    const { token } = await issueApiToken(handle, {
      userEmail: user,
      ...(typeof values["label"] === "string"
        ? { label: values["label"] }
        : {}),
    });
    io.out(`${token}   (shown once)`);
    return 0;
  } finally {
    await handle.close();
  }
}

async function tokenRevoke(
  url: string,
  values: Record<string, unknown>,
  io: Io,
): Promise<number> {
  const token = values["token"];
  if (typeof token !== "string") {
    io.err("token revoke: --token cht_... is required.");
    return 2;
  }
  const handle = makeDb(url);
  try {
    const { revoked } = await revokeApiToken(handle, { token });
    io.out(revoked ? "revoked." : "no matching active token.");
    return revoked ? 0 : 1;
  } finally {
    await handle.close();
  }
}
