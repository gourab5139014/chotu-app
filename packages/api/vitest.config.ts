import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    name: "api",
    include: ["test/**/*.test.ts", "src/**/*.test.ts"],
    environment: "node",
    // The app emits one JSON log line per request. Keep it out of test output;
    // tests that assert on it spy on console directly.
    onConsoleLog: (line) => !/^\{"ts":"/.test(line),
  },
});
