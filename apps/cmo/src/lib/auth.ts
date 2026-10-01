import { getUsersById, type User } from "@sokosumi/core-client";
import { createClient } from "@sokosumi/core-client/client";
import { joinFirstAndLastName, OAUTH_PROVIDER_SCOPES } from "@sokosumi/utils";
import {
  APIError,
  createAuthMiddleware,
  getSessionFromCtx,
} from "better-auth/api";
import {
  applySetCookies,
  getAccountCookie,
  getCookies,
  parseCookies,
  setSessionCookie,
} from "better-auth/cookies";
import { betterAuth } from "better-auth/minimal";
import { nextCookies } from "better-auth/next-js";
import { decryptOAuthToken } from "better-auth/oauth2";
import { genericOAuth } from "better-auth/plugins/generic-oauth";
import { oAuthProxy } from "better-auth/plugins/oauth-proxy";
import { unstable_rethrow } from "next/navigation";

import { readCmoAuthConfig } from "./auth-config";
import {
  SOKOSUMI_OAUTH_PROVIDER_ID,
  type SokosumiSignInOptions,
  sokosumiSignInBody,
} from "./sokosumi-oauth";

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

/** Vercel's client IP headers, as Core reads them. */
const CLIENT_IP_HEADERS = ["x-vercel-forwarded-for", "x-forwarded-for"];

/** Core's refresh tokens last 90 days; the session never outlives them. */
const SESSION_MAX_AGE_S = 90 * 24 * 60 * 60;

/** The person's full name, or their display name when Sokosumi has no parts. */
function personName(user: User): string {
  return (
    joinFirstAndLastName(user.firstName ?? "", user.lastName ?? "") ||
    user.name.trim()
  );
}

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
      // Without it, every visitor shares one rate-limit bucket per path.
      ipAddress: { ipAddressHeaders: CLIENT_IP_HEADERS },
    },
    // Better Auth only enables this in production by default; keep tests honest.
    rateLimit: { enabled: true },
    // Where a failure goes when it carries no errorCallbackURL: a callback
    // whose state is gone (expired, another browser, Back), or a failed
    // preview proxy hand-off. The signed-out page explains it; Better Auth's
    // bare error page does not.
    onAPIError: { errorURL: new URL("/", config.baseURL).href },
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
        // Refresh grants do not check bans, so check /v1 once per refresh:
        // a ban takes effect within one access-token lifetime (2 hours).
        const refreshed = ctx.context.responseHeaders
          ?.get("set-cookie")
          ?.includes(ctx.context.authCookies.accountData.name);
        if (!refreshed) return;
        const result = await getCoreUser(tokens.accessToken).catch(() => null);
        if (result?.data) {
          // The session cookie keeps the sign-in name for up to 90 days.
          const name = personName(result.data.data);
          const session = await getSessionFromCtx(ctx);
          if (session && session.user.name !== name) {
            await setSessionCookie(ctx, {
              session: session.session,
              user: { ...session.user, name },
            });
          }
          return;
        }
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
                name: personName(user),
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

/**
 * Starts Sign in with Sokosumi: Core's authorize URL, and the `Set-Cookie`
 * headers that carry CMO's OAuth state. A server action gets those cookies
 * through `nextCookies`; a route handler sends them on its own response.
 */
export async function startSokosumiSignIn(
  auth: CmoAuth,
  headers: Headers,
  options: SokosumiSignInOptions,
): Promise<{ url: string; setCookies: string[] }> {
  const { headers: responseHeaders, response } = await auth.api.signInSocial({
    body: sokosumiSignInBody(options),
    headers,
    returnHeaders: true,
  });
  if (!response.url) throw new Error("Sign in with Sokosumi returned no URL");
  return { url: response.url, setCookies: responseHeaders.getSetCookie() };
}

/**
 * A link's way into Sign in with Sokosumi, for `/signup` and `/signin`.
 * A person already signed in to CMO goes home instead.
 */
export async function sokosumiSignInRedirect(
  auth: CmoAuth,
  request: Request,
  options: SokosumiSignInOptions,
): Promise<Response> {
  const headers = new Headers({ location: "/", "cache-control": "no-store" });
  // The proxy skips renewal for prefetch, but the route still runs. A new
  // state cookie here would invalidate a sign-in already in progress. Not a
  // 2xx: Chrome serves a 2xx prefetch for the click, and a 204 swallows it.
  if (
    request.headers.has("next-router-prefetch") ||
    request.headers.has("next-router-segment-prefetch") ||
    request.headers.get("purpose") === "prefetch" ||
    request.headers.get("sec-purpose")?.includes("prefetch")
  ) {
    headers.delete("location");
    return new Response(null, { status: 403, headers });
  }
  try {
    if (!(await auth.api.getSession({ headers: request.headers }))) {
      const { url, setCookies } = await startSokosumiSignIn(
        auth,
        request.headers,
        options,
      );
      headers.set("location", url);
      for (const cookie of setCookies) headers.append("set-cookie", cookie);
    }
    return new Response(null, { status: 302, headers });
  } catch (error) {
    // Preserve Next's request-time rendering signals from headers/cookies.
    unstable_rethrow(error);
    console.error("Starting Sign in with Sokosumi failed", error);
    headers.delete("location");
    return new Response("CMO is temporarily unavailable. Try again.", {
      status: 503,
      headers,
    });
  }
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
  // Rate-limit renewals per visitor, not in one bucket for the whole server.
  for (const name of CLIENT_IP_HEADERS) {
    const value = request.headers.get(name);
    if (value) headers.set(name, value);
  }
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
