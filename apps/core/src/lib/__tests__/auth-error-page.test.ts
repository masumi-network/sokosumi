import { oauthProvider } from "@better-auth/oauth-provider";
import { memoryAdapter } from "better-auth/adapters/memory";
import { betterAuth } from "better-auth/minimal";
import { jwt } from "better-auth/plugins";
import { describe, expect, it } from "vitest";

const CORE = "https://auth.example.com";
const WEB = "https://app.example.com";

// Better Auth's own dispatcher on an in-memory store, with Core's error page
// (`onAPIError` in `auth.ts`). auth.test.ts mocks Better Auth, so it cannot
// see which failures honour it.
function createCore() {
  const auth = betterAuth({
    baseURL: CORE,
    basePath: "/auth",
    secret: "test-secret-that-is-long-enough-for-better-auth",
    database: memoryAdapter({
      user: [],
      session: [],
      account: [],
      verification: [],
      jwks: [],
      oauthClient: [],
      oauthAccessToken: [],
      oauthRefreshToken: [],
      oauthConsent: [],
    }),
    socialProviders: {
      google: {
        clientId: "google-client-id",
        clientSecret: "google-client-secret",
      },
    },
    plugins: [
      jwt({ disableSettingJwtHeader: true }),
      oauthProvider({
        loginPage: `${WEB}/signin`,
        consentPage: `${WEB}/oauth/consent`,
      }),
    ],
    onAPIError: { errorURL: `${WEB}/auth/error` },
    trustedOrigins: [WEB],
    rateLimit: { enabled: false },
  });
  return async (path: string, init?: RequestInit) => {
    const response = await auth.handler(new Request(`${CORE}${path}`, init));
    return response.headers.has("location")
      ? new URL(response.headers.get("location") ?? "", CORE)
      : new URL((await response.json()).url);
  };
}

describe("Better Auth error page", () => {
  it("sends a social callback whose state is gone to Sokosumi's error page", async () => {
    const handle = createCore();

    // Started more than ten minutes ago, or in another browser: Core holds no
    // state for it, and Google's callback carries no error URL of its own.
    const location = await handle(
      "/auth/callback/google?code=google-code&state=forgotten-state",
    );

    expect(`${location.origin}${location.pathname}`).toBe(`${WEB}/auth/error`);
    expect(location.searchParams.get("error")).toBe("state_mismatch");
  });

  it("sends an authorize request from an unknown client to Sokosumi's error page", async () => {
    const handle = createCore();
    const query = new URLSearchParams({
      response_type: "code",
      client_id: "unknown-client",
      redirect_uri: "https://unknown.example.com/callback",
      scope: "openid",
      state: "state-1",
      code_challenge: "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGcSZ7j9Gc",
      code_challenge_method: "S256",
    });

    const location = await handle(`/auth/oauth2/authorize?${query}`);

    expect(`${location.origin}${location.pathname}`).toBe(`${WEB}/auth/error`);
    expect(location.searchParams.get("error")).toBe("invalid_client");
  });

  it("keeps the error page a social sign-in names for itself", async () => {
    const handle = createCore();
    const signIn = await handle("/auth/sign-in/social", {
      method: "POST",
      headers: { "content-type": "application/json", origin: WEB },
      body: JSON.stringify({
        provider: "google",
        callbackURL: `${WEB}/auth/callback/signin`,
        errorCallbackURL: `${WEB}/signin`,
      }),
    });
    const state = signIn.searchParams.get("state");

    // Core still holds the state, but the callback reached a browser without
    // its state cookie.
    const location = await handle(
      `/auth/callback/google?code=google-code&state=${state}`,
    );

    expect(`${location.origin}${location.pathname}`).toBe(`${WEB}/signin`);
    expect(location.searchParams.get("error")).toBe("state_mismatch");
  });
});
