import { describe, expect, it } from "vitest";

import { EnvError, parseEnv } from "../src/env";

const base = {
  DATABASE_URL: "file:./chotu.db",
  SESSION_SIGNING_KEY: "a-sufficiently-long-signing-key",
};

describe("parseEnv", () => {
  it("accepts a minimal valid environment and applies defaults", () => {
    const env = parseEnv(base);
    expect(env.CHOTU_ENV).toBe("development");
    expect(env.PORT).toBe(8787);
    expect(env.CORS_ALLOWED_ORIGINS).toEqual([]);
    expect(env.TRUSTED_PROXY).toBe(false);
  });

  it("rejects a missing SESSION_SIGNING_KEY", () => {
    expect(() => parseEnv({ DATABASE_URL: "file:./x.db" })).toThrow(EnvError);
  });

  it("rejects a too-short SESSION_SIGNING_KEY", () => {
    expect(() => parseEnv({ ...base, SESSION_SIGNING_KEY: "short" })).toThrow(EnvError);
  });

  it("parses a CORS list and a coerced port", () => {
    const env = parseEnv({
      ...base,
      PORT: "3000",
      CORS_ALLOWED_ORIGINS: "http://localhost:5173, https://app.example",
    });
    expect(env.PORT).toBe(3000);
    expect(env.CORS_ALLOWED_ORIGINS).toEqual([
      "http://localhost:5173",
      "https://app.example",
    ]);
  });
});
