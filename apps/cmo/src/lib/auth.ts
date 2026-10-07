import {
  getUsersById,
  type SignUpContext,
  type User,
} from "@sokosumi/core-client";
import { type Client, createClient } from "@sokosumi/core-client/client";
import { joinFirstAndLastName, OAUTH_PROVIDER_SCOPES } from "@sokosumi/utils";
import type { AuthContext, BetterAuthPlugin } from "better-auth";
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
import { unstable_rethrow } from "next/navigation";

import { type CmoAuthConfig, readCmoAuthConfig } from "./auth-config";
import { CMO_SIGN_IN_ERROR } from "./sign-in-errors";

/**
 * The Better Auth generic OAuth provider id for Core. It names the callback
 * every CMO OAuth client registers: `<origin>/api/auth/callback/sokosumi`.
 */
const SOKOSUMI_OAUTH_PROVIDER_ID = "sokosumi";

export interface SokosumiSignInOptions {
  createAccount: boolean;
  /** Values a new account keeps as its sign-up context (ADR 0052). */
  signUpContext?: SignUpContext["context"];
}

/**
 * What CMO sends to start Sign in with Sokosumi. "Create account" adds the
 * OpenID Connect `prompt=create`, which makes Core open Sokosumi's sign-up
 * page instead of its sign-in page, and any sign-up context as one JSON
 * `signup_context` parameter. Sign in sends neither, so a person still signed
 * in to Sokosumi goes straight back to CMO.
 */
function sokosumiSignInBody({
  createAccount,
  signUpContext = {},
}: SokosumiSignInOptions) {
  const hasContext = Object.keys(signUpContext).length > 0;
  return {
    provider: SOKOSUMI_OAUTH_PROVIDER_ID,
    callbackURL: "/",
    errorCallbackURL: "/",
    ...(createAccount
      ? {
          additionalParams: {
            prompt: "create",
            ...(hasContext
              ? { signup_context: JSON.stringify(signUpContext) }
              : {}),
          },
        }
      : {}),
  };
}

/** Vercel's client IP headers, as Core reads them. */
const CLIENT_IP_HEADERS = ["x-vercel-forwarded-for", "x-forwarded-for"];

/** Core's refresh tokens last 90 days; the session never outlives them. */
const SESSION_MAX_AGE_S = 90 * 24 * 60 * 60;

/** Better Auth refreshes an access token this close to its expiry. */
const ACCESS_TOKEN_REFRESH_MARGIN_MS = 5_000;

/**
 * Marks a page's token read. A page cannot write cookies, so it is served the
 * cookie's token as long as it still works and never refreshed: a refresh
 * there would rotate Core's refresh token and lose the new one.
 */
const PAGE_TOKEN_READ_HEADER = "x-cmo-page-token-read";
/** The proxy refreshes below 5 seconds, so a page sees at least this much. */
const PAGE_TOKEN_MIN_LIFETIME_MS = 1_000;
const RENEWAL_REQUIRED = "RENEWAL_REQUIRED";

/** Token endpoint statuses that mean Core could not answer, not "no". */
const CORE_UNAVAILABLE_STATUSES = new Set([408, 429]);

/** Renewal requests whose refresh grant got no answer from Core. */
const unansweredRefreshes = new WeakSet<Request>();

function coreDiscoveryUrl(coreBaseUrl: string): string {
  return `${coreBaseUrl}/auth/.well-known/openid-configuration`;
}

/** Sokosumi's provider, missing while Core's discovery failed on this instance. */
function sokosumiProvider({
  socialProviders,
}: Pick<AuthContext, "socialProviders">) {
  return socialProviders.find(({ id }) => id === SOKOSUMI_OAUTH_PROVIDER_ID);
}

