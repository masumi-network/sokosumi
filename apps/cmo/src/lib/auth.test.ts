import {
  calculateJwkThumbprint,
  exportJWK,
  generateKeyPair,
  type JWK,
  SignJWT,
} from "jose";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { type CmoAuth, createCmoAuth, renewSession } from "./auth";

const CMO = "https://cmo.xyz";
const PREVIEW = "https://cmo-git-sok-1.preview.sokosumi.com";
const PROXY_SECRET = "a-proxy-secret-shared-by-production-and-previews";
const CORE = "https://core.test";
const ISSUER = `${CORE}/auth`;
const CLIENT_ID = "cmo-client";
const CLIENT_SECRET = "cmo-secret";
const CALLBACK = `${CMO}/api/auth/callback/sokosumi`;
const TWO_HOURS_S = 7_200;

interface FakeCore {
  fetch: typeof fetch;
  /** Authorize URL query of the last sign-in, as the browser would send it. */
  approve(authorizeUrl: string): { code: string; state: string };
  refreshCount(): number;
  revoked: string[];
  revokeAll(): void;
  /** Core refuses the user on `/v1`, as for a banned or deleted account. */
  refuseUser(): void;
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

  function hasClientCredentials(request: Request, form: URLSearchParams) {
    const basic = request.headers.get("authorization");
    if (basic?.startsWith("Basic ")) {
      return (
        atob(basic.slice(6)) ===
        `${encodeURIComponent(CLIENT_ID)}:${encodeURIComponent(CLIENT_SECRET)}`
      );
    }
    return (
      form.get("client_id") === CLIENT_ID &&
      form.get("client_secret") === CLIENT_SECRET
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
        const bearer = request.headers.get("authorization")?.slice(7) ?? "";
        if (userRefused || !accessTokens.has(bearer)) {
          return json({ error: "Unauthorized" }, 401);
        }
        return json({
          data: {
            id: "user_1",
            createdAt: "2026-01-01T00:00:00.000Z",
            updatedAt: "2026-01-01T00:00:00.000Z",
            name: "Ada Lovelace",
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

  return {
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
    revoked,
    revokeAll() {
      for (const token of refreshTokens) revoked.push(token);
      refreshTokens.clear();
      accessTokens.clear();
    },
    refuseUser() {
      userRefused = true;
    },
  };
}

/** A browser's cookie jar for one origin. */
class CookieJar {
  private cookies = new Map<string, string>();

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
  const headers = new Headers({ cookie: jar.header(), origin: jar.origin });
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

async function startSignIn(auth: CmoAuth, jar: CookieJar): Promise<string> {
  const response = await send(auth, jar, "/api/auth/sign-in/social", {
    method: "POST",
    body: { provider: "sokosumi", callbackURL: "/", errorCallbackURL: "/" },
  });
  expect(response.status).toBe(200);
  const { url } = (await response.json()) as { url: string };
  return url;
}

function callbackPath({ code, state }: { code: string; state: string }) {
  return `/api/auth/callback/sokosumi?code=${code}&state=${encodeURIComponent(state)}&iss=${encodeURIComponent(ISSUER)}`;
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
    // Production runs the proxy for previews and skips it for itself.
    auth = createCmoAuth({
      baseURL: CMO,
      coreBaseUrl: CORE,
      clientId: CLIENT_ID,
      clientSecret: CLIENT_SECRET,
      secret: "a-cookie-secret-that-is-at-least-32-characters",
      oauthProxy: { productionURL: CMO, secret: PROXY_SECRET },
    });
    jar = new CookieJar();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
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

  it("keeps the Sokosumi tokens out of readable cookies", async () => {
    await signIn(auth, jar, core);

    expect(jar.header()).not.toContain("soko_access_token_");
    expect(jar.header()).not.toContain("soko_refresh_token_");
  });

  it("leaves a fresh session alone", async () => {
    await signIn(auth, jar, core);

    const response = await renew(auth, jar);

    expect(response.headers.getSetCookie()).toEqual([]);
    expect(core.refreshCount()).toBe(0);
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

  it("signs out when renewal fails", async () => {
    await signIn(auth, jar, core);
    core.revokeAll();

    vi.setSystemTime(Date.now() + (TWO_HOURS_S + 60) * 1000);
    await renew(auth, jar);

    expect(await sessionUser(auth, jar)).toBeNull();
    expect(jar.names()).toEqual([]);
  });

  it("does nothing for a signed-out visitor", async () => {
    const response = await renew(auth, jar);

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

  it("signs a preview in through production CMO's proxy", async () => {
    const preview = createCmoAuth({
      baseURL: PREVIEW,
      coreBaseUrl: CORE,
      clientId: CLIENT_ID,
      clientSecret: CLIENT_SECRET,
      secret: "a-preview-cookie-secret-of-at-least-32-characters",
      oauthProxy: { productionURL: CMO, secret: PROXY_SECRET },
    });
    const previewJar = new CookieJar(PREVIEW);

    const authorizeUrl = await startSignIn(preview, previewJar);
    expect(new URL(authorizeUrl).searchParams.get("redirect_uri")).toBe(
      CALLBACK,
    );

    // Core sends the browser to production, which hands off to the preview.
    const handoff = await send(
      auth,
      jar,
      callbackPath(core.approve(authorizeUrl)),
    );
    const location = new URL(handoff.headers.get("location") ?? "");
    expect(location.origin).toBe(PREVIEW);
    expect(jar.names()).toEqual([]);

    const done = await send(
      preview,
      previewJar,
      `${location.pathname}${location.search}`,
    );
    expect(done.headers.get("location")).toBe("/");
    expect(await sessionUser(preview, previewJar)).toEqual({
      name: "Ada Lovelace",
      email: "ada@example.com",
    });

    // The preview received the refresh token and renews on its own.
    vi.setSystemTime(Date.now() + (TWO_HOURS_S + 60) * 1000);
    await renew(preview, previewJar);
    expect(core.refreshCount()).toBe(1);
    expect(await sessionUser(preview, previewJar)).not.toBeNull();
  });
});
