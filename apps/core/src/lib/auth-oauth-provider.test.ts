import { createHash } from "node:crypto";
import { setTimeout } from "node:timers/promises";
import { oauthProvider } from "@better-auth/oauth-provider";
import { memoryAdapter } from "better-auth/adapters/memory";
import { createAuthMiddleware } from "better-auth/api";
import { betterAuth } from "better-auth/minimal";
import { jwt } from "better-auth/plugins";
import { emailOTP } from "better-auth/plugins/email-otp";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { isProductionEnvironment } from "@/config/env";
import { emailCodeSignIn } from "./auth-email-code-sign-in";
import { afterNewSession } from "./auth-new-session";
import {
  acceptCmoPreviewCallback,
  handleOAuthTokenRequest,
  isRefreshTokenRotating,
  jwtKeyStoreOptions,
  oauthRefreshTokenOptions,
} from "./auth-oauth-provider";
import { OAUTH_REFRESH_TOKEN_PREFIX } from "./auth-oauth-token-prefixes";

type MemoryDb = Record<string, Record<string, unknown>[]>;

const CLIENT_ID = "cmo-client";
const USER_ID = "user-1";
const SEED_REFRESH_TOKEN = `${OAUTH_REFRESH_TOKEN_PREFIX}seed-refresh-token`;
const NOW = new Date("2026-09-29T12:00:00.000Z");

// The provider stores SHA-256 base64url digests of refresh tokens.
function hashToken(token: string) {
  return createHash("sha256").update(token).digest("base64url");
}

function createDb(): MemoryDb {
  return {
    user: [
      {
        id: USER_ID,
        email: "user@example.com",
        name: "User",
        emailVerified: true,
        createdAt: NOW,
        updatedAt: NOW,
      },
    ],
    session: [],
    account: [],
    verification: [],
    jwks: [],
    oauthClient: [
      {
        id: "client-row-1",
        clientId: CLIENT_ID,
        public: true,
        disabled: false,
        tokenEndpointAuthMethod: "none",
        grantTypes: ["authorization_code", "refresh_token"],
        redirectUris: ["https://cmo.example.com/callback"],
        createdAt: NOW,
        updatedAt: NOW,
      },
    ],
    oauthAccessToken: [],
    oauthRefreshToken: [
      {
        id: "refresh-row-1",
        token: hashToken("seed-refresh-token"),
        clientId: CLIENT_ID,
        userId: USER_ID,
        sessionId: "session-1",
        scopes: ["offline_access"],
        createdAt: NOW,
        expiresAt: new Date(NOW.getTime() + 86_400_000),
        revoked: null,
      },
    ],
    oauthConsent: [],
  };
}

