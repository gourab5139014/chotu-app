import { defineConfig } from "drizzle-kit";

/** PostgreSQL migrations. `generate` and `check` need no live connection. */
export default defineConfig({
  dialect: "postgresql",
  schema: "./src/db/schema/pg.ts",
  out: "./src/db/migrations/postgres",
  strict: true,
  verbose: true,
});
