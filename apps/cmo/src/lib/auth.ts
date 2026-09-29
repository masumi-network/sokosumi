import { getUsersById } from "@sokosumi/core-client";
import { createClient } from "@sokosumi/core-client/client";
import { OAUTH_PROVIDER_SCOPES } from "@sokosumi/utils";
import { APIError, createAuthMiddleware } from "better-auth/api";
import {
  applySetCookies,
  getAccountCookie,
  getCookies,
  parseCookies,
} from "better-auth/cookies";
import { betterAuth } from "better-auth/minimal";
import { nextCookies } from "better-auth/next-js";
import { decryptOAuthToken } from "better-auth/oauth2";
import { genericOAuth } from "better-auth/plugins/generic-oauth";
import { oAuthProxy } from "better-auth/plugins/oauth-proxy";

import { readCmoAuthConfig } from "./auth-config";
import { SOKOSUMI_OAUTH_PROVIDER_ID } from "./sokosumi-oauth";

export interface CmoAuthConfig {
  /** CMO's own public origin, the base of its OAuth callback. */
  baseURL: string;
  /** Core's origin, for example `https://api.sokosumi.com`. */
  coreBaseUrl: string;
  clientId: string;
  clientSecret: string;
  /** Encrypts CMO's session and token cookies. */
  secret: string;
  /**
   * On Vercel: Core only knows production CMO's callback, so production
   * exchanges the code and hands a preview its tokens, encrypted with a
   * secret both share (ADR 0045). Production skips the proxy for itself.
   */
  oauthProxy?: { productionURL: string; secret: string };
}

/** Core's refresh tokens last 90 days; the session never outlives them. */
const SESSION_MAX_AGE_S = 90 * 24 * 60 * 60;

/**
 * Sign in with Sokosumi. Better Auth runs stateless: no database, the session
 * and the Sokosumi tokens live in encrypted httpOnly cookies (ADR 0045).
 */
export function createCmoAuth(config: CmoAuthConfig) {
  const discoveryUrl = `${config.coreBaseUrl}/auth/.well-known/openid-configuration`;
  const coreClient = createClient({ baseUrl: `${config.coreBaseUrl}/v1` });
  let revocationEndpoint: Promise<string> | undefined;

  function getCoreUser(accessToken: string) {
    return getUsersById({
      client: coreClient,
      path: { id: "me" },
      headers: { authorization: `Bearer ${accessToken}` },
    });
  }

  /** Throws on any failure; the sign-out hook logs it and still signs out. */
  async function revokeRefreshToken(refreshToken: string) {
    revocationEndpoint ??= fetch(discoveryUrl)
      .then(async (response) => {
        const document: { revocation_endpoint?: string } = response.ok
          ? await response.json()
          : {};
        if (!document.revocation_endpoint) {
          throw new Error(`No revocation_endpoint (${response.status})`);
        }
        return document.revocation_endpoint;
      })
      .catch((error: unknown) => {
        // Only a good document is kept; retry discovery on the next sign out.
        revocationEndpoint = undefined;
        throw error;
      });
    const response = await fetch(await revocationEndpoint, {
      method: "POST",
      headers: {
        authorization: `Basic ${btoa(`${encodeURIComponent(config.clientId)}:${encodeURIComponent(config.clientSecret)}`)}`,
        "content-type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({
        token: refreshToken,
        token_type_hint: "refresh_token",
      }),
    });
    if (!response.ok)
      throw new Error(`Core refused the revoke (${response.status})`);
  }

  return betterAuth({
    baseURL: config.baseURL,
    secret: config.secret,
    session: {
      expiresIn: SESSION_MAX_AGE_S,
      cookieCache: {
        enabled: true,
        strategy: "jwe",
        maxAge: SESSION_MAX_AGE_S,
      },
    },
    advanced: {
      // Locally CMO shares the sokosumi.localhost cookie domain with Web.
      cookiePrefix: "cmo",
      // Better Auth skips its CSRF origin check under test; keep it on.
      disableOriginCheck: false,
    },
    hooks: {
      before: createAuthMiddleware(async (ctx) => {
        if (
          ctx.path === "/sign-in/social" &&
          typeof ctx.body?.errorCallbackURL === "string"
        ) {
          // Production handles preview callbacks; preserve the caller's origin.
          ctx.body.errorCallbackURL = new URL(
            ctx.body.errorCallbackURL,
            config.baseURL,
          ).href;
        }
        if (ctx.path !== "/sign-out") return;
        const account = await getAccountCookie(ctx);
        if (!account?.refreshToken) return;
        try {
          await revokeRefreshToken(
            await decryptOAuthToken(account.refreshToken, ctx.context),
          );
        } catch (error) {
          // Signing out of CMO must still clear its cookies.
          ctx.context.logger.error(
            "Revoking the Sokosumi refresh token failed",
            error,
          );
        }
      }),
      after: createAuthMiddleware(async (ctx) => {
        if (ctx.path !== "/get-access-token") return;
        const tokens = ctx.context.returned;
        if (
          !tokens ||
          typeof tokens !== "object" ||
          !("accessToken" in tokens) ||
          typeof tokens.accessToken !== "string"
        ) {
          return;
        }
        // Refresh grants do not check bans; /v1 checks current Core access.
        const result = await getCoreUser(tokens.accessToken).catch(() => null);
        if (result?.data) return;
        const status = result?.response?.status;
        throw new APIError(
          status === 401 || status === 403
            ? "FORBIDDEN"
            : "SERVICE_UNAVAILABLE",
          { message: "Core could not authorize this CMO session" },
        );
      }),
    },
    plugins: [
      genericOAuth({
        config: [
          {
            providerId: SOKOSUMI_OAUTH_PROVIDER_ID,
            name: "Sokosumi",
            discoveryUrl,
            clientId: config.clientId,
            clientSecret: config.clientSecret,
            scopes: [...OAUTH_PROVIDER_SCOPES],
            pkce: true,
            // Core's ID token and userinfo carry only `sub` (it grants no
            // `profile` or `email` scope), so identity comes from /v1.
            async getUserInfo(tokens) {
              if (!tokens.accessToken) return null;
              const { data } = await getCoreUser(tokens.accessToken);
              if (!data) return null;
              const user = data.data;
              return {
                id: user.id,
                sub: user.id,
                name: user.name,
                email: user.email,
                emailVerified: user.emailVerified,
                image: user.image ?? undefined,
              };
            },
          },
        ],
      }),
      ...(config.oauthProxy
        ? [
            oAuthProxy({
              productionURL: config.oauthProxy.productionURL,
              // Server actions carry no request URL; name the origin.
              currentURL: config.baseURL,
              secret: config.oauthProxy.secret,
            }),
          ]
        : []),
      nextCookies(),
    ],
  });
}

