import { parseArgs } from "node:util";

import {
  AlreadySeededError,
  bootstrapDeployment,
  type AdminSpec,
} from "../db/bootstrap";
import { makeDb } from "../db/index";

/**
 * `chotu` CLI. `bootstrap` creates the schema and the first admin. `token
 * issue` / `token revoke` land in T3.5.
 */
async function run(argv: string[]): Promise<number> {
  const { positionals, values } = parseArgs({
    args: argv,
    allowPositionals: true,
    strict: false,
    options: {
      "admin-email": { type: "string" },
      "admin-password": { type: "string" },
      "deployment-name": { type: "string" },
    },
  });

  if (positionals[0] !== "bootstrap") {
    console.error(`Unknown command: ${positionals[0] ?? "(none)"}. Commands: bootstrap`);
    return 2;
  }

  const url =
    process.env["DATABASE_BOOTSTRAP_URL"] ?? process.env["DATABASE_URL"];
  if (url == null || url === "") {
    console.error("Set DATABASE_BOOTSTRAP_URL (or DATABASE_URL) first.");
    return 2;
  }

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

    console.log("bootstrap complete.");
    console.log(`  admin:     ${result.adminEmail}`);
    console.log(`  API token: ${result.apiToken}   (shown once)`);
    if (result.setPasswordToken != null) {
      const base = process.env["CHOTU_BASE_URL"] ?? "http://localhost:8787";
      console.log(
        `  set password: ${base}/auth/set-password?token=${result.setPasswordToken}`,
      );
    }
    for (const w of result.warnings) {
      console.warn(`  WARNING: ${w}`);
    }
    return 0;
  } catch (err) {
    if (err instanceof AlreadySeededError) {
      console.error(err.message);
      return 3;
    }
    throw err;
  } finally {
    await handle.close();
  }
}

run(process.argv.slice(2))
  .then((code) => {
    process.exitCode = code;
  })
  .catch((err: unknown) => {
    console.error(err instanceof Error ? err.message : String(err));
    process.exitCode = 1;
  });
