import { createHash } from "node:crypto";

import { Hono } from "hono";
import type { Context } from "hono";
import { setCookie } from "hono/cookie";
import * as client from "openid-client";

import { getOidcConfiguration } from "../auth/oidc";
import { createSession } from "../auth/session";
import { SESSION_COOKIE } from "../auth/tokens";
import {
  consumeOidcLoginInTx,
  insertIdentityInTx,
  insertUserInTx,
  touchIdentityInTx,
  writeAuditInTx,
} from "../db/repositories";
import { makeUnitOfWork, runTxSteps } from "../db/uow";
import { err } from "../domain/errors";
import { newId } from "../domain/id";
import type { AppDeps, AppHono } from "../http/context";
import { protect } from "../middleware/protect";
import type { IdentityRow, UserRow } from "../db/schema/types";

/** Short-lived: a few minutes is enough to complete a redirect round trip. */
const LOGIN_TTL_MS = 1000 * 60 * 10;
const DEFAULT_SESSION_TTL_SECONDS = 60 * 60 * 24 * 7;

function hashState(state: string): string {
  return createHash("sha256").update(state).digest("hex");
}

function publicUser(u: UserRow) {
  return {
    id: u.id,
    email: u.email,
    displayName: u.displayName,
    role: u.role,
    mustChangePassword: u.mustChangePassword,
  };
}

/** `true` when every non-null allow-list is satisfied; null means "any". */
function domainAllowed(allowed: string[] | null, email: string | undefined): boolean {
  if (allowed == null) return true;
  if (email == null) return false;
  const lower = email.toLowerCase();
  return allowed.some((d) => lower.endsWith(`@${d.toLowerCase()}`));
}
function groupsAllowed(allowed: string[] | null, groups: string[]): boolean {
  if (allowed == null) return true;
  return allowed.some((g) => groups.includes(g));
}

/**
 * OIDC Authorization Code + PKCE (FR-6.2, FR-6.4). `start` redirects to the
 * provider; `callback` completes the exchange, matches or creates an
 * `identity`, and either signs in or links, depending on how the flow was
 * started (T7.4).
 */