// Better Auth's own token endpoint on an in-memory store, with Core's refresh
// token options.
function createTestAuth(
  db: MemoryDb,
  { replayDelay = 0, rateLimitEnabled = false } = {},
) {
  const adapter = memoryAdapter(db);
  const delayedAdapter: typeof adapter = (options) => {
    const instance = adapter(options);
    const update: typeof instance.update = async (input) => {
      if (
        replayDelay &&
        input.model === "oauthRefreshToken" &&
        "rotationReplayResponse" in input.update
      ) {
        await setTimeout(replayDelay);
      }
      return instance.update(input);
    };
    return { ...instance, update };
  };
  const auth = betterAuth({
    baseURL: "https://auth.example.com",
    basePath: "/auth",
    secret: "test-secret-that-is-long-enough-for-better-auth",
    database: delayedAdapter,
    plugins: [
      jwt({ disableSettingJwtHeader: true }),
      oauthProvider({
        loginPage: "https://app.example.com/signin",
        consentPage: "https://app.example.com/oauth/consent",
        ...oauthRefreshTokenOptions,
        prefix: { refreshToken: OAUTH_REFRESH_TOKEN_PREFIX },
        rateLimit: { token: { max: 2, window: 60 } },
      }),
    ],
    rateLimit: { enabled: rateLimitEnabled, storage: "memory" },
  });

  const retry = vi.fn<Parameters<typeof handleOAuthTokenRequest>[2]>(
    (body, request) =>
      auth.api.oauth2Token({
        body,
        request,
        headers: request.headers,
        asResponse: true,
      }),
  );

  // The same check the route runs against Prisma, on the in-memory rows.
  function isRotating(refreshToken: string) {
    return isRefreshTokenRotating(
      refreshToken,
      OAUTH_REFRESH_TOKEN_PREFIX,
      async (storedToken) => {
        const row = db.oauthRefreshToken.find(
          (candidate) => candidate.token === storedToken,
        );
        return row
          ? {
              rotatedAt: (row.rotatedAt as Date | undefined) ?? null,
              rotationReplayExpiresAt:
                (row.rotationReplayExpiresAt as Date | undefined) ?? null,
            }
          : null;
      },
    );
  }

  async function refresh(refreshToken: string) {
    const response = await handleOAuthTokenRequest(
      new Request("https://auth.example.com/auth/oauth2/token", {
        method: "POST",
        headers: {
          "content-type": "application/x-www-form-urlencoded",
          "x-forwarded-for": "198.51.100.1",
        },
        body: new URLSearchParams({
          grant_type: "refresh_token",
          refresh_token: refreshToken,
          client_id: CLIENT_ID,
        }).toString(),
      }),
      auth.handler,
      retry,
      isRotating,
    );
    return {
      status: response.status,
      body: (await response.json()) as Record<string, unknown>,
    };
  }

  return { refresh, retry };
}

describe("oauthRefreshTokenOptions", () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(NOW);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("returns the same tokens to overlapping refresh requests", async () => {
    const db = createDb();
    const { refresh } = createTestAuth(db);

    const responses = await Promise.all([
      refresh(SEED_REFRESH_TOKEN),
      refresh(SEED_REFRESH_TOKEN),
    ]);

    expect(responses.map((response) => response.status)).toEqual([200, 200]);
    expect(responses[1].body.access_token).toBe(responses[0].body.access_token);
    expect(responses[1].body.refresh_token).toBe(
      responses[0].body.refresh_token,
    );
  });

  it("waits for an in-progress rotation to persist its replay", async () => {
    const db = createDb();
    const { refresh } = createTestAuth(db, { replayDelay: 900 });

    const responses = await Promise.all([
      refresh(SEED_REFRESH_TOKEN),
      refresh(SEED_REFRESH_TOKEN),
    ]);

    expect(responses.map((response) => response.status)).toEqual([200, 200]);
    expect(responses[1].body.refresh_token).toBe(
      responses[0].body.refresh_token,
    );
  });

  it("counts each incoming request once while retaining the rate limit", async () => {
    const db = createDb();
    const { refresh } = createTestAuth(db, { rateLimitEnabled: true });

    const responses = await Promise.all([
      refresh(SEED_REFRESH_TOKEN),
      refresh(SEED_REFRESH_TOKEN),
    ]);

    expect(responses.map((response) => response.status)).toEqual([200, 200]);
    const third = await refresh(String(responses[0].body.refresh_token));
    expect(third.status).toBe(429);
  });

  it("replays the rotation response when a rotated token is reused within 30 seconds", async () => {
    const db = createDb();
    const { refresh } = createTestAuth(db);

    const first = await refresh(SEED_REFRESH_TOKEN);
    expect(first.status).toBe(200);

    vi.setSystemTime(new Date(NOW.getTime() + 29_000));
    const second = await refresh(SEED_REFRESH_TOKEN);

    expect(second.status).toBe(200);
    expect(second.body.access_token).toBe(first.body.access_token);
    expect(second.body.refresh_token).toBe(first.body.refresh_token);

    // The family is still valid: the replayed refresh token rotates normally.
    const next = await refresh(String(second.body.refresh_token));
    expect(next.status).toBe(200);
    expect(next.body.refresh_token).not.toBe(second.body.refresh_token);
  });

  it("does not retry a refresh token that was never rotated", async () => {
    const db = createDb();
    db.oauthRefreshToken[0].expiresAt = new Date(NOW.getTime() - 1_000);
    const { refresh, retry } = createTestAuth(db);

    const response = await refresh(SEED_REFRESH_TOKEN);

    expect(response.status).toBe(400);
    expect(response.body).toEqual({
      error: "invalid_grant",
      error_description: "invalid refresh token",
    });
    expect(retry).not.toHaveBeenCalled();
  });

  it("rejects reuse after 30 seconds and invalidates the token family", async () => {
    const db = createDb();
    const { refresh } = createTestAuth(db);

    const first = await refresh(SEED_REFRESH_TOKEN);
    expect(first.status).toBe(200);

    vi.setSystemTime(new Date(NOW.getTime() + 31_000));
    const reuse = await refresh(SEED_REFRESH_TOKEN);

    expect(reuse.status).toBe(400);
    expect(reuse.body.error).toBe("invalid_grant");
    expect(db.oauthRefreshToken).toEqual([]);

    const afterReuse = await refresh(String(first.body.refresh_token));
    expect(afterReuse.status).toBe(400);
    expect(afterReuse.body.error).toBe("invalid_grant");
  });
});