/** Whether a refresh failed without an answer from Core. */
function isUnanswered(error: unknown): boolean {
  // Fetch rejects with a TypeError when Core cannot be reached or times out.
  if (error instanceof TypeError) return true;
  // Better Fetch throws the token endpoint's error body with its status.
  const status =
    error && typeof error === "object" && "status" in error
      ? error.status
      : undefined;
  return (
    typeof status === "number" &&
    (status >= 500 || CORE_UNAVAILABLE_STATUSES.has(status))
  );
}

/**
 * Better Auth answers every failed refresh with the same 400. This records
 * the requests where Core gave no answer (a network error, a timeout, a 5xx)
 * rather than refusing, so renewal can keep the session through an outage.
 */
const recordUnansweredRefreshes = {
  id: "cmo-record-unanswered-refreshes",
  init(ctx) {
    const provider = sokosumiProvider(ctx);
    const refresh = provider?.refreshAccessToken;
    if (!provider || !refresh) return;
    provider.refreshAccessToken = async (refreshToken, refreshCtx) => {
      try {
        return await refresh(refreshToken, refreshCtx);
      } catch (error) {
        if (refreshCtx?.request && isUnanswered(error)) {
          unansweredRefreshes.add(refreshCtx.request);
        }
        throw error;
      }
    };
  },
} satisfies BetterAuthPlugin;

/** The person's full name, or their display name when Sokosumi has no parts. */
function personName(user: User): string {
  return (
    joinFirstAndLastName(user.firstName ?? "", user.lastName ?? "") ||
    user.name.trim()
  );
}

const coreClients = new Map<string, Client>();

/** The `/v1` client for a Core, shared by CMO's auth and its pages. */
export function coreClientFor(coreBaseUrl: string): Client {
  let client = coreClients.get(coreBaseUrl);
  if (!client) {
    client = createClient({ baseUrl: `${coreBaseUrl}/v1` });
    coreClients.set(coreBaseUrl, client);
  }
  return client;
}

/**
 * Sign in with Sokosumi. Better Auth runs stateless: no database, the session
 * and the Sokosumi tokens live in encrypted httpOnly cookies (ADR 0045).
 */
