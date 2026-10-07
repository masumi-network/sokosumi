import { symmetricDecodeJWT, symmetricEncodeJWT } from "better-auth/crypto";
import {
  calculateJwkThumbprint,
  exportJWK,
  generateKeyPair,
  type JWK,
  SignJWT,
} from "jose";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { GET as signInLink } from "../app/signin/route";
import { GET as signUpLink } from "../app/signup/route";
import {
  type CmoAuth,
  createCmoAuth,
  getAuth,
  getPageAccessToken,
  renewSession,
  type SokosumiSignInOptions,
  startSokosumiSignIn,
} from "./auth";

// The link routes reach the auth each test creates.
vi.mock("./auth", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./auth")>()),
  getAuth: vi.fn(),
}));

const CMO = "https://app.cmo.xyz";
const CORE = "https://core.test";
const ISSUER = `${CORE}/auth`;
const CLIENT_ID = "cmo-client";
const CLIENT_SECRET = "cmo-secret";
const CALLBACK = `${CMO}/api/auth/callback/sokosumi`;
const TWO_HOURS_S = 7_200;
/** How long CMO waits before asking an unreachable Core again. */
const OUTAGE_BACKOFF_MS = 10_000;
const AUTH_CONFIG = {
  baseURL: CMO,
  coreBaseUrl: CORE,
  clientId: CLIENT_ID,
  clientSecret: CLIENT_SECRET,
  secret: "a-cookie-secret-that-is-at-least-32-characters",
};

interface FakeCore {
  fetch: typeof fetch;
  /** Authorize URL query of the last sign-in, as the browser would send it. */
  approve(authorizeUrl: string): { code: string; state: string };
  refreshCount(): number;
  /** Refresh grants CMO sent, including ones the token endpoint failed. */
  refreshAttempts: number;
  /** The token endpoint fails while set: a network error or that status. */
  tokenFailure: "network" | number | null;
  revoked: string[];
  revokeAll(): void;
  /** Core refuses the user on `/v1`, as for a banned or deleted account. */
  refuseUser(): void;
  /** Core's discovery document answers 503 while true. */
  discoveryDown: boolean;
  /** `/v1/users/me` answers 503 while true. */
  userLookupDown: boolean;
  /** How often CMO has called `/v1/users/me`. */
  userLookups: number;
  /** The names `/v1/users/me` answers with. */
  user: { name: string; firstName: string | null; lastName: string | null };
}

/**
 * Core's OAuth provider at the network boundary: OIDC discovery, JWKS, token
 * (code and refresh grants with rotation), `/v1/users/me`, and revoke.
 */