describe("handleOAuthTokenRequest", () => {
  it.each([
    { body: "grant_type=authorization_code" },
    { body: "grant_type=refresh_token&client_assertion=single-use-assertion" },
    { body: "grant_type=refresh_token", headers: { dpop: "single-use-proof" } },
  ])(
    "leaves other grants and single-use proofs untouched (%j)",
    async ({ body, headers }) => {
      const response = new Response("{}", { status: 400 });
      const handler = vi.fn().mockResolvedValue(response);
      const retry = vi.fn();
      const request = new Request(
        "https://auth.example.com/auth/oauth2/token",
        {
          method: "POST",
          headers: {
            "content-type": "application/x-www-form-urlencoded",
            ...headers,
          },
          body,
        },
      );

      expect(
        await handleOAuthTokenRequest(request, handler, retry, vi.fn()),
      ).toBe(response);
      expect(handler).toHaveBeenCalledExactlyOnceWith(request);
      expect(retry).not.toHaveBeenCalled();
    },
  );

  it.each([
    [
      429,
      { error: "invalid_grant", error_description: "invalid refresh token" },
    ],
    [
      400,
      { error: "invalid_client", error_description: "invalid refresh token" },
    ],
    [400, { error: "invalid_grant", error_description: "session not found" }],
  ])("preserves non-rotation errors (%s %j)", async (status, body) => {
    const response = Response.json(body, { status });
    const handler = vi.fn().mockResolvedValue(response);
    const retry = vi.fn();
    const request = new Request("https://auth.example.com/auth/oauth2/token", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: "grant_type=refresh_token",
    });

    expect(
      await handleOAuthTokenRequest(request, handler, retry, vi.fn()),
    ).toBe(response);
    expect(handler).toHaveBeenCalledOnce();
    expect(retry).not.toHaveBeenCalled();
  });

  it("stops when the refresh token has no open rotation", async () => {
    const response = Response.json(
      { error: "invalid_grant", error_description: "invalid refresh token" },
      { status: 400 },
    );
    const handler = vi.fn().mockResolvedValue(response);
    const retry = vi.fn();
    const isRotating = vi.fn().mockResolvedValue(false);
    const request = new Request("https://auth.example.com/auth/oauth2/token", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: "grant_type=refresh_token&refresh_token=expired-token",
    });

    expect(
      await handleOAuthTokenRequest(request, handler, retry, isRotating),
    ).toBe(response);
    expect(isRotating).toHaveBeenCalledExactlyOnceWith("expired-token");
    expect(retry).not.toHaveBeenCalled();
  });
});

