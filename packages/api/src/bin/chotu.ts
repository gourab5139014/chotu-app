import { parseArgs } from "node:util";

import { bootstrapSchema } from "../db/bootstrap";
import { makeDb } from "../db/index";

/**
 * `chotu` CLI. `bootstrap` is the only command for now; `token issue` /
 * `token revoke` land in T3.5, and seeding (settings + first admin) in T3.3.
 */
async function run(argv: string[]): Promise<number> {
  const { positionals } = parseArgs({
    args: argv,
    allowPositionals: true,
    strict: false,
  });
  const command = positionals[0];

  if (command === "bootstrap") {
    const url =
      process.env["DATABASE_BOOTSTRAP_URL"] ?? process.env["DATABASE_URL"];
    if (url == null || url === "") {
      console.error("Set DATABASE_BOOTSTRAP_URL (or DATABASE_URL) first.");
      return 2;
    }
    const handle = makeDb(url);
    try {
      await bootstrapSchema(handle, {
        build: process.env["CHOTU_BUILD"] ?? "dev",
      });
      console.log("bootstrap: schema migrated, schema_meta recorded");
      return 0;
    } finally {
      await handle.close();
    }
  }

  console.error(
    `Unknown command: ${command ?? "(none)"}. Commands: bootstrap`,
  );
  return 2;
}

run(process.argv.slice(2))
  .then((code) => {
    process.exitCode = code;
  })
  .catch((err: unknown) => {
    console.error(err instanceof Error ? err.message : String(err));
    process.exitCode = 1;
  });
