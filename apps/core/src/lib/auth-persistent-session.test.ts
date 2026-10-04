import { oauthProvider } from "@better-auth/oauth-provider";
import { memoryAdapter } from "better-auth/adapters/memory";
import { createAuthMiddleware } from "better-auth/api";
import { betterAuth } from "better-auth/minimal";
import { jwt } from "better-auth/plugins";
import { emailOTP } from "better-auth/plugins/email-otp";
import { describe, expect, it } from "vitest";

import { emailCodeSignIn } from "./auth-email-code-sign-in";
import { keepNewSessionPersistent } from "./auth-persistent-session";

const CORE = "https://auth.example.com";
const WEB = "https://app.example.com";
const CMO_CALLBACK = "https://cmo.example.com/callback";
const EMAIL = "user@example.com";

// Core's email code sign-in and OAuth provider on an in-memory store, with
// the persistent-session after hook.
function createAuth() {
  const now = new Date();
  const codes = new Map<string, string>();
  const auth = betterAuth({
    baseURL: CORE,
    basePath: "/auth",
    secret: "test-secret-that-is-long-enough-for-better-auth",
    database: memoryAdapter({
      user: [
        {
          id: "user-1",
          email: EMAIL,
          name: "User",
          emailVerified: true,
          createdAt: now,
          updatedAt: now,
        },
      ],
      session: [],
      account: [],
      verification: [],
      jwks: [],
      oauthClient: [
        {
          id: "client-row-1",
          clientId: "cmo",
          public: true,
          disabled: false,
          skipConsent: true,
          tokenEndpointAuthMethod: "none",
          grantTypes: ["authorization_code"],
          responseTypes: ["code"],
          redirectUris: [CMO_CALLBACK],
          createdAt: now,
          updatedAt: now,
        },
      ],
      oauthAccessToken: [],
      oauthRefreshToken: [],
      oauthConsent: [],
    }),
    trustedOrigins: [WEB],
    hooks: { after: createAuthMiddleware(keepNewSessionPersistent) },
    plugins: [
      jwt({ disableSettingJwtHeader: true }),
      emailCodeSignIn(
        emailOTP({
          sendVerificationOTP: async ({ email, otp }) => {
            codes.set(email, otp);
          },
        }),
      ),
      oauthProvider({
        loginPage: `${WEB}/signin`,
        consentPage: `${WEB}/oauth/consent`,
      }),
    ],
    rateLimit: { enabled: false },
  });

  function post(path: string, body: object) {
    return auth.handler(
      new Request(`${CORE}/auth${path}`, {
        method: "POST",
        headers: { "content-type": "application/json", origin: WEB },
        body: JSON.stringify(body),
      }),
    );
  }

  return { auth, codes, post };
}

describe("keepNewSessionPersistent", () => {
  it("sends a CMO sign-in with an email code to CMO, on a persistent cookie", async () => {
    const { auth, codes, post } = createAuth();
    const query = new URLSearchParams({
      response_type: "code",
      client_id: "cmo",
      redirect_uri: CMO_CALLBACK,
      scope: "openid",
      state: "state-1",
      code_challenge: "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGcSZ7j9Gc",
      code_challenge_method: "S256",
    });
    const authorize = await auth.handler(
      new Request(`${CORE}/auth/oauth2/authorize?${query}`),
    );
    const signin = new URL(authorize.headers.get("location") ?? "");
    expect(signin.origin + signin.pathname).toBe(`${WEB}/signin`);

    await post("/email-otp/send-verification-otp", {
      email: EMAIL,
      type: "sign-in",
    });
    // The provider resumes authorize through the after hooks; setting the
    // cookie again there made it resume again, and this never answered.
    const response = await post("/sign-in/email-otp", {
      email: EMAIL,
      otp: codes.get(EMAIL),
      oauth_query: signin.searchParams.toString(),
    });

    const result = await response.json();
    expect(result, JSON.stringify(result)).toMatchObject({ redirect: true });
    const target = new URL(result.url);
    expect(target.origin + target.pathname).toBe(CMO_CALLBACK);
    expect(target.searchParams.get("state")).toBe("state-1");
    expect(target.searchParams.has("code")).toBe(true);
    expect(
      response.headers
        .getSetCookie()
        .find((cookie) => cookie.includes("session_token=")),
    ).toMatch(/Max-Age=\d+/);
  }, 5_000);
});