async function createFakeCore(): Promise<FakeCore> {
  const { privateKey, publicKey } = await generateKeyPair("EdDSA");
  const publicJwk: JWK = await exportJWK(publicKey);
  publicJwk.kid = await calculateJwkThumbprint(publicJwk);
  publicJwk.alg = "EdDSA";

  const codes = new Map<string, { challenge: string; nonce?: string }>();
  const accessTokens = new Set<string>();
  const refreshTokens = new Set<string>();
  const revoked: string[] = [];
  let refreshes = 0;
  let counter = 0;
  let userRefused = false;

  function json(body: unknown, status = 200): Response {
    return Response.json(body, { status });
  }

  // Core registers CMO as `client_secret_basic` and refuses a body secret.
  function hasClientCredentials(request: Request, form: URLSearchParams) {
    const basic = request.headers.get("authorization");
    return (
      !form.has("client_secret") &&
      basic?.startsWith("Basic ") === true &&
      atob(basic.slice(6)) ===
        `${encodeURIComponent(CLIENT_ID)}:${encodeURIComponent(CLIENT_SECRET)}`
    );
  }

  async function issueTokens(nonce?: string) {
    counter += 1;
    const accessToken = `soko_access_token_${counter}`;
    const refreshToken = `soko_refresh_token_${counter}`;
    accessTokens.add(accessToken);
    refreshTokens.add(refreshToken);
    const now = Math.floor(Date.now() / 1000);
    const idToken = await new SignJWT({ ...(nonce ? { nonce } : {}) })
      .setProtectedHeader({ alg: "EdDSA", kid: publicJwk.kid })
      .setIssuer(ISSUER)
      .setAudience(CLIENT_ID)
      .setSubject("user_1")
      .setIssuedAt(now)
      .setExpirationTime(now + 72_000)
      .sign(privateKey);
    return {
      access_token: accessToken,
      refresh_token: refreshToken,
      id_token: idToken,
      token_type: "Bearer",
      expires_in: TWO_HOURS_S,
      scope: "openid sokosumi:api offline_access",
    };
  }

  async function sha256Base64Url(value: string) {
    const digest = await crypto.subtle.digest(
      "SHA-256",
      new TextEncoder().encode(value),
    );
    return Buffer.from(digest).toString("base64url");
  }

  const fakeFetch = async (
    input: RequestInfo | URL,
    init?: RequestInit,
  ): Promise<Response> => {
    const request = new Request(input, init);
    const url = new URL(request.url);
    if (url.origin !== CORE) {
      throw new Error(`Unexpected request to ${request.url}`);
    }

    switch (url.pathname) {
      case "/auth/.well-known/openid-configuration":
        if (fake.discoveryDown) return json({ error: "unavailable" }, 503);
        return json({
          issuer: ISSUER,
          authorization_endpoint: `${ISSUER}/oauth2/authorize`,
          token_endpoint: `${ISSUER}/oauth2/token`,
          userinfo_endpoint: `${ISSUER}/oauth2/userinfo`,
          revocation_endpoint: `${ISSUER}/oauth2/revoke`,
          end_session_endpoint: `${ISSUER}/oauth2/end-session`,
          jwks_uri: `${ISSUER}/jwks`,
          id_token_signing_alg_values_supported: ["EdDSA"],
          code_challenge_methods_supported: ["S256"],
        });
      case "/auth/jwks":
        return json({ keys: [publicJwk] });
      case "/auth/oauth2/token": {
        const form = new URLSearchParams(await request.text());
        if (form.get("grant_type") === "refresh_token") {
          fake.refreshAttempts += 1;
        }
        if (fake.tokenFailure === "network") {
          throw new TypeError("fetch failed");
        }
        if (fake.tokenFailure !== null) {
          return json(
            {
              error:
                fake.tokenFailure >= 500
                  ? "server_error"
                  : fake.tokenFailure === 400
                    ? "invalid_grant"
                    : "invalid_client",
            },
            fake.tokenFailure,
          );
        }
        if (!hasClientCredentials(request, form)) {
          return json({ error: "invalid_client" }, 401);
        }
        if (form.get("grant_type") === "authorization_code") {
          const grant = codes.get(form.get("code") ?? "");
          const verifier = form.get("code_verifier") ?? "";
          if (
            !grant ||
            form.get("redirect_uri") !== CALLBACK ||
            (await sha256Base64Url(verifier)) !== grant.challenge
          ) {
            return json({ error: "invalid_grant" }, 400);
          }
          codes.delete(form.get("code") ?? "");
          return json(await issueTokens(grant.nonce));
        }
        if (form.get("grant_type") === "refresh_token") {
          const refreshToken = form.get("refresh_token") ?? "";
          if (!refreshTokens.delete(refreshToken)) {
            return json({ error: "invalid_grant" }, 400);
          }
          refreshes += 1;
          return json(await issueTokens());
        }
        return json({ error: "unsupported_grant_type" }, 400);
      }
      case "/v1/users/me": {
        fake.userLookups += 1;
        if (fake.userLookupDown) return json({ error: "unavailable" }, 503);
        const bearer = request.headers.get("authorization")?.slice(7) ?? "";
        if (userRefused || !accessTokens.has(bearer)) {
          return json({ error: "Unauthorized" }, 401);
        }
        return json({
          data: {
            id: "user_1",
            createdAt: "2026-01-01T00:00:00.000Z",
            updatedAt: "2026-01-01T00:00:00.000Z",
            ...fake.user,
            email: "ada@example.com",
            emailVerified: true,
            image: null,
            role: "user",
          },
          meta: { timestamp: "2026-10-06T09:00:00.000Z", requestId: "req_1" },
        });
      }
      case "/auth/oauth2/revoke": {
        const form = new URLSearchParams(await request.text());
        if (!hasClientCredentials(request, form)) {
          return json({ error: "invalid_client" }, 401);
        }
        const token = form.get("token") ?? "";
        revoked.push(token);
        refreshTokens.delete(token);
        return new Response(null, { status: 200 });
      }
      default:
        return json({ error: "not_found" }, 404);
    }
  };

  const fake: FakeCore = {
    fetch: fakeFetch as typeof fetch,
    approve(authorizeUrl) {
      const query = new URL(authorizeUrl).searchParams;
      counter += 1;
      const code = `code_${counter}`;
      codes.set(code, {
        challenge: query.get("code_challenge") ?? "",
        nonce: query.get("nonce") ?? undefined,
      });
      return { code, state: query.get("state") ?? "" };
    },
    refreshCount: () => refreshes,
    refreshAttempts: 0,
    tokenFailure: null,
    revoked,
    revokeAll() {
      for (const token of refreshTokens) revoked.push(token);
      refreshTokens.clear();
      accessTokens.clear();
    },
    refuseUser() {
      userRefused = true;
    },
    discoveryDown: false,
    userLookupDown: false,
    userLookups: 0,
    user: { name: "Ada Lovelace", firstName: "Ada", lastName: "Lovelace" },
  };
  return fake;
}

let browsers = 0;

/** A browser's cookie jar for one origin, from its own client IP. */
class CookieJar {
  private cookies = new Map<string, string>();
  // Better Auth's in-memory rate limiter outlives each test's auth instance.
  readonly ip = `10.0.${Math.floor((browsers += 1) / 250)}.${browsers % 250}`;

  constructor(readonly origin = CMO) {}

  store(response: Response) {
    for (const header of response.headers.getSetCookie()) {
      const [pair, ...attributes] = header.split(";");
      const index = pair.indexOf("=");
      const name = pair.slice(0, index).trim();
      const value = pair.slice(index + 1).trim();
      const expired = attributes.some((attribute) => {
        const [key, raw] = attribute.trim().split("=");
        return key.toLowerCase() === "max-age" && Number(raw) <= 0;
      });
      if (expired || value === "") {
        this.cookies.delete(name);
      } else {
        this.cookies.set(name, value);
      }
    }
  }