export function createCmoAuth(config: CmoAuthConfig) {
  const discoveryUrl = coreDiscoveryUrl(config.coreBaseUrl);
  const coreClient = coreClientFor(config.coreBaseUrl);
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
    rateLimit: {
      enabled: true,
      // Every page load renews through this path, signed in or not, and a
      // refused renewal signs the person out. Browsers cannot reach it
      // (`api/auth/[...all]`), and Core limits the refresh itself.
      customRules: { "/get-access-token": false },
    },
    // Where a failure goes when it carries no errorCallbackURL: a callback
    // whose state is gone (expired, another browser, Back). The signed-out
    // page explains it; Better Auth's bare error page does not.
    onAPIError: { errorURL: new URL("/", config.baseURL).href },
    hooks: {
      before: createAuthMiddleware(async (ctx) => {
        if (ctx.path === "/get-access-token") {
          const pageRead = ctx.headers?.has(PAGE_TOKEN_READ_HEADER) ?? false;
          // Without discovery there is no provider, and Better Auth fails
          // before it looks at the token. A valid token needs no provider.
          if (!pageRead && sokosumiProvider(ctx.context)) return;
          const [session, account] = await Promise.all([
            getSessionFromCtx(ctx),
            getAccountCookie(ctx),
          ]);
          const expiresAt = account?.accessTokenExpiresAt
            ? new Date(account.accessTokenExpiresAt)
            : undefined;
          if (
            !session ||
            !account?.accessToken ||
            account.userId !== session.user.id ||
            !expiresAt ||
            expiresAt.getTime() - Date.now() <
              (pageRead
                ? PAGE_TOKEN_MIN_LIFETIME_MS
                : ACCESS_TOKEN_REFRESH_MARGIN_MS)
          ) {
            if (!pageRead) return;
            throw new APIError("UNAUTHORIZED", {
              code: RENEWAL_REQUIRED,
              message: "Renew the Sokosumi access token before this page",
            });
          }
          return ctx.json({
            accessToken: await decryptOAuthToken(
              account.accessToken,
              ctx.context,
            ),
            accessTokenExpiresAt: expiresAt,
          });
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
            // Better Auth defaults to `client_secret_post`; Core registers
            // CMO as `client_secret_basic` and refuses a body secret.
            tokenEndpointAuth: { method: "client_secret_basic" },
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
      recordUnansweredRefreshes,
      nextCookies(),
    ],
  });
}

export type CmoAuth = ReturnType<typeof createCmoAuth>;

let auth: CmoAuth | undefined;

/** CMO's auth, created on first use so builds need no auth env. */
export function getAuth(): CmoAuth {
  if (auth) return auth;
  const config = readCmoAuthConfig();
  const created = createCmoAuth(config);
  auth = created;
  created.$context.then((context) => {
    if (sokosumiProvider(context)) return;
    // Better Auth discovers Core once per instance. A preview's first request
    // can beat its branch's Core deploy, so discover again on the next one.
    if (auth === created) auth = undefined;
    // Better Auth only says it skipped the provider, not which URL failed.
    const discoveryUrl = coreDiscoveryUrl(config.coreBaseUrl);
    fetch(discoveryUrl).then(
      (response) =>
        console.error(
          `Core discovery failed: ${discoveryUrl} answered ${response.status}`,
        ),
      (error: unknown) =>
        console.error(`Core discovery failed: ${discoveryUrl}`, error),
    );
  });
  return auth;
}

/** Where sign in goes when it cannot start; the signed-out page explains. */
const SIGN_IN_UNAVAILABLE_PATH = `/?error=${CMO_SIGN_IN_ERROR.unavailable}`;

/**
 * Starts Sign in with Sokosumi: Core's authorize URL, and the `Set-Cookie`
 * headers that carry CMO's OAuth state. A server action gets those cookies
 * through `nextCookies`; a route handler sends them on its own response.
 * When Core is down or its discovery failed, the URL is the signed-out page,
 * which says so, and there are no cookies.
 */
export async function startSokosumiSignIn(
  auth: CmoAuth,
  headers: Headers,
  options: SokosumiSignInOptions,
): Promise<{ url: string; setCookies: string[] }> {
  try {
    const { headers: responseHeaders, response } = await auth.api.signInSocial({
      body: sokosumiSignInBody(options),
      headers,
      returnHeaders: true,
    });
    if (!response.url) throw new Error("Sign in with Sokosumi returned no URL");
    return { url: response.url, setCookies: responseHeaders.getSetCookie() };
  } catch (error) {
    // Preserve Next's control flow and request-time rendering signals.
    unstable_rethrow(error);
    console.error("Starting Sign in with Sokosumi failed", error);
    return { url: SIGN_IN_UNAVAILABLE_PATH, setCookies: [] };
  }
}

/**
 * The Sokosumi access token for a page render, or null when it must be
 * renewed first. Pages render after the proxy renewed it; only a render the
 * proxy skipped (a prefetch or prerender) can find it expired.
 */
export async function getPageAccessToken(
  auth: CmoAuth,
  requestHeaders: Headers,
): Promise<string | null> {
  const headers = new Headers(requestHeaders);
  headers.set(PAGE_TOKEN_READ_HEADER, "1");
  try {
    const { accessToken } = await auth.api.getAccessToken({
      body: { useAccountCookie: true },
      headers,
    });
    return accessToken;
  } catch (error) {
    if (error instanceof APIError && error.body?.code === RENEWAL_REQUIRED) {
      return null;
    }
    throw error;
  }
}

/**
 * A link's way into Sign in with Sokosumi, for `/signup` and `/signin`.
 * A person already signed in to CMO goes home instead. A Create account
 * link's query parameters become the sign-up context; a repeated one keeps
 * its first value.
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
  // The prefetch headers of the matcher in `proxy.ts`, which Next needs
  // written out there; change both together.
  if (
    request.headers.has("next-router-prefetch") ||
    request.headers.has("next-router-segment-prefetch") ||
    request.headers.get("purpose") === "prefetch" ||
    request.headers.get("sec-purpose")?.includes("prefetch")
  ) {
    headers.delete("location");
    return new Response(null, { status: 403, headers });
  }
  if (!(await auth.api.getSession({ headers: request.headers }))) {
    // In the link's key order; the first of a repeated parameter wins.
    const signUpContext: Record<string, string> = {};
    if (options.createAccount) {
      for (const [key, value] of new URL(request.url).searchParams) {
        signUpContext[key] ??= value;
      }
    }
    const { url, setCookies } = await startSokosumiSignIn(
      auth,
      request.headers,
      { ...options, signUpContext },
    );
    headers.set("location", url);
    for (const cookie of setCookies) headers.append("set-cookie", cookie);
  }
  return new Response(null, { status: 302, headers });
}

function withSetCookies(from: Response, status: number): Response {
  const headers = new Headers();
  for (const cookie of from.headers.getSetCookie()) {
    headers.append("set-cookie", cookie);
  }
  return new Response(null, { status, headers });
}

// Within one process. Across instances, Core replays a rotated refresh token's
// answer for 30s, so a second instance renewing the same session gets it too.
const RENEWAL_REPLAY_MS = 30_000;
// Inside Core's 30s rotation replay, so the first retry after a lost answer
// still receives the rotated token instead of revoking the family.
const OUTAGE_BACKOFF_MS = 10_000;
const renewalsByAuth = new WeakMap<CmoAuth, Map<string, Promise<Response>>>();

/**
 * Keeps a page request's Sokosumi access fresh. Returns an empty response
 * whose `Set-Cookie` headers the caller forwards: renewed token cookies after
 * a silent refresh, cleared cookies when Core refuses renewal, none
 * otherwise. Its status is 401 when renewal signed the person out, 503 while
 * Core cannot be reached or cannot check them, and 204 otherwise. A 503 is
 * replayed for a few seconds, so an outage does not send every page to Core.
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
      // Requests already sent by the browser can arrive after rotation ends,
      // and an outage should not send every page load to Core.
      const replayMs =
        response.headers.getSetCookie().length > 0
          ? RENEWAL_REPLAY_MS
          : response.status === 503
            ? OUTAGE_BACKOFF_MS
            : 0;
      if (replayMs === 0) cache.delete(key);
      else setTimeout(() => cache.delete(key), replayMs).unref();
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
  // Better Auth reads the visitor from these, e.g. to rate-limit the sign-out
  // below per visitor, not in one bucket for the whole server.
  for (const name of CLIENT_IP_HEADERS) {
    const value = request.headers.get(name);
    if (value) headers.set(name, value);
  }
  const renewalRequest = new Request(`${origin}/api/auth/get-access-token`, {
    method: "POST",
    headers,
    body: JSON.stringify({ useAccountCookie: true }),
  });
  const renewed = await auth.handler(renewalRequest);
  // 401: nobody is signed in.
  if (renewed.ok || renewed.status === 401 || renewed.status === 503) {
    return withSetCookies(renewed, renewed.status === 503 ? 503 : 204);
  }
  // Core gave no answer to the refresh, or discovery failed on this instance
  // so it has no provider: keep the session and try again later.
  const body: unknown = await renewed.json().catch(() => null);
  if (
    unansweredRefreshes.has(renewalRequest) ||
    (body &&
      typeof body === "object" &&
      "code" in body &&
      body.code === "PROVIDER_NOT_SUPPORTED" &&
      !sokosumiProvider(await auth.$context))
  ) {
    return withSetCookies(renewed, 503);
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
  return withSetCookies(signedOut, 401);
}