export type CmoAuth = ReturnType<typeof createCmoAuth>;

let auth: CmoAuth | undefined;

/** CMO's auth, created on first use so builds need no auth env. */
export function getAuth(): CmoAuth {
  auth ??= createCmoAuth(readCmoAuthConfig());
  return auth;
}

function withSetCookies(from: Response): Response {
  const headers = new Headers();
  for (const cookie of from.headers.getSetCookie()) {
    headers.append("set-cookie", cookie);
  }
  return new Response(null, {
    status: from.status === 503 ? 503 : 204,
    headers,
  });
}

// ponytail: 30s replay within one process; cross-instance rotation needs Core coordination.
const RENEWAL_REPLAY_MS = 30_000;
const renewalsByAuth = new WeakMap<CmoAuth, Map<string, Promise<Response>>>();

/**
 * Keeps a page request's Sokosumi access fresh. Returns an empty response
 * whose `Set-Cookie` headers the caller forwards: renewed token cookies after
 * a silent refresh, cleared cookies when renewal fails, none otherwise.
 */
export function renewSession(
  auth: CmoAuth,
  request: Request,
): Promise<Response> {
  const { accountData, sessionToken } = getCookies(auth.options);
  const key = JSON.stringify(
    [...parseCookies(request.headers.get("cookie") ?? "")]
      .filter(
        ([name]) =>
          name === sessionToken.name ||
          name === accountData.name ||
          (name.startsWith(`${accountData.name}.`) &&
            /^\d+$/.test(name.slice(accountData.name.length + 1))),
      )
      .sort(([first], [second]) => first.localeCompare(second)),
  );
  let renewals = renewalsByAuth.get(auth);
  if (!renewals) {
    renewals = new Map();
    renewalsByAuth.set(auth, renewals);
  }
  const current = renewals.get(key);
  if (current) return current.then((response) => response.clone());

  const cache = renewals;
  const renewal = renewSessionOnce(auth, request).then(
    (response) => {
      if (response.headers.getSetCookie().length === 0) cache.delete(key);
      else {
        // Requests already sent by the browser can arrive after rotation ends.
        setTimeout(() => cache.delete(key), RENEWAL_REPLAY_MS).unref();
      }
      return response;
    },
    (error: unknown) => {
      cache.delete(key);
      throw error;
    },
  );
  cache.set(key, renewal);
  return renewal.then((response) => response.clone());
}

async function renewSessionOnce(
  auth: CmoAuth,
  request: Request,
): Promise<Response> {
  // An internal call: address CMO by its own origin, since the page request
  // may arrive on an internal host that Better Auth's CSRF check refuses.
  const origin = auth.options.baseURL;
  const headers = new Headers({
    cookie: request.headers.get("cookie") ?? "",
    origin,
    "content-type": "application/json",
  });
  const renewed = await auth.handler(
    new Request(`${origin}/api/auth/get-access-token`, {
      method: "POST",
      headers,
      body: JSON.stringify({ useAccountCookie: true }),
    }),
  );
  // 401: nobody is signed in.
  if (renewed.ok || renewed.status === 401 || renewed.status === 503) {
    return withSetCookies(renewed);
  }

  // The access check may reject a user after refresh has rotated the token.
  applySetCookies(headers, renewed.headers.getSetCookie());
  const signedOut = await auth.handler(
    new Request(`${origin}/api/auth/sign-out`, {
      method: "POST",
      headers,
      body: "{}",
    }),
  );
  return withSetCookies(signedOut);
}