  header(): string {
    return [...this.cookies]
      .map(([name, value]) => `${name}=${value}`)
      .join("; ");
  }

  names(): string[] {
    return [...this.cookies.keys()];
  }
}

function browserRequest(
  jar: CookieJar,
  path: string,
  init: { method?: string; body?: unknown } = {},
): Request {
  const headers = new Headers({
    cookie: jar.header(),
    origin: jar.origin,
    "x-vercel-forwarded-for": jar.ip,
  });
  if (init.body !== undefined) headers.set("content-type", "application/json");
  return new Request(`${jar.origin}${path}`, {
    method: init.method ?? "GET",
    headers,
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
  });
}

async function send(
  auth: CmoAuth,
  jar: CookieJar,
  path: string,
  init?: { method?: string; body?: unknown },
): Promise<Response> {
  const response = await auth.handler(browserRequest(jar, path, init));
  jar.store(response);
  return response;
}

async function startSignIn(
  auth: CmoAuth,
  jar: CookieJar,
  options: SokosumiSignInOptions = { createAccount: false },
): Promise<string> {
  const { url, setCookies } = await startSokosumiSignIn(
    auth,
    browserRequest(jar, "/").headers,
    options,
  );
  jar.store(
    new Response(null, {
      headers: setCookies.map((cookie) => ["set-cookie", cookie]),
    }),
  );
  return url;
}

function callbackPath({ code, state }: { code: string; state: string }) {
  return `/api/auth/callback/sokosumi?code=${code}&state=${encodeURIComponent(state)}&iss=${encodeURIComponent(ISSUER)}`;
}

const LINK_ROUTES = { "/signin": signInLink, "/signup": signUpLink };

/** A link from cmo.xyz or an email: a cross-site GET with no Origin. */
async function followLink(
  jar: CookieJar,
  path: keyof typeof LINK_ROUTES,
): Promise<Response> {
  // Better Auth's origin check needs a request object; the routes pass it
  // headers only, so a cross-site link without an Origin may start the flow.
  const response = await LINK_ROUTES[path](
    new Request(`${jar.origin}${path}`, {
      headers: { cookie: jar.header(), "x-vercel-forwarded-for": jar.ip },
    }),
  );
  jar.store(response);
  return response;
}

async function signIn(auth: CmoAuth, jar: CookieJar, core: FakeCore) {
  const approval = core.approve(await startSignIn(auth, jar));
  return send(auth, jar, callbackPath(approval));
}

async function sessionUser(auth: CmoAuth, jar: CookieJar) {
  const response = await send(auth, jar, "/api/auth/get-session");
  const body = (await response.json()) as {
    user: { name: string; email: string };
  } | null;
  return body?.user ? { name: body.user.name, email: body.user.email } : null;
}

async function renew(auth: CmoAuth, jar: CookieJar): Promise<Response> {
  const response = await renewSession(auth, browserRequest(jar, "/"));
  jar.store(response);
  return response;
}

