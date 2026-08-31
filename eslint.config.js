import js from "@eslint/js";
import globals from "globals";
import tseslint from "typescript-eslint";

import local from "./eslint-rules/index.js";

export default tseslint.config(
  {
    ignores: [
      "**/dist/**",
      "**/node_modules/**",
      "**/*.d.ts",
      "packages/*/src/db/migrations/**",
    ],
  },
  js.configs.recommended,
  {
    files: ["**/*.ts"],
    extends: [...tseslint.configs.recommendedTypeChecked],
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
      globals: { ...globals.node },
    },
    plugins: { local },
    rules: {
      "no-console": "error",
      "local/no-unscoped-entity-query": "error",
      "@typescript-eslint/consistent-type-imports": "error",
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
    },
  },
  {
    // The process entry and the CLI print to stdout before the logger exists.
    files: ["packages/api/src/index.ts", "packages/api/src/bin/**/*.ts"],
    rules: { "no-console": "off" },
  },
  {
    // Config and local-rule files are plain JS, outside any tsconfig.
    files: ["**/*.js"],
    languageOptions: { globals: { ...globals.node } },
  },
);
