import { memoryAdapter } from "better-auth/adapters/memory";
import { createAuthMiddleware } from "better-auth/api";
import { signJWT } from "better-auth/crypto";
import { betterAuth } from "better-auth/minimal";
import { oAuthProxy } from "better-auth/plugins";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { EnvConfig } from "@/config/env";
import { asServedOnVercel } from "@/test-fixtures/served-on-vercel";
import { refuseOAuthProxyCompletionOutsidePreview } from "./auth-oauth-proxy";

const PRODUCTION = "https://api.example.com";
const PREVIEW = "https://core-pr.preview.example.com";
const WEB = "https://app.example.com";
const WEB_PREVIEW = "https://app-pr.preview.example.com";
const PRODUCTION_AUTH_SECRET = "production-auth-secret-32-characters-long";
const PREVIEW_AUTH_SECRET = "preview-auth-secret-32-characters-long-too";
const PROXY_SECRET = "shared-oauth-proxy-secret-32-characters";
const GOOGLE_TOKEN_ENDPOINT = "https://oauth2.googleapis.com/token";

type MemoryDb = Record<string, Record<string, unknown>[]>;

interface CoreOptions {
  baseURL: string;
  vercelEnv: EnvConfig["VERCEL_ENV"];
  authSecret: string;
  proxySecret?: string;
}

// Core's proxy wiring on Better Auth's own dispatcher and an in-memory store.
// auth.test.ts mocks Better Auth, so it cannot see a route template or a key
// change in an upgrade. Only Google's token endpoint is stubbed.
function createCore({
  baseURL,
  vercelEnv,
  authSecret,
  proxySecret,
}: CoreOptions) {
  const db: MemoryDb = { user: [], session: [], account: [], verification: [] };
  const auth = betterAuth({
    baseURL,
    basePath: "/auth",
    secret: authSecret,
    database: memoryAdapter(db),
    trustedOrigins: [WEB, "https://*.preview.example.com"],
    socialProviders: {
      google: {
        clientId: "google-client-id",
        clientSecret: "google-client-secret",
      },
    },
    plugins: [
      oAuthProxy({
        productionURL: PRODUCTION,
        currentURL: baseURL,
        secret: proxySecret,
      }),
    ],
    hooks: {
      before: createAuthMiddleware(async (ctx) => {
        refuseOAuthProxyCompletionOutsidePreview(ctx.path, vercelEnv);
      }),
    },
    rateLimit: { enabled: false },
  });
  return { auth, db };
}

function createProduction(proxySecret?: string) {
  return createCore({
    baseURL: PRODUCTION,
    vercelEnv: "production",
    authSecret: PRODUCTION_AUTH_SECRET,
    proxySecret,
  });
}

function createPreview(proxySecret?: string) {
  return createCore({
    baseURL: PREVIEW,
    vercelEnv: "preview",
    authSecret: PREVIEW_AUTH_SECRET,
    proxySecret,
  });
}

type Core = ReturnType<typeof createCore>;

/** Starts Google sign-in on the preview and follows Google back to production. */
async function signInThroughProduction(preview: Core, production: Core) {
  const started = await preview.auth.handler(
    new Request(asServedOnVercel(`${PREVIEW}/auth/sign-in/social`), {
      method: "POST",
      headers: { "content-type": "application/json", origin: WEB_PREVIEW },
      body: JSON.stringify({
        provider: "google",
        callbackURL: `${WEB_PREVIEW}/`,
      }),
    }),
  );
  const { url } = (await started.json()) as { url: string };
  const google = new URL(url);

  const callback = new URL(google.searchParams.get("redirect_uri") ?? "");
  callback.searchParams.set("state", google.searchParams.get("state") ?? "");
  callback.searchParams.set("code", "google-code");
  const returned = await production.auth.handler(
    new Request(asServedOnVercel(callback.href)),
  );

  return {
    redirectUri: google.searchParams.get("redirect_uri"),
    handOff: new URL(returned.headers.get("location") ?? ""),
  };
}