describe("isRefreshTokenRotating", () => {
  const token = `${OAUTH_REFRESH_TOKEN_PREFIX}raw-token`;

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(NOW);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("looks up the stored digest of the token without its prefix", async () => {
    const findRotation = vi.fn().mockResolvedValue(null);

    expect(
      await isRefreshTokenRotating(
        token,
        OAUTH_REFRESH_TOKEN_PREFIX,
        findRotation,
      ),
    ).toBe(false);
    expect(findRotation).toHaveBeenCalledExactlyOnceWith(
      hashToken("raw-token"),
    );
  });

  it("skips the lookup for a token without Core's prefix", async () => {
    const findRotation = vi.fn();

    expect(
      await isRefreshTokenRotating(
        "raw-token",
        OAUTH_REFRESH_TOKEN_PREFIX,
        findRotation,
      ),
    ).toBe(false);
    expect(findRotation).not.toHaveBeenCalled();
  });

  it.each([
    [
      "an open replay window",
      {
        rotatedAt: NOW,
        rotationReplayExpiresAt: new Date(NOW.getTime() + 1_000),
      },
      true,
    ],
    [
      "a closed replay window",
      {
        rotatedAt: NOW,
        rotationReplayExpiresAt: new Date(NOW.getTime() - 1_000),
      },
      false,
    ],
    ["no rotation", { rotatedAt: null, rotationReplayExpiresAt: null }, false],
  ])("reports %s", async (_label, rotation, expected) => {
    expect(
      await isRefreshTokenRotating(
        token,
        OAUTH_REFRESH_TOKEN_PREFIX,
        async () => rotation,
      ),
    ).toBe(expected);
  });
});

describe("acceptCmoPreviewCallback", () => {
  const CMO_CALLBACK = "https://app.cmo.xyz/api/auth/callback/sokosumi";
  const PREVIEW_CALLBACK =
    "https://sokosumi-cmo-git-feat-x.preview.cmo.xyz/api/auth/callback/sokosumi";

  // Better Auth's authorize endpoint on an in-memory store, with the hook.
  async function authorize(registeredUris: string[], redirectUri: string) {
    const db = createDb();
    db.oauthClient[0].redirectUris = registeredUris;
    const auth = betterAuth({
      baseURL: "https://auth.example.com",
      basePath: "/auth",
      secret: "test-secret-that-is-long-enough-for-better-auth",
      database: memoryAdapter(db),
      plugins: [
        jwt({ disableSettingJwtHeader: true }),
        oauthProvider({
          loginPage: "https://app.example.com/signin",
          consentPage: "https://app.example.com/oauth/consent",
          validateRedirectUri: acceptCmoPreviewCallback,
        }),
      ],
    });
    const query = new URLSearchParams({
      response_type: "code",
      client_id: CLIENT_ID,
      redirect_uri: redirectUri,
      scope: "openid",
      state: "state-1",
      code_challenge: "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGcSZ7j9Gc",
      code_challenge_method: "S256",
    });
    const response = await auth.handler(
      new Request(`https://auth.example.com/auth/oauth2/authorize?${query}`),
    );
    return response.headers.get("location") ?? "";
  }

  it("sends a CMO preview's sign-in on to the login page", async () => {
    expect(await authorize([CMO_CALLBACK], PREVIEW_CALLBACK)).toMatch(
      /^https:\/\/app\.example\.com\/signin\?/,
    );
  });

  it("still signs the CLI in at a loopback port", async () => {
    expect(
      await authorize(
        ["http://127.0.0.1/oauth/callback"],
        "http://127.0.0.1:53682/oauth/callback",
      ),
    ).toMatch(/^https:\/\/app\.example\.com\/signin\?/);
  });

  it("refuses a preview callback for a client that is not CMO", async () => {
    expect(
      await authorize(["https://other.example.com/callback"], PREVIEW_CALLBACK),
    ).toContain("error=invalid_redirect");
  });

  it("keeps exact matches for every client", () => {
    expect(
      acceptCmoPreviewCallback(
        "https://other.example.com/callback",
        ["https://other.example.com/callback"],
        true,
      ),
    ).toBe(true);
  });

  it("accepts a branch alias Vercel truncated with a hash", () => {
    expect(
      acceptCmoPreviewCallback(
        "https://sokosumi-cmo-git-claude-sidebar-new-badge-featu-fceb86.preview.cmo.xyz/api/auth/callback/sokosumi",
        [CMO_CALLBACK],
        false,
      ),
    ).toBe(true);
  });

  it.each([
    ["a production host", "https://app.cmo.xyz/api/auth/callback/other"],
    [
      "a per-deployment URL",
      "https://sokosumi-knutofq4p.preview.cmo.xyz/api/auth/callback/sokosumi",
    ],
    [
      "another project on the suffix",
      "https://evil-git-x.preview.cmo.xyz/api/auth/callback/sokosumi",
    ],
    [
      "a lookalike domain",
      "https://sokosumi-cmo-git-x.preview.cmo.xyz.evil.com/api/auth/callback/sokosumi",
    ],
    ["plain HTTP", PREVIEW_CALLBACK.replace("https:", "http:")],
    ["a port", PREVIEW_CALLBACK.replace(".xyz/", ".xyz:8443/")],
    ["user info", PREVIEW_CALLBACK.replace("https://", "https://user@")],
    ["a query", `${PREVIEW_CALLBACK}?next=/`],
    ["a fragment", `${PREVIEW_CALLBACK}#x`],
    [
      "another path",
      PREVIEW_CALLBACK.replace("/callback/sokosumi", "/callback/google"),
    ],
  ])("refuses %s", (_label, redirectUri) => {
    expect(acceptCmoPreviewCallback(redirectUri, [CMO_CALLBACK], false)).toBe(
      false,
    );
  });
});