export function oidcRoutes(deps: AppDeps): Hono<AppHono> {
  const r = new Hono<AppHono>();
  const uow = makeUnitOfWork(deps.handle);
  const insecure = deps.env.CHOTU_ENV !== "production";

  async function start(
    c: Context<AppHono>,
    key: string,
    linkUserId: string | null,
  ) {
    const provider = await deps.repos.oidcProviders.findByKey(key);
    if (provider == null || !provider.enabled) {
      throw err.notFound("Provider not found");
    }

    const config = await getOidcConfiguration(provider, {
      allowInsecureRequests: insecure,
    });

    const codeVerifier = client.randomPKCECodeVerifier();
    const codeChallenge = await client.calculatePKCECodeChallenge(codeVerifier);
    const state = client.randomState();
    const nonce = client.randomNonce();
    const redirectUri = `${deps.env.CHOTU_BASE_URL}/auth/oidc/${key}/callback`;

    const authUrl = client.buildAuthorizationUrl(config, {
      redirect_uri: redirectUri,
      scope: provider.scopes.join(" "),
      code_challenge: codeChallenge,
      code_challenge_method: "S256",
      state,
      nonce,
    });

    const now = new Date();
    const redirectTo = c.req.query("redirect_to");
    await deps.repos.oidcLogins.create({
      id: newId(),
      providerKey: key,
      stateHash: hashState(state),
      codeVerifier,
      nonce,
      redirectTo: redirectTo ?? null,
      linkUserId,
      expiresAt: new Date(now.getTime() + LOGIN_TTL_MS),
    });

    return c.redirect(authUrl.toString(), 302);
  }

  // GET /auth/oidc/:key/start — begin a sign-in.
  r.get("/:key/start", (c) => start(c, c.req.param("key"), null));

  // GET /auth/oidc/:key/link/start — begin linking a new identity to the
  // caller's account (T7.4). Requires an existing session/token: the
  // /callback redirect carries no caller credential, so the user is captured
  // here.
  r.get("/:key/link/start", ...protect(deps), (c) => {
    const user = c.get("user")!;
    return start(c, c.req.param("key"), user.id);
  });

  // GET /auth/oidc/:key/callback
  r.get("/:key/callback", async (c) => {
    const key = c.req.param("key");
    const provider = await deps.repos.oidcProviders.findByKey(key);
    if (provider == null) throw err.notFound("Provider not found");

    const url = new URL(c.req.url);
    const state = url.searchParams.get("state");
    if (state == null) throw err.unauthorized("Missing state.");

    const login = await deps.repos.oidcLogins.findByStateHash(hashState(state));
    const now = new Date();
    if (
      login == null ||
      login.consumedAt != null ||
      login.expiresAt.getTime() <= now.getTime()
    ) {
      throw err.unauthorized("This sign-in attempt is invalid or expired.");
    }

    // Every path past this point consumes the login row exactly once, even on
    // failure, so a stale callback URL can never be replayed.
    const reject = async (e: ReturnType<typeof err.forbidden>) => {
      await runTxSteps(uow, {}, [(tx) => consumeOidcLoginInTx(tx, login.id, now)]);
      throw e;
    };

    if (!provider.enabled) return reject(err.forbidden("This provider is disabled."));

    const config = await getOidcConfiguration(provider, {
      allowInsecureRequests: insecure,
    });

    const checks: client.AuthorizationCodeGrantChecks = {
      pkceCodeVerifier: login.codeVerifier,
      // The state_hash lookup above IS the CSRF/state check (data-model,
      // plan section 8); openid-client does not hold the plaintext value.
      expectedState: client.skipStateCheck,
      idTokenExpected: true,
      ...(login.nonce != null ? { expectedNonce: login.nonce } : {}),
    };

    let tokens;
    try {
      tokens = await client.authorizationCodeGrant(config, url, checks);
    } catch {
      return reject(err.unauthorized("OIDC sign-in failed."));
    }

    const claims = tokens.claims();
    if (claims == null) return reject(err.unauthorized("No claims in ID token."));
    const sub = claims.sub;
    const email = typeof claims["email"] === "string" ? claims["email"] : undefined;
    const groups = Array.isArray(claims["groups"])
      ? claims["groups"].filter((g): g is string => typeof g === "string")
      : [];

    if (
      !domainAllowed(provider.allowedEmailDomains, email) ||
      !groupsAllowed(provider.allowedGroups, groups)
    ) {
      return reject(
        err.forbidden("This account is not allowed to sign in with this provider."),
      );
    }

    const existing = await deps.repos.identities.findByProviderSubject(key, sub);

    // ---- Link flow: the caller was already signed in at /link/start ----
    if (login.linkUserId != null) {
      if (existing != null && existing.userId !== login.linkUserId) {
        return reject(
          err.conflict("This external account is already linked to a different user."),
        );
      }

      if (existing != null) {
        await runTxSteps(uow, {}, [
          (tx) => touchIdentityInTx(tx, existing.id, now),
          (tx) => consumeOidcLoginInTx(tx, login.id, now),
        ]);
        return c.json({ linked: true, providerKey: key });
      }

      const linkUser = await deps.repos.users.findById(login.linkUserId);
      if (linkUser == null) return reject(err.notFound("User not found"));

      const newIdentity: IdentityRow = {
        id: newId(),
        userId: linkUser.id,
        providerKey: key,
        subject: sub,
        emailAtLink: email ?? null,
        createdAt: now,
        lastLoginAt: now,
      };
      await runTxSteps(uow, {}, [
        (tx) => insertIdentityInTx(tx, newIdentity),
        (tx) => consumeOidcLoginInTx(tx, login.id, now),
        (tx) =>
          writeAuditInTx(tx, {
            actorUserId: linkUser.id,
            ip: null,
            action: "identity.linked",
            targetType: "user",
            targetId: linkUser.id,
            summary: `Linked an OIDC identity from provider ${key}`,
            metadata: { providerKey: key },
          }),
      ]);
      return c.json({ linked: true, providerKey: key });
    }

    // ---- Plain sign-in: an identity already links to an account ----
    if (existing != null) {
      const user = await deps.repos.users.findById(existing.userId);
      if (user == null || user.status !== "active") {
        return reject(err.unauthorized("This account cannot sign in."));
      }

      await runTxSteps(uow, {}, [
        (tx) => touchIdentityInTx(tx, existing.id, now),
        (tx) => consumeOidcLoginInTx(tx, login.id, now),
        (tx) =>
          writeAuditInTx(tx, {
            actorUserId: user.id,
            ip: null,
            action: "oidc.signed_in",
            targetType: "user",
            targetId: user.id,
            summary: `Signed in via OIDC provider ${key}`,
            metadata: null,
          }),
      ]);

      const settings = await deps.repos.settings.get();
      const { token, row } = await createSession(
        deps.handle,
        user.id,
        settings?.sessionTtlSeconds ?? DEFAULT_SESSION_TTL_SECONDS,
      );
      setCookie(c, SESSION_COOKIE, token, {
        httpOnly: true,
        secure: deps.env.CHOTU_ENV === "production",
        sameSite: "Lax",
        path: "/",
        expires: row.expiresAt,
      });
      return c.json({
        user: publicUser(user),
        session: token,
        expiresAt: row.expiresAt.toISOString(),
      });
    }

    // ---- No existing identity: auto-provision, or refuse ----
    const settings = await deps.repos.settings.get();
    const canAutoProvision =
      provider.autoProvision && settings?.registrationPolicy === "sso_auto";
    if (!canAutoProvision) {
      return reject(
        err.unauthorized("No account is linked to this identity provider account."),
      );
    }
    if (email == null) {
      return reject(err.forbidden("An email claim is required to create an account."));
    }
    if ((await deps.repos.users.findByEmail(email)) != null) {
      return reject(err.emailTaken());
    }

    const newUser: UserRow = {
      id: newId(),
      email: email.toLowerCase(),
      // A first-party OIDC claim is trustworthy evidence of email control.
      emailVerifiedAt: now,
      displayName: email.split("@")[0] ?? "New User",
      role: "user",
      status: "active",
      passwordHash: null,
      mustChangePassword: false,
      unitSystem: settings.defaultUnitSystem,
      currencyCode: settings.defaultCurrencyCode,
      timeZone: settings.defaultTimeZone,
      createdAt: now,
      updatedAt: now,
      deactivatedAt: null,
    };
    const newIdentity: IdentityRow = {
      id: newId(),
      userId: newUser.id,
      providerKey: key,
      subject: sub,
      emailAtLink: email,
      createdAt: now,
      lastLoginAt: now,
    };

    await runTxSteps(uow, {}, [
      (tx) => insertUserInTx(tx, newUser),
      (tx) => insertIdentityInTx(tx, newIdentity),
      (tx) => consumeOidcLoginInTx(tx, login.id, now),
      (tx) =>
        writeAuditInTx(tx, {
          actorUserId: null,
          ip: null,
          action: "user.auto_provisioned",
          targetType: "user",
          targetId: newUser.id,
          summary: `Auto-provisioned a user via OIDC provider ${key}`,
          metadata: { providerKey: key },
        }),
    ]);

    const { token, row } = await createSession(
      deps.handle,
      newUser.id,
      settings.sessionTtlSeconds,
    );
    setCookie(c, SESSION_COOKIE, token, {
      httpOnly: true,
      secure: deps.env.CHOTU_ENV === "production",
      sameSite: "Lax",
      path: "/",
      expires: row.expiresAt,
    });
    return c.json(
      {
        user: publicUser(newUser),
        session: token,
        expiresAt: row.expiresAt.toISOString(),
      },
      201,
    );
  });

  return r;
}