describe("CMO auth handler", () => {
  let core: FakeCore;
  let auth: CmoAuth;
  let jar: CookieJar;

  beforeEach(async () => {
    vi.useFakeTimers({
      toFake: ["Date"],
      now: new Date("2026-10-06T09:00:00Z"),
    });
    core = await createFakeCore();
    vi.stubGlobal("fetch", core.fetch);
    auth = createCmoAuth(AUTH_CONFIG);
    jar = new CookieJar();
    vi.mocked(getAuth).mockReturnValue(auth);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
    vi.useRealTimers();
  });

  it("starts sign-in at Core's authorize endpoint with PKCE, scopes, client, and callback", async () => {
    const url = new URL(await startSignIn(auth, jar));

    expect(`${url.origin}${url.pathname}`).toBe(`${ISSUER}/oauth2/authorize`);
    expect(url.searchParams.get("client_id")).toBe(CLIENT_ID);
    expect(url.searchParams.get("redirect_uri")).toBe(CALLBACK);
    expect(url.searchParams.get("response_type")).toBe("code");
    expect(url.searchParams.get("scope")?.split(" ").sort()).toEqual([
      "offline_access",
      "openid",
      "sokosumi:api",
    ]);
    expect(url.searchParams.get("code_challenge_method")).toBe("S256");
    expect(url.searchParams.get("code_challenge")).toBeTruthy();
    expect(url.searchParams.get("state")).toBeTruthy();
    // Sign in sends no prompt; Create account's `prompt=create` is below.
    expect(url.searchParams.has("prompt")).toBe(false);
  });

  it("starts Create account from a link and signs in on the callback", async () => {
    const response = await followLink(jar, "/signup");

    expect(response.status).toBe(302);
    expect(response.headers.get("cache-control")).toBe("no-store");
    const stateCookies = response.headers.getSetCookie();
    expect(stateCookies).toHaveLength(1);
    expect(stateCookies[0]).toMatch(/^__Secure-cmo.oauth_state=/);
    for (const attribute of ["HttpOnly", "Secure", "SameSite=Lax", "Path=/"]) {
      expect(stateCookies[0]).toContain(attribute);
    }
    expect(stateCookies[0]).not.toMatch(/domain=/i);
    const authorizeUrl = response.headers.get("location") ?? "";
    expect(new URL(authorizeUrl).searchParams.get("prompt")).toBe("create");
    await send(auth, jar, callbackPath(core.approve(authorizeUrl)));
    expect(await sessionUser(auth, jar)).toEqual({
      name: "Ada Lovelace",
      email: "ada@example.com",
    });
  });

  it.each([
    ["purpose", "prefetch"],
    ["next-router-prefetch", "1"],
    ["next-router-segment-prefetch", "/_tree"],
    ["sec-purpose", "prefetch;prerender"],
  ])(
    "keeps an active sign-in usable after speculative link requests (%o)",
    async (name, value) => {
      const started = await followLink(jar, "/signin");
      const approval = core.approve(started.headers.get("location") ?? "");
      const cookies = jar.header();

      for (const path of ["/signup", "/signin"] as const) {
        const response = await LINK_ROUTES[path](
          new Request(`${CMO}${path}`, {
            headers: { [name]: value, cookie: jar.header() },
          }),
        );
        jar.store(response);
        // Chrome serves a 2xx prefetch for the click itself, and a 204
        // swallows that click. Any other status makes it navigate for real.
        expect(response.status).toBe(403);
        expect(response.headers.get("cache-control")).toBe("no-store");
        expect(response.headers.has("location")).toBe(false);
        expect(response.headers.getSetCookie()).toEqual([]);
        expect(jar.header()).toBe(cookies);
      }

      await send(auth, jar, callbackPath(approval));
      expect(await sessionUser(auth, jar)).toEqual({
        name: "Ada Lovelace",
        email: "ada@example.com",
      });
    },
  );

  it.each(["/signup", "/signin"] as const)(
    "explains on the signed-out page when Core discovery fails on %s",
    async (path) => {
      core.discoveryDown = true;
      vi.mocked(getAuth).mockReturnValue(createCmoAuth(AUTH_CONFIG));

      const logged = vi.spyOn(console, "error").mockImplementation(() => {});

      const response = await followLink(jar, path);

      expect(response.status).toBe(302);
      expect(logged).toHaveBeenCalledWith(
        "Starting Sign in with Sokosumi failed",
        expect.anything(),
      );
      logged.mockRestore();
      expect(response.headers.get("cache-control")).toBe("no-store");
      expect(response.headers.get("location")).toBe("/?error=unavailable");
      expect(response.headers.getSetCookie()).toEqual([]);
    },
  );

  it("signs in once Core answers after discovery failed at startup", async () => {
    // A preview's first request can beat its branch's Core preview deploy.
    vi.stubEnv("BETTER_AUTH_URL", CMO);
    vi.stubEnv("CORE_APP_BASE_URL", CORE);
    vi.stubEnv("SOKOSUMI_OAUTH_CLIENT_ID", CLIENT_ID);
    vi.stubEnv("SOKOSUMI_OAUTH_CLIENT_SECRET", CLIENT_SECRET);
    vi.stubEnv("BETTER_AUTH_SECRET", AUTH_CONFIG.secret);
    const { getAuth: getRealAuth } =
      await vi.importActual<typeof import("./auth")>("./auth");
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});
    core.discoveryDown = true;
    await getRealAuth().$context;
    core.discoveryDown = false;

    const url = new URL(await startSignIn(getRealAuth(), jar));

    logged.mockRestore();
    expect(`${url.origin}${url.pathname}`).toBe(`${ISSUER}/oauth2/authorize`);
  });

  it("rejects a link callback when the browser drops its forwarded state cookie", async () => {
    const response = await followLink(jar, "/signin");
    const approval = core.approve(response.headers.get("location") ?? "");
    const emptyJar = new CookieJar();

    const callback = await send(auth, emptyJar, callbackPath(approval));

    expect(callback.headers.get("location")).toBe(
      `${CMO}/?error=state_mismatch`,
    );
    expect(await sessionUser(auth, emptyJar)).toBeNull();
  });

  it("starts a new link flow when the CMO session has expired", async () => {
    await signIn(auth, jar, core);
    vi.setSystemTime(Date.now() + 91 * 24 * 60 * 60 * 1000);

    const response = await followLink(jar, "/signin");
    const authorizeUrl = response.headers.get("location") ?? "";

    expect(new URL(authorizeUrl).pathname).toBe("/auth/oauth2/authorize");
    expect(response.headers.get("cache-control")).toBe("no-store");
    await send(auth, jar, callbackPath(core.approve(authorizeUrl)));
    expect(await sessionUser(auth, jar)).not.toBeNull();
  });

  it("sends a link home when the person is already signed in to CMO", async () => {
    await signIn(auth, jar, core);
    const cookies = jar.header();

    for (const path of ["/signup", "/signin"] as const) {
      const response = await followLink(jar, path);

      expect(response.status).toBe(302);
      expect(response.headers.get("location")).toBe("/");
      expect(response.headers.get("cache-control")).toBe("no-store");
      expect(jar.header()).toBe(cookies);
    }
  });

  it("signs in on the callback and returns name and email from the session", async () => {
    const response = await signIn(auth, jar, core);

    expect(response.status).toBe(302);
    expect(response.headers.get("location")).toBe("/");
    for (const header of response.headers.getSetCookie()) {
      expect(header).toMatch(/HttpOnly/i);
    }
    expect(jar.names().sort()).toEqual([
      "__Secure-cmo.account_data",
      "__Secure-cmo.session_data",
      "__Secure-cmo.session_token",
    ]);
    expect(await sessionUser(auth, jar)).toEqual({
      name: "Ada Lovelace",
      email: "ada@example.com",
    });
  });

  it("names the session after the person's first and last name, not their display name", async () => {
    core.user = { name: "Ada", firstName: "Ada", lastName: "Lovelace" };

    await signIn(auth, jar, core);

    expect(await sessionUser(auth, jar)).toEqual({
      name: "Ada Lovelace",
      email: "ada@example.com",
    });
  });

  it("names the session after the display name when Sokosumi has no name parts", async () => {
    // Magic-link sign-ups and accounts from before the name parts.
    core.user = { name: "Ada L.", firstName: null, lastName: null };

    await signIn(auth, jar, core);

    expect(await sessionUser(auth, jar)).toEqual({
      name: "Ada L.",
      email: "ada@example.com",
    });
  });

  it("leaves the session name empty when Sokosumi has only blanks", async () => {
    // The signed-in view then names the account by its email.
    core.user = { name: "  ", firstName: null, lastName: null };

    await signIn(auth, jar, core);

    expect(await sessionUser(auth, jar)).toEqual({
      name: "",
      email: "ada@example.com",
    });
  });

  it("keeps the Sokosumi tokens out of readable cookies", async () => {
    await signIn(auth, jar, core);

    expect(jar.header()).not.toContain("soko_access_token_");
    expect(jar.header()).not.toContain("soko_refresh_token_");
  });

  it("leaves a fresh session alone without calling Core", async () => {
    await signIn(auth, jar, core);
    const lookupsAtSignIn = core.userLookups;

    const response = await renew(auth, jar);

    expect(response.status).toBe(204);
    expect(response.headers.getSetCookie()).toEqual([]);
    expect(core.refreshCount()).toBe(0);
    expect(core.userLookups).toBe(lookupsAtSignIn);
  });

  it("renews when the page request arrives on an internal host", async () => {
    await signIn(auth, jar, core);
    vi.setSystemTime(Date.now() + (TWO_HOURS_S + 60) * 1000);

    // Behind a local proxy, Next.js can see its own host, not CMO's origin.
    const response = await renewSession(
      auth,
      new Request("http://cmo-internal:3100/", {
        headers: { cookie: jar.header() },
      }),
    );
    jar.store(response);

    expect(core.refreshCount()).toBe(1);
    expect(await sessionUser(auth, jar)).not.toBeNull();
  });

  it("renews once when two requests share a cookie", async () => {
    await signIn(auth, jar, core);
    vi.setSystemTime(Date.now() + (TWO_HOURS_S + 60) * 1000);
    const header = jar.header();
    const [first, second] = await Promise.all(
      [0, 1].map(() =>
        renewSession(
          auth,
          new Request(`${CMO}/`, { headers: { cookie: header, origin: CMO } }),
        ),
      ),
    );

    expect(core.refreshCount()).toBe(1);
    for (const response of [first, second]) {
      const next = new CookieJar();
      next.store(response);
      expect(next.names()).toEqual(["__Secure-cmo.account_data"]);
    }
  });

  it("replays renewal for a delayed request before the browser applies cookies", async () => {
    await signIn(auth, jar, core);
    vi.setSystemTime(Date.now() + (TWO_HOURS_S + 60) * 1000);
    const request = browserRequest(jar, "/");

    const first = await renewSession(auth, request.clone());
    const delayed = await renewSession(auth, request.clone());
    jar.store(first);
    jar.store(delayed);

    expect(core.refreshCount()).toBe(1);
    expect(await sessionUser(auth, jar)).not.toBeNull();
    expect(delayed.headers.getSetCookie()).toEqual(
      first.headers.getSetCookie(),
    );
  });

  it("shares renewal when unrelated cookies or cookie ordering change", async () => {
    await signIn(auth, jar, core);
    vi.setSystemTime(Date.now() + (TWO_HOURS_S + 60) * 1000);
    const firstCookies = jar.header();
    const secondCookies = `analytics=changed; ${firstCookies.split("; ").reverse().join("; ")}`;

    const responses = await Promise.all(
      [firstCookies, secondCookies].map((cookie) =>
        renewSession(auth, new Request(`${CMO}/`, { headers: { cookie } })),
      ),
    );
    for (const response of responses) jar.store(response);

    expect(core.refreshCount()).toBe(1);
    expect(await sessionUser(auth, jar)).not.toBeNull();
    expect(responses[0].headers.getSetCookie()).toEqual(
      responses[1].headers.getSetCookie(),
    );
  });

  it("shares renewal for reordered chunks of the same account cookie", async () => {
    await signIn(auth, jar, core);
    vi.setSystemTime(Date.now() + (TWO_HOURS_S + 60) * 1000);
    const cookie = jar
      .header()
      .split("; ")
      .find((pair) => pair.startsWith("__Secure-cmo.account_data="));
    expect(cookie).toBeDefined();
    const value = cookie?.slice("__Secure-cmo.account_data=".length) ?? "";
    const half = Math.floor(value.length / 2);
    const otherCookies = jar
      .header()
      .split("; ")
      .filter((pair) => !pair.startsWith("__Secure-cmo.account_data="));
    const chunks = [
      ...otherCookies,
      `__Secure-cmo.account_data.0=${value.slice(0, half)}`,
      `__Secure-cmo.account_data.1=${value.slice(half)}`,
    ];

    const responses = await Promise.all(
      [chunks.join("; "), chunks.reverse().join("; ")].map((cookies) =>
        renewSession(
          auth,
          new Request(`${CMO}/`, { headers: { cookie: cookies } }),
        ),
      ),
    );
    for (const response of responses) jar.store(response);

    expect(core.refreshCount()).toBe(1);
    expect(await sessionUser(auth, jar)).not.toBeNull();
  });

  it("stops replaying rotated cookies after the short grace window", async () => {
    await signIn(auth, jar, core);
    vi.useFakeTimers({ toFake: ["Date", "setTimeout", "clearTimeout"] });
    vi.setSystemTime(Date.now() + (TWO_HOURS_S + 60) * 1000);
    const request = browserRequest(jar, "/");
    const first = await renewSession(auth, request.clone());
    jar.store(first);

    await vi.advanceTimersByTimeAsync(31_000);
    const stale = await renewSession(auth, request.clone());
    jar.store(stale);

    expect(await sessionUser(auth, jar)).toBeNull();
    expect(stale.headers.getSetCookie()).not.toEqual(
      first.headers.getSetCookie(),
    );
  });

  it("renews an expired access token silently and keeps the rotated refresh token", async () => {
    await signIn(auth, jar, core);

    vi.setSystemTime(Date.now() + (TWO_HOURS_S + 60) * 1000);
    const first = await renew(auth, jar);
    expect(first.headers.getSetCookie().length).toBeGreaterThan(0);
    expect(core.refreshCount()).toBe(1);

    // The second renewal only succeeds with the rotated refresh token.
    vi.setSystemTime(Date.now() + (TWO_HOURS_S + 60) * 1000);
    await renew(auth, jar);
    expect(core.refreshCount()).toBe(2);
    expect(await sessionUser(auth, jar)).toEqual({
      name: "Ada Lovelace",
      email: "ada@example.com",
    });
  });

  it("takes the person's current name from Sokosumi when it renews", async () => {
    await signIn(auth, jar, core);
    core.user = { name: "Ada", firstName: "Augusta Ada", lastName: "King" };

    vi.setSystemTime(Date.now() + (TWO_HOURS_S + 60) * 1000);
    await renew(auth, jar);

    expect(await sessionUser(auth, jar)).toEqual({
      name: "Augusta Ada King",
      email: "ada@example.com",
    });
    // Rewriting the session keeps the rotated refresh token.
    vi.setSystemTime(Date.now() + (TWO_HOURS_S + 60) * 1000);
    await renew(auth, jar);
    expect(core.refreshCount()).toBe(2);
    expect(await sessionUser(auth, jar)).not.toBeNull();
  });

  it("keeps the name it has while Core cannot answer", async () => {
    await signIn(auth, jar, core);
    core.user = { name: "Ada", firstName: "Augusta Ada", lastName: "King" };
    core.userLookupDown = true;

    vi.setSystemTime(Date.now() + (TWO_HOURS_S + 60) * 1000);
    await renew(auth, jar);

    expect(await sessionUser(auth, jar)).toEqual({
      name: "Ada Lovelace",
      email: "ada@example.com",
    });
  });

  it("signs out when renewal fails", async () => {
    await signIn(auth, jar, core);
    core.revokeAll();

    vi.setSystemTime(Date.now() + (TWO_HOURS_S + 60) * 1000);
    const response = await renew(auth, jar);

    // 401 tells the proxy that CMO ended the session, not the person.
    expect(response.status).toBe(401);
    expect(await sessionUser(auth, jar)).toBeNull();
    expect(jar.names()).toEqual([]);
  });

  it("keeps a user banned after login until the next renewal", async () => {
    await signIn(auth, jar, core);
    core.refuseUser();

    await renew(auth, jar);
    expect(await sessionUser(auth, jar)).not.toBeNull();

    vi.setSystemTime(Date.now() + (TWO_HOURS_S + 60) * 1000);
    const response = await renew(auth, jar);

    expect(response.status).toBe(401);
    expect(await sessionUser(auth, jar)).toBeNull();
    expect(jar.names()).toEqual([]);
    // Sign-out revokes the token the renewal just rotated in.
    expect(core.revoked).toEqual(["soko_refresh_token_3"]);
  });

  it("preserves rotated tokens during a temporary Core identity outage", async () => {
    await signIn(auth, jar, core);
    vi.setSystemTime(Date.now() + (TWO_HOURS_S + 60) * 1000);
    core.userLookupDown = true;

    const unavailable = await renew(auth, jar);

    expect(unavailable.status).toBe(503);
    expect(core.revoked).toEqual([]);
    expect(await sessionUser(auth, jar)).not.toBeNull();

    core.userLookupDown = false;
    const recovered = await renew(auth, jar);
    expect(recovered.status).toBe(204);
    expect(core.refreshCount()).toBe(1);

    vi.setSystemTime(Date.now() + (TWO_HOURS_S + 60) * 1000);
    await renew(auth, jar);
    expect(core.refreshCount()).toBe(2);
    expect(await sessionUser(auth, jar)).not.toBeNull();
  });

  it.each(["network", 429, 500, 502] as const)(
    "keeps the session while Core's token endpoint fails (%s), then renews once Core is back",
    async (failure) => {
      await signIn(auth, jar, core);
      vi.useFakeTimers({ toFake: ["Date", "setTimeout", "clearTimeout"] });
      vi.setSystemTime(Date.now() + (TWO_HOURS_S + 60) * 1000);
      const cookies = jar.header();
      core.tokenFailure = failure;

      const unavailable = await renew(auth, jar);

      expect(unavailable.status).toBe(503);
      expect(unavailable.headers.getSetCookie()).toEqual([]);
      expect(jar.header()).toBe(cookies);
      expect(core.revoked).toEqual([]);

      core.tokenFailure = null;
      await vi.advanceTimersByTimeAsync(OUTAGE_BACKOFF_MS);
      const recovered = await renew(auth, jar);

      expect(recovered.status).toBe(204);
      expect(core.refreshCount()).toBe(1);
      expect(await sessionUser(auth, jar)).toEqual({
        name: "Ada Lovelace",
        email: "ada@example.com",
      });
    },
  );

  it("keeps the session while a new instance cannot discover Core, then renews once Core is back", async () => {
    await signIn(auth, jar, core);
    vi.setSystemTime(Date.now() + (TWO_HOURS_S + 60) * 1000);
    const cookies = jar.header();
    // getAuth builds a new instance after a failed discovery.
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});
    core.discoveryDown = true;
    const undiscovered = createCmoAuth(AUTH_CONFIG);

    const unavailable = await renew(undiscovered, jar);

    expect(unavailable.status).toBe(503);
    expect(jar.header()).toBe(cookies);
    expect(core.revoked).toEqual([]);

    core.discoveryDown = false;
    const recovered = await renew(createCmoAuth(AUTH_CONFIG), jar);
    logged.mockRestore();

    expect(recovered.status).toBe(204);
    expect(core.refreshCount()).toBe(1);
    expect(await sessionUser(auth, jar)).not.toBeNull();
  });

  it.each([400, 401, 403])(
    "signs out when Core's token endpoint refuses with %i",
    async (status) => {
      await signIn(auth, jar, core);
      vi.setSystemTime(Date.now() + (TWO_HOURS_S + 60) * 1000);
      core.tokenFailure = status;

      const response = await renew(auth, jar);

      expect(response.status).toBe(401);
      expect(await sessionUser(auth, jar)).toBeNull();
      expect(jar.names()).toEqual([]);
    },
  );

  it("asks Core again only after a pause while it is unreachable", async () => {
    await signIn(auth, jar, core);
    vi.useFakeTimers({ toFake: ["Date", "setTimeout", "clearTimeout"] });
    vi.setSystemTime(Date.now() + (TWO_HOURS_S + 60) * 1000);
    core.tokenFailure = 502;

    const statuses = [];
    for (let page = 0; page < 3; page += 1) {
      statuses.push((await renew(auth, jar)).status);
    }

    expect(statuses).toEqual([503, 503, 503]);
    expect(core.refreshAttempts).toBe(1);

    await vi.advanceTimersByTimeAsync(OUTAGE_BACKOFF_MS);
    await renew(auth, jar);
    expect(core.refreshAttempts).toBe(2);
  });

  it("serves a page the current access token without refreshing it", async () => {
    await signIn(auth, jar, core);
    vi.setSystemTime(Date.now() + (TWO_HOURS_S - 60) * 1000);

    const token = await getPageAccessToken(
      auth,
      new Headers({ cookie: jar.header() }),
    );

    expect(token).toEqual(expect.any(String));
    expect(core.refreshAttempts).toBe(0);
  });

  it("gives a page no token instead of refreshing an expired one", async () => {
    await signIn(auth, jar, core);
    const cookies = jar.header();
    vi.setSystemTime(Date.now() + (TWO_HOURS_S + 60) * 1000);

    const token = await getPageAccessToken(
      auth,
      new Headers({ cookie: cookies }),
    );

    // A page cannot write cookies: a refresh would rotate Core's refresh
    // token and lose the new one, so renewal stays with the proxy.
    expect(token).toBeNull();
    expect(core.refreshAttempts).toBe(0);
    await renew(auth, jar);
    expect(core.refreshCount()).toBe(1);
  });

  it("serves a valid access token while a new instance cannot discover Core", async () => {
    await signIn(auth, jar, core);
    const cookies = jar.header();
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});
    core.discoveryDown = true;

    const response = await renew(createCmoAuth(AUTH_CONFIG), jar);
    logged.mockRestore();

    expect(response.status).toBe(204);
    expect(jar.header()).toBe(cookies);
    expect(await sessionUser(auth, jar)).not.toBeNull();
  });

  it("signs out an account cookie for a provider CMO does not have", async () => {
    await signIn(auth, jar, core);
    const { secretConfig } = await auth.$context;
    const name = "__Secure-cmo.account_data";
    const value =
      jar
        .header()
        .split("; ")
        .find((pair) => pair.startsWith(`${name}=`))
        ?.slice(name.length + 1) ?? "";
    const account = await symmetricDecodeJWT<Record<string, unknown>>(
      value,
      secretConfig,
      "better-auth-account",
    );
    const forged = await symmetricEncodeJWT(
      { ...account, providerId: "github" },
      secretConfig,
      "better-auth-account",
      300,
    );
    jar.store(
      new Response(null, { headers: { "set-cookie": `${name}=${forged}` } }),
    );

    const response = await renew(auth, jar);

    expect(response.status).toBe(401);
    expect(jar.names()).toEqual([]);
  });

  it("does nothing for a signed-out visitor", async () => {
    const response = await renew(auth, jar);

    expect(response.status).toBe(204);
    expect(response.headers.getSetCookie()).toEqual([]);
  });

  it("signs out by revoking the refresh token at Core and clearing the cookies", async () => {
    await signIn(auth, jar, core);

    const response = await send(auth, jar, "/api/auth/sign-out", {
      method: "POST",
      body: {},
    });

    expect(response.status).toBe(200);
    expect(core.revoked).toEqual(["soko_refresh_token_2"]);
    expect(jar.names()).toEqual([]);
    expect(await sessionUser(auth, jar)).toBeNull();
  });

  it("revokes again after Core's discovery document was unavailable", async () => {
    await signIn(auth, jar, core);
    core.discoveryDown = true;
    await send(auth, jar, "/api/auth/sign-out", { method: "POST", body: {} });
    expect(core.revoked).toEqual([]);
    expect(jar.names()).toEqual([]);

    core.discoveryDown = false;
    await signIn(auth, jar, core);
    await send(auth, jar, "/api/auth/sign-out", { method: "POST", body: {} });

    expect(core.revoked).toEqual(["soko_refresh_token_4"]);
  });

  it("rate limits each visitor by their own IP", async () => {
    async function startFrom(ip: string) {
      const request = browserRequest(
        new CookieJar(),
        "/api/auth/sign-in/social",
        {
          method: "POST",
          body: { provider: "sokosumi", callbackURL: "/" },
        },
      );
      request.headers.set("x-vercel-forwarded-for", ip);
      return (await auth.handler(request)).status;
    }

    // Better Auth allows three sign-in starts per 10 seconds per client.
    const visitors = await Promise.all(
      ["203.0.113.1", "203.0.113.2", "203.0.113.3", "203.0.113.4"].map(
        startFrom,
      ),
    );
    expect(visitors).toEqual([200, 200, 200, 200]);

    const repeats = [];
    for (let attempt = 0; attempt < 3; attempt += 1) {
      repeats.push(await startFrom("203.0.113.1"));
    }
    expect(repeats.at(-1)).toBe(429);
  });

  it("keeps the session when others on the same IP fill renewal's rate limit", async () => {
    // An office or carrier NAT: every page load renews, signed in or not.
    await signIn(auth, jar, core);
    for (let visit = 0; visit < 120; visit += 1) {
      const anonymous = browserRequest(new CookieJar(), "/");
      anonymous.headers.set("x-vercel-forwarded-for", jar.ip);
      await renewSession(auth, anonymous);
    }

    const response = await renew(auth, jar);

    expect(response.status).toBe(204);
    expect(core.revoked).toEqual([]);
    expect(await sessionUser(auth, jar)).toEqual({
      name: "Ada Lovelace",
      email: "ada@example.com",
    });
  });

  it("renews with the visitor's IP, not one shared bucket", async () => {
    await signIn(auth, jar, core);
    const seen: (string | null)[] = [];
    const handler = auth.handler;
    auth.handler = (request: Request) => {
      seen.push(request.headers.get("x-vercel-forwarded-for"));
      return handler(request);
    };

    const page = browserRequest(jar, "/");
    page.headers.set("x-vercel-forwarded-for", "203.0.113.9");
    await renewSession(auth, page);

    expect(seen).toEqual(["203.0.113.9"]);
  });

  it("returns to the signed-out page when consent is declined", async () => {
    const { state } = core.approve(await startSignIn(auth, jar));

    const response = await send(
      auth,
      jar,
      `/api/auth/callback/sokosumi?error=access_denied&state=${state}`,
    );

    expect(response.status).toBe(302);
    expect(response.headers.get("location")).toBe("/?error=access_denied");
    expect(await sessionUser(auth, jar)).toBeNull();
  });

  it("refuses a user Core does not accept", async () => {
    const { code, state } = core.approve(await startSignIn(auth, jar));
    core.refuseUser();

    const response = await send(
      auth,
      jar,
      `/api/auth/callback/sokosumi?code=${code}&state=${state}`,
    );

    expect(response.headers.get("location")).toMatch(/^\/\?error=/);
    expect(await sessionUser(auth, jar)).toBeNull();
  });
});