describe("jwtKeyStoreOptions", () => {
  const PRODUCTION_SECRET = "production-secret-that-is-long-enough-for-tests";
  const PREVIEW_SECRET = "preview-secret-that-is-long-enough-for-the-tests";

  function createSigner(db: MemoryDb, secret: string, isProduction: boolean) {
    return betterAuth({
      baseURL: "https://auth.example.com",
      basePath: "/auth",
      secret,
      database: memoryAdapter(db),
      plugins: [
        jwt({
          disableSettingJwtHeader: true,
          ...jwtKeyStoreOptions(isProduction),
        }),
      ],
    });
  }

  function sign(auth: ReturnType<typeof createSigner>) {
    return auth.api.signJWT({ body: { payload: { sub: USER_ID } } });
  }

  // A database forked from production: one key, under production's secret.
  async function forkedDb() {
    const db = createDb();
    await sign(createSigner(db, PRODUCTION_SECRET, true));
    expect(db.jwks).toHaveLength(1);
    return db;
  }

  it("signs with a key of its own when the stored key is another secret's", async () => {
    const db = await forkedDb();
    const preview = createSigner(db, PREVIEW_SECRET, false);

    await expect(sign(preview)).resolves.toHaveProperty("token");
    expect(db.jwks).toHaveLength(2);

    // The new key is reused, not minted again.
    await sign(preview);
    expect(db.jwks).toHaveLength(2);
  });

  it("publishes only the keys it can sign with", async () => {
    const db = await forkedDb();
    const preview = createSigner(db, PREVIEW_SECRET, false);
    await sign(preview);

    const { keys } = await preview.api.getJwks();

    expect(keys.map((key) => key.kid)).toEqual([db.jwks[1].id]);
  });

  it("fails loudly in production instead of replacing the key", async () => {
    const db = await forkedDb();

    await expect(sign(createSigner(db, PREVIEW_SECRET, true))).rejects.toThrow(
      "Failed to decrypt private key",
    );
    expect(db.jwks).toHaveLength(1);
  });

  it.each([
    ["production", "production", false],
    // Vercel runs previews with NODE_ENV=production.
    ["preview", "production", true],
    [undefined, "development", true],
    [undefined, "production", false],
  ] as const)(
    "with VERCEL_ENV=%s and NODE_ENV=%s skips foreign keys: %s",
    (VERCEL_ENV, NODE_ENV, skips) => {
      expect(
        "adapter" in
          jwtKeyStoreOptions(isProductionEnvironment({ VERCEL_ENV, NODE_ENV })),
      ).toBe(skips);
    },
  );
});

