import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { parse, stringify } from "yaml";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { buildOpenApiDocument } from "../../src/contract/build";
import { makeTestApp, type TestApp } from "../support/app";

const committedPath = fileURLToPath(
  new URL("../../../../openapi.yaml", import.meta.url),
);

describe("OpenAPI contract", () => {
  it("is a well-formed 3.1 document covering the auth surface", () => {
    const doc = buildOpenApiDocument() as {
      openapi: string;
      paths: Record<string, unknown>;
      components: { schemas: Record<string, unknown> };
    };
    expect(doc.openapi).toBe("3.1.0");
    for (const p of [
      "/healthz",
      "/auth/sign-in",
      "/auth/sign-out",
      "/auth/change-password",
      "/auth/me",
      "/tokens",
      "/tokens/{id}",
      "/openapi.yaml",
    ]) {
      expect(Object.keys(doc.paths)).toContain(p);
    }
    expect(Object.keys(doc.components.schemas)).toEqual(
      expect.arrayContaining(["Error", "PublicUser", "ApiToken"]),
    );
  });

  it("serialisation is deterministic", () => {
    expect(stringify(buildOpenApiDocument())).toBe(
      stringify(buildOpenApiDocument()),
    );
  });

  it("matches the committed openapi.yaml (codegen-clean gate)", () => {
    const committed = readFileSync(committedPath, "utf8");
    const regenerated = stringify(buildOpenApiDocument());
    expect(parse(committed)).toEqual(parse(regenerated));
  });
});

describe("GET /openapi.yaml", () => {
  let t: TestApp;
  beforeEach(() => {
    t = makeTestApp();
  });
  afterEach(() => t.cleanup());

  it("is served unauthenticated as YAML", async () => {
    const res = await t.app.request("/openapi.yaml");
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("yaml");
    const doc = parse(await res.text()) as { openapi: string };
    expect(doc.openapi).toBe("3.1.0");
  });

  it("GET /healthz returns the schema version", async () => {
    const res = await t.app.request("/healthz");
    expect(await res.json()).toEqual({ status: "ok", schemaVersion: 1 });
  });
});