describe("OAuth proxy between a preview and production", () => {
  beforeEach(async () => {
    // Better Auth reads the Google profile from the ID token without
    // verifying it on this path, so any signing key does.
    const idToken = await signJWT(
      {
        sub: "google-sub",
        email: "ada@example.com",
        email_verified: true,
        name: "Ada",
      },
      "not-googles-key",
    );
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        Response.json({
          access_token: "ya29.access",
          id_token: idToken,
          token_type: "Bearer",
          expires_in: 3600,
        }),
      ),
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it("signs a preview in through production when only the proxy secret is shared", async () => {
    // The hand-off must come back to the branch URL, not this deployment's.
    vi.stubEnv("VERCEL_URL", "core-abc123.preview.example.com");
    const production = createProduction(PROXY_SECRET);
    const preview = createPreview(PROXY_SECRET);

    const { redirectUri, handOff } = await signInThroughProduction(
      preview,
      production,
    );

    expect(redirectUri).toBe(`${PRODUCTION}/auth/callback/google`);
    expect(vi.mocked(fetch).mock.calls.map(([url]) => String(url))).toEqual([
      GOOGLE_TOKEN_ENDPOINT,
    ]);
    expect(`${handOff.origin}${handOff.pathname}`).toBe(
      `${PREVIEW}/auth/callback/google/oauth-proxy`,
    );

    const completed = await preview.auth.handler(
      new Request(asServedOnVercel(handOff.href)),
    );

    expect(completed.headers.get("location")).toBe(`${WEB_PREVIEW}/`);
    expect(preview.db.user).toMatchObject([{ email: "ada@example.com" }]);
    expect(preview.db.session).toHaveLength(1);
    expect(production.db.user).toEqual([]);
    expect(production.db.session).toEqual([]);
  });

  it("signs production in without the proxy behind Vercel's TLS termination", async () => {
    vi.stubEnv("VERCEL_URL", "core-abc123.preview.example.com");
    const production = createProduction(PROXY_SECRET);

    const started = await production.auth.handler(
      new Request(asServedOnVercel(`${PRODUCTION}/auth/sign-in/social`), {
        method: "POST",
        headers: { "content-type": "application/json", origin: WEB },
        body: JSON.stringify({ provider: "google", callbackURL: `${WEB}/` }),
      }),
    );
    const { url } = (await started.json()) as { url: string };
    const google = new URL(url);
    const redirectUri = google.searchParams.get("redirect_uri") ?? "";

    const callback = new URL(asServedOnVercel(redirectUri));
    callback.searchParams.set("state", google.searchParams.get("state") ?? "");
    callback.searchParams.set("code", "google-code");
    const returned = await production.auth.handler(
      new Request(callback, {
        headers: {
          cookie: started.headers
            .getSetCookie()
            .map((cookie) => cookie.split(";")[0])
            .join("; "),
        },
      }),
    );

    expect(redirectUri).toBe(`${PRODUCTION}/auth/callback/google`);
    expect(returned.headers.get("location")).toBe(`${WEB}/`);
    expect(production.db.session).toHaveLength(1);
  });

  it("cannot read a preview's state without a shared proxy secret", async () => {
    const production = createProduction();
    const preview = createPreview();

    const { handOff } = await signInThroughProduction(preview, production);

    expect(handOff.searchParams.get("error")).toBe("state_mismatch");
    expect(fetch).not.toHaveBeenCalled();
  });

  it.each(["/auth/callback/google/oauth-proxy", "/auth/oauth-proxy-callback"])(
    "answers 404 on production for %s, even with a valid hand-off",
    async (path) => {
      const production = createProduction(PROXY_SECRET);
      const preview = createPreview(PROXY_SECRET);
      const { handOff } = await signInThroughProduction(preview, production);

      const replayed = await production.auth.handler(
        new Request(asServedOnVercel(`${PRODUCTION}${path}${handOff.search}`)),
      );

      expect(replayed.status).toBe(404);
      expect(production.db.session).toEqual([]);
    },
  );
});

describe("refuseOAuthProxyCompletionOutsidePreview", () => {
  it.each(["production", "development", undefined] as const)(
    "refuses the completion endpoints when VERCEL_ENV is %s",
    (vercelEnv) => {
      for (const path of [
        "/callback/:id/oauth-proxy",
        "/oauth-proxy-callback",
      ]) {
        expect(() =>
          refuseOAuthProxyCompletionOutsidePreview(path, vercelEnv),
        ).toThrow(expect.objectContaining({ status: "NOT_FOUND" }));
      }
    },
  );

  it("leaves every other route alone", () => {
    expect(() =>
      refuseOAuthProxyCompletionOutsidePreview("/callback/:id", "production"),
    ).not.toThrow();
  });
});
