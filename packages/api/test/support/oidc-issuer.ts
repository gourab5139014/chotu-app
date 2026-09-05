import { createHash, randomBytes } from "node:crypto";
import type { AddressInfo } from "node:net";

import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { SignJWT, exportJWK, generateKeyPair } from "jose";

import { newId } from "../../src/domain/id";

/**
 * A mock OIDC Authorization Server for T7.5. Runs a real HTTP server on
 * 127.0.0.1 so `openid-client` v6 does genuine discovery, PKCE, and ID-token
 * signature validation against it end to end — nothing is stubbed inside the
 * RP code under test.
 *
 * `/authorize` skips real user interaction: it immediately redirects with a
 * code for whatever identity the test configured via `setNextIdentity`.
 */

export interface MockIdentity {
  sub: string;
  email?: string;
  groups?: string[];
}

export interface MockOidcIssuer {
  readonly issuerUrl: string;
  readonly clientId: string;
  readonly clientSecret: string;
  setNextIdentity(identity: MockIdentity): void;
  close(): Promise<void>;
}

interface PendingAuth {
  codeChallenge: string;
  codeChallengeMethod: string;
  nonce: string | undefined;
  identity: MockIdentity;
}

const KID = "mock-key-1";

export interface OidcFixture {
  readonly issuer: MockOidcIssuer;
  readonly providerKey: string;
  close(): Promise<void>;
}

/**
 * Start a mock issuer and register it as a Chotu OIDC provider on `t`. The
 * client secret is delivered through a process-env var, matching the
 * `env:NAME` reference format `auth/oidc.ts` resolves at runtime (D-5, R-3).
 */
export async function setupOidcFixture(
  repos: {
    oidcProviders: {
      create(p: {
        id: string;
        key: string;
        displayName: string;
        issuerUrl: string;
        clientId: string;
        clientSecretRef: string;
        scopes: string[];
        allowedEmailDomains: string[] | null;
        allowedGroups: string[] | null;
        autoProvision: boolean;
        enabled: boolean;
      }): Promise<unknown>;
    };
  },
  opts: {
    key?: string;
    allowedEmailDomains?: string[] | null;
    allowedGroups?: string[] | null;
    autoProvision?: boolean;
  } = {},
): Promise<OidcFixture> {
  const key = opts.key ?? "mock";
  const envVar = `TEST_OIDC_SECRET_${key.replace(/-/g, "_").toUpperCase()}`;
  const issuer = await startMockOidcIssuer();
  process.env[envVar] = issuer.clientSecret;

  await repos.oidcProviders.create({
    id: newId(),
    key,
    displayName: "Mock IdP",
    issuerUrl: issuer.issuerUrl,
    clientId: issuer.clientId,
    clientSecretRef: `env:${envVar}`,
    scopes: ["openid", "email", "profile"],
    allowedEmailDomains: opts.allowedEmailDomains ?? null,
    allowedGroups: opts.allowedGroups ?? null,
    autoProvision: opts.autoProvision ?? true,
    enabled: true,
  });

  return {
    issuer,
    providerKey: key,
    async close() {
      delete process.env[envVar];
      await issuer.close();
    },
  };
}

export async function startMockOidcIssuer(
  opts: { clientId?: string; clientSecret?: string } = {},
): Promise<MockOidcIssuer> {
  const clientId = opts.clientId ?? "test-client";
  const clientSecret = opts.clientSecret ?? "test-secret";

  const { publicKey, privateKey } = await generateKeyPair("RS256");
  const jwk = await exportJWK(publicKey);

  let nextIdentity: MockIdentity = {
    sub: "default-subject",
    email: "default@example.com",
  };
  const pending = new Map<string, PendingAuth>();

  let issuerUrl = "";
  const app = new Hono();

  app.get("/.well-known/openid-configuration", (c) =>
    c.json({
      issuer: issuerUrl,
      authorization_endpoint: `${issuerUrl}/authorize`,
      token_endpoint: `${issuerUrl}/token`,
      jwks_uri: `${issuerUrl}/jwks`,
      response_types_supported: ["code"],
      subject_types_supported: ["public"],
      id_token_signing_alg_values_supported: ["RS256"],
      scopes_supported: ["openid", "email", "profile"],
      token_endpoint_auth_methods_supported: ["client_secret_post"],
      code_challenge_methods_supported: ["S256"],
    }),
  );

  app.get("/jwks", (c) =>
    c.json({ keys: [{ ...jwk, kid: KID, use: "sig", alg: "RS256" }] }),
  );

  app.get("/authorize", (c) => {
    const q = c.req.query();
    const code = randomBytes(16).toString("hex");
    pending.set(code, {
      codeChallenge: q["code_challenge"] ?? "",
      codeChallengeMethod: q["code_challenge_method"] ?? "S256",
      nonce: q["nonce"],
      identity: nextIdentity,
    });
    const redirectUri = q["redirect_uri"];
    if (redirectUri == null) return c.text("missing redirect_uri", 400);
    const url = new URL(redirectUri);
    url.searchParams.set("code", code);
    if (q["state"] != null) url.searchParams.set("state", q["state"]);
    return c.redirect(url.toString(), 302);
  });

  app.post("/token", async (c) => {
    const body = await c.req.parseBody();
    const asString = (v: unknown): string => (typeof v === "string" ? v : "");
    const code = asString(body["code"]);
    const codeVerifier = asString(body["code_verifier"]);
    const sentSecret = asString(body["client_secret"]);

    const auth = pending.get(code);
    if (auth == null || sentSecret !== clientSecret) {
      return c.json({ error: "invalid_grant" }, 400);
    }
    pending.delete(code);

    if (auth.codeChallengeMethod === "S256") {
      const expected = createHash("sha256")
        .update(codeVerifier)
        .digest("base64url");
      if (expected !== auth.codeChallenge) {
        return c.json({ error: "invalid_grant" }, 400);
      }
    }

    const now = Math.floor(Date.now() / 1000);
    const claims: Record<string, unknown> = {
      email: auth.identity.email,
      email_verified: auth.identity.email != null,
      groups: auth.identity.groups ?? [],
    };
    if (auth.nonce != null) claims["nonce"] = auth.nonce;

    const idToken = await new SignJWT(claims)
      .setProtectedHeader({ alg: "RS256", kid: KID })
      .setSubject(auth.identity.sub)
      .setIssuer(issuerUrl)
      .setAudience(clientId)
      .setIssuedAt(now)
      .setExpirationTime(now + 600)
      .sign(privateKey);

    return c.json({
      access_token: randomBytes(16).toString("hex"),
      token_type: "Bearer",
      expires_in: 600,
      id_token: idToken,
    });
  });

  const server = await new Promise<ReturnType<typeof serve>>((resolve) => {
    const s = serve(
      { fetch: app.fetch, port: 0, hostname: "127.0.0.1" },
      (info: AddressInfo) => {
        issuerUrl = `http://127.0.0.1:${info.port}`;
        resolve(s);
      },
    );
  });

  return {
    get issuerUrl() {
      return issuerUrl;
    },
    clientId,
    clientSecret,
    setNextIdentity(identity: MockIdentity) {
      nextIdentity = identity;
    },
    close() {
      return new Promise<void>((resolve, reject) => {
        server.close((err) => (err != null ? reject(err) : resolve()));
      });
    },
  };
}
