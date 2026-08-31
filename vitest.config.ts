import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    projects: ["packages/*"],
    onConsoleLog: (line) => !line.startsWith('{"ts":"'),
  },
});
