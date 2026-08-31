import { defineConfig } from "drizzle-kit";

/** SQLite migrations (development and test only). */
export default defineConfig({
  dialect: "sqlite",
  schema: "./src/db/schema/sqlite.ts",
  out: "./src/db/migrations/sqlite",
  strict: true,
  verbose: true,
});