describe("answerCreatePromptWithNewSession", () => {
  const WEB = "https://app.example.com";
  const CMO_CALLBACK = "https://cmo.example.com/callback";
  const EMAIL = "new@example.com";

  // Core's sign-up path on an in-memory store: the email code endpoint that
  // also takes password sign-ups, the provider, and the after hook.
  function createSignUpAuth() {
    const db = createDb();
    db.oauthClient[0].skipConsent = true;
    const codes = new Map<string, string>();
    const auth = betterAuth({
      baseURL: "https://auth.example.com",
      basePath: "/auth",
      secret: "test-secret-that-is-long-enough-for-better-auth",
      database: memoryAdapter(db),
      trustedOrigins: [WEB],
      // Every session lookup renews the cookie, as a day-old session's does.
      session: { updateAge: 0 },
      emailAndPassword: { enabled: true },
      hooks: {
        after: createAuthMiddleware(afterNewSession),
      },
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
          signup: { page: `${WEB}/signup` },
        }),
      ],
      rateLimit: { enabled: false },
    });

    function post(path: string, body: object, cookie = "") {
      return auth.handler(
        new Request(`https://auth.example.com/auth${path}`, {
          method: "POST",
          headers: { "content-type": "application/json", origin: WEB, cookie },
          body: JSON.stringify(body),
        }),
      );
    }

    // CMO's authorize request; returns where the provider sends the browser.
    async function authorize(prompt: string | undefined, cookie = "") {
      const query = new URLSearchParams({
        response_type: "code",
        client_id: CLIENT_ID,
        redirect_uri: CMO_CALLBACK,
        scope: "openid",
        state: "state-1",
        code_challenge: "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGcSZ7j9Gc",
        code_challenge_method: "S256",
        ...(prompt ? { prompt } : {}),
      });
      const response = await auth.handler(
        new Request(`https://auth.example.com/auth/oauth2/authorize?${query}`, {
          headers: {
            cookie,
            accept: "text/html",
            "sec-fetch-mode": "navigate",
          },
        }),
      );
      return new URL(response.headers.get("location") ?? "");
    }

    // Signs in with an emailed code; `extra` turns it into a password sign-up.
    async function signInWithCode(
      email: string,
      extra: object = {},
      oauthQuery?: string,
    ) {
      await post("/email-otp/send-verification-otp", {
        email,
        type: "sign-in",
      });
      return post("/sign-in/email-otp", {
        email,
        otp: codes.get(email),
        ...extra,
        ...(oauthQuery ? { oauth_query: oauthQuery } : {}),
      });
    }

    return { authorize, post, signInWithCode };
  }

  function sessionCookie(response: Response) {
    return response.headers
      .getSetCookie()
      .map((header) => header.split(";", 1)[0])
      .join("; ");
  }

  function expectCmoCallback(url: string) {
    const target = new URL(url);
    expect(target.origin + target.pathname).toBe(CMO_CALLBACK);
    expect(target.searchParams.get("state")).toBe("state-1");
    expect(target.searchParams.has("code")).toBe(true);
  }

  it.each([
    ["an email code", {}],
    [
      "a password",
      {
        password: "a-password-long-enough",
        termsAccepted: true,
        firstName: "New",
        lastName: "Person",
      },
    ],
  ])(
    "sends a Create account sign-up with %s straight to CMO",
    async (_label, extra) => {
      const { authorize, signInWithCode } = createSignUpAuth();
      const signup = await authorize("create");
      expect(signup.origin + signup.pathname).toBe(`${WEB}/signup`);

      const response = await signInWithCode(
        EMAIL,
        extra,
        signup.searchParams.toString(),
      );

      const result = await response.json();
      expect(result, JSON.stringify(result)).toMatchObject({ redirect: true });
      expectCmoCallback(result.url);
    },
  );

  it("still asks a person already signed in which account to use, though their session renews", async () => {
    const { authorize, signInWithCode } = createSignUpAuth();
    const cookie = sessionCookie(await signInWithCode("user@example.com"));

    const signup = await authorize("create", cookie);

    expect(signup.origin + signup.pathname).toBe(`${WEB}/signup`);
    expect(signup.searchParams.get("prompt")).toBe("create");
  });
});
