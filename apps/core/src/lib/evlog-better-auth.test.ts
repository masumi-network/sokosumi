import { memoryAdapter } from "better-auth/adapters/memory";
import { createAuthMiddleware } from "better-auth/api";
import { signJWT } from "better-auth/crypto";
import { type BetterAuthOptions, betterAuth } from "better-auth/minimal";
import type { DrainContext } from "evlog";
import { Hono } from "hono";
import { requestId } from "hono/request-id";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  bindCoreRequestContext,
  coreEvlogMiddleware,
  initCoreLogger,
} from "@/lib/evlog";
import {
  betterAuthLogger,
  captureBetterAuthOAuthErrorURL,
} from "@/lib/evlog-library-logs";

const getSessionMock = vi.hoisted(() => vi.fn());
const authOptions = vi.hoisted(() => ({
  baseURL: "http://localhost",
  onAPIError: { errorURL: "http://localhost/sign-in-error" },
}));

vi.mock("@/lib/auth", () => ({
  auth: {
    options: authOptions,
    api: {
      getSession: getSessionMock,
    },
  },
}));

const captured: DrainContext[] = [];

async function loadMiddleware() {
  const { betterAuthEvlogMiddleware } = await import("@/lib/evlog-better-auth");
  return betterAuthEvlogMiddleware();
}

function createApp(identify: Awaited<ReturnType<typeof loadMiddleware>>) {
  const app = new Hono();
  app.use(requestId());
  app.use(coreEvlogMiddleware());
  app.use(bindCoreRequestContext());
  app.use(identify);
  return app;
}

async function createOAuthCallbackApp(
  options: Pick<BetterAuthOptions, "database" | "databaseHooks"> = {},
) {
  const auth = betterAuth({
    ...authOptions,
    basePath: "/auth",
    secret: "test-secret-that-is-long-enough-for-better-auth",
    logger: betterAuthLogger,
    socialProviders: {
      google: {
        clientId: "google-client-id",
        clientSecret: "google-secret",
        overrideUserInfoOnSignIn: true,
      },
    },
    trustedOrigins: ["https://app.example.test"],
    rateLimit: { enabled: false },
    hooks: {
      after: createAuthMiddleware(async (ctx) => {
        await captureBetterAuthOAuthErrorURL(ctx.path);
      }),
    },
    ...options,
  });
  const app = createApp(await loadMiddleware());
  app.on(["GET", "POST"], "/auth/*", (c) => auth.handler(c.req.raw));
  return app;
}

async function startGoogleSignIn(
  app: Awaited<ReturnType<typeof createOAuthCallbackApp>>,
  {
    callbackURL = "http://localhost/signed-in",
    errorCallbackURL,
  }: { callbackURL?: string; errorCallbackURL?: string } = {},
) {
  const response = await app.request("/auth/sign-in/social", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      origin: "http://localhost",
    },
    body: JSON.stringify({ provider: "google", callbackURL, errorCallbackURL }),
  });
  expect(response.status).toBe(200);
  const { url } = await response.json();
  const state = new URL(url).searchParams.get("state");
  expect(state).toBeTruthy();
  return {
    callback: `/auth/callback/google?code=google-code&state=${state}`,
    cookie: response.headers
      .getSetCookie()
      .map((header) => header.split(";", 1)[0])
      .join("; "),
  };
}

describe("betterAuthEvlogMiddleware", () => {
  beforeEach(() => {
    captured.length = 0;
    delete process.env.SENTRY_DSN;
    getSessionMock.mockReset();
    initCoreLogger({
      silent: true,
      drain: (ctx) => {
        captured.push(ctx);
      },
    });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("identifies a Better Auth cookie session on the wide event", async () => {
    getSessionMock.mockResolvedValue({
      user: {
        id: "user_123",
        email: "alice@example.com",
        name: "Alice",
      },
      session: {
        id: "sess_1",
      },
    });

    const app = createApp(await loadMiddleware());
    app.get("/v1/me", (c) => c.json({ ok: true }));

    await app.request("http://localhost/v1/me");

    expect(getSessionMock).toHaveBeenCalledTimes(1);
    expect(captured[0]?.event.userId).toBe("user_123");
    expect(captured[0]?.event.user).toEqual({
      id: "user_123",
      email: "a***@example.com",
    });
    expect(captured[0]?.event.session).toBeUndefined();
    expect(captured[0]?.event.auth).toMatchObject({
      identified: true,
    });
  });

  it("skips Better Auth session resolution on /auth routes", async () => {
    const app = createApp(await loadMiddleware());
    app.get("/auth/sign-in", (c) => c.json({ ok: true }));

    await app.request("http://localhost/auth/sign-in");

    expect(getSessionMock).not.toHaveBeenCalled();
    expect(captured[0]?.event.auth).toBeUndefined();
  });

  it("emits an info event when Better Auth throws an OAuth error-page redirect", async () => {
    const app = await createOAuthCallbackApp();

    const response = await app.request("http://localhost/auth/callback/google");

    expect(response.status).toBe(302);
    expect(response.headers.get("location")).toBe(
      "http://localhost/sign-in-error?error=state_not_found",
    );
    expect(captured.map(({ event }) => event)).toMatchObject([
      {
        status: 302,
        level: "info",
        libraryLogs: [
          { source: "better-auth", level: "info", message: "State not found" },
        ],
      },
    ]);
    expect(captured[0]?.event).not.toHaveProperty("error");
  });

  it("logs a missing OAuth code at info on the per-flow error page", async () => {
    const app = await createOAuthCallbackApp();
    const errorCallbackURL =
      "https://app.example.test/signin?returnUrl=%2Fchat";
    const { callback, cookie } = await startGoogleSignIn(app, {
      errorCallbackURL,
    });
    const callbackWithoutCode = new URL(callback, authOptions.baseURL);
    callbackWithoutCode.searchParams.delete("code");
    captured.length = 0;

    const response = await app.request(callbackWithoutCode.href, {
      headers: { cookie },
    });

    expect(response.status).toBe(302);
    expect(response.headers.get("location")).toBe(
      `${errorCallbackURL}&error=no_code`,
    );
    expect(captured.map(({ event }) => event)).toMatchObject([
      {
        status: 302,
        level: "info",
        libraryLogs: [
          { source: "better-auth", level: "info", message: "Code not found" },
        ],
      },
    ]);
  });

  it.each([
    {
      scenario: "missing signed cookie",
      useDatabase: true,
      expired: false,
      code: "state_security_mismatch",
      message: "State mismatch: State not persisted correctly",
    },
    {
      scenario: "missing encrypted cookie",
      useDatabase: false,
      expired: false,
      code: "state_mismatch",
      message: "State mismatch: auth state cookie not found",
    },
    {
      scenario: "expired encrypted cookie",
      useDatabase: false,
      expired: true,
      code: "state_mismatch",
      message: "Invalid state: request expired",
    },
  ])(
    "logs OAuth state at warn for $scenario",
    async ({ useDatabase, expired, code, message }) => {
      const database = useDatabase
        ? memoryAdapter({ verification: [] })
        : undefined;
      const app = await createOAuthCallbackApp({ database });
      const { callback, cookie } = await startGoogleSignIn(app);
      captured.length = 0;

      if (expired) vi.setSystemTime(Date.now() + 11 * 60 * 1000);
      const response = await app.request(callback, {
        headers: expired ? { cookie } : undefined,
      });

      expect(response.status).toBe(302);
      expect(response.headers.get("location")).toBe(
        "http://localhost/sign-in-error?error=state_mismatch",
      );
      expect(captured.map(({ event }) => event)).toMatchObject([
        {
          status: 302,
          level: "warn",
          libraryLogs: [
            {
              source: "better-auth",
              level: "warn",
              message: "Failed to parse state",
              args: [{ code, message }],
            },
          ],
        },
      ]);
      expect(captured[0]?.event).not.toHaveProperty("error");
    },
  );

  it.each([
    "http://localhost/signed-in?error=access_denied",
    "https://app.example.test/sign-in-error?error=access_denied",
    "http://localhost/sign-in-error?error=access_denied",
  ])(
    "keeps the OAuth profile update warning on a successful redirect to %s",
    async (callbackURL) => {
      const now = new Date();
      const email = "ada@example.com";
      const idToken = await signJWT(
        { sub: "google-user", email, email_verified: true, name: "Ada" },
        "test-google-key",
      );
      vi.stubGlobal(
        "fetch",
        vi.fn(async () =>
          Response.json({
            access_token: "google-access-token",
            id_token: idToken,
            token_type: "Bearer",
          }),
        ),
      );
      const database = memoryAdapter({
        user: [
          {
            id: "user-1",
            name: "Ada",
            email,
            emailVerified: true,
            createdAt: now,
            updatedAt: now,
          },
        ],
        account: [
          {
            id: "account-1",
            userId: "user-1",
            accountId: "google-user",
            providerId: "google",
            createdAt: now,
            updatedAt: now,
          },
        ],
        session: [],
        verification: [],
      });
      const app = await createOAuthCallbackApp({
        database,
        databaseHooks: { user: { update: { before: async () => false } } },
      });
      const { callback, cookie } = await startGoogleSignIn(app, {
        callbackURL,
      });
      captured.length = 0;

      const response = await app.request(callback, { headers: { cookie } });

      expect(response.status).toBe(302);
      expect(response.headers.get("location")).toBe(callbackURL);
      expect(response.headers.getSetCookie()).toEqual(
        expect.arrayContaining([
          expect.stringContaining("better-auth.session_token="),
        ]),
      );
      expect(captured.map(({ event }) => event)).toMatchObject([
        {
          status: 302,
          level: "warn",
          libraryLogs: [
            {
              source: "better-auth",
              level: "warn",
              message:
                "Could not update user info during OAuth sign in; preserving existing user for session.",
            },
          ],
        },
      ]);
    },
  );

  it("keeps an OAuth state decryption failure at error after the 302", async () => {
    const app = await createOAuthCallbackApp();
    const { callback, cookie } = await startGoogleSignIn(app);
    const cookieName = cookie.split("=", 1)[0];
    captured.length = 0;

    const response = await app.request(callback, {
      headers: { cookie: `${cookieName}=invalid` },
    });

    expect(response.status).toBe(302);
    expect(response.headers.get("location")).toBe(
      "http://localhost/sign-in-error?error=state_invalid",
    );
    expect(captured.map(({ event }) => event)).toMatchObject([
      {
        status: 302,
        level: "error",
        error: {
          message: "Failed to parse state",
          cause: { code: "state_invalid" },
        },
      },
    ]);
  });

  it("keeps a database failure during an OAuth callback at error after the 302", async () => {
    const databaseError = "08P01 no more connections allowed (max_client_conn)";
    const database = memoryAdapter(
      new Proxy(
        { verification: [] },
        {
          get(target, key, receiver) {
            if (key === "verification") throw new Error(databaseError);
            return Reflect.get(target, key, receiver);
          },
        },
      ),
    );
    const app = await createOAuthCallbackApp({ database });

    const response = await app.request(
      "/auth/callback/google?state=abc&code=def",
    );

    expect(response.status).toBe(302);
    expect(response.headers.get("location")).toBe(
      "http://localhost/sign-in-error?error=internal_server_error",
    );
    expect(captured.map(({ event }) => event)).toMatchObject([
      {
        status: 302,
        level: "error",
        error: {
          message: "Failed to parse state",
          cause: { message: databaseError },
        },
      },
    ]);
  });

  it.each([
    ["/sign-in-error?error=no_code", undefined, "info"],
    ["http://evil.localhost/sign-in-error?error=no_code", undefined, "error"],
    ["https://localhost/sign-in-error?error=no_code", undefined, "error"],
    ["/sign-in-error/?error=no_code", undefined, "error"],
    ["/sign-in-error-x?error=no_code", undefined, "error"],
    ["/sign-in-error/x?error=no_code", undefined, "error"],
    ["/sign-in-error?error=state_mismatch", undefined, "info"],
    ["/sign-in-error?error=access_denied", undefined, "info"],
    [
      "/sign-in-error?error=state_mismatch",
      Object.assign(new Error("Auth failure"), { code: "state_mismatch" }),
      "error",
    ],
    ["/sign-in-error?error=internal_server_error", undefined, "error"],
    ["/sign-in-error?error=invalid_code", undefined, "error"],
    ["/sign-in-error?error=unable_to_create_user", undefined, "error"],
    ["/sign-in-error?error=unable_to_link_account", undefined, "error"],
    ["/sign-in-error?error=no_code&error=invalid_code", undefined, "error"],
    ["/signed-in", undefined, "error"],
    [undefined, undefined, "error"],
  ] as const)(
    "logs a 302 to %s with cause %s at %s",
    async (location, cause, level) => {
      const app = createApp(await loadMiddleware());
      app.get("/auth/check", () => {
        betterAuthLogger.log(
          "error",
          "OAuth diagnostic",
          ...(cause ? [cause] : []),
        );
        return new Response(null, {
          status: 302,
          headers: location ? { location } : undefined,
        });
      });

      const response = await app.request("/auth/check");
      expect(response.headers.has("set-cookie")).toBe(false);

      expect(captured.map(({ event }) => event)).toMatchObject([
        {
          status: 302,
          level,
          libraryLogs: [{ level, message: "OAuth diagnostic" }],
        },
      ]);
      expect(captured[0]?.event.error).toEqual(
        level === "error"
          ? expect.objectContaining({ message: "OAuth diagnostic" })
          : undefined,
      );
    },
  );

  it.each([401, 500] as const)(
    "keeps Better Auth library errors at error for HTTP %i",
    async (status) => {
      const app = createApp(await loadMiddleware());
      app.get("/auth/check", (c) => {
        betterAuthLogger.log("error", "Auth request failed");
        return c.body(null, status);
      });

      const response = await app.request("/auth/check");

      expect(response.status).toBe(status);
      expect(captured.map(({ event }) => event)).toMatchObject([
        { status, level: "error", error: { message: "Auth request failed" } },
      ]);
    },
  );

  it("skips cookie identify when an Authorization header is present", async () => {
    getSessionMock.mockResolvedValue({
      user: {
        id: "user_cookie",
        email: "alice@example.com",
        name: "Alice",
      },
      session: {
        id: "sess_cookie",
      },
    });

    const app = createApp(await loadMiddleware());
    app.get("/v1/me", (c) => c.json({ ok: true }));

    await app.request("http://localhost/v1/me", {
      headers: { authorization: "Bearer coworker_key" },
    });

    expect(getSessionMock).not.toHaveBeenCalled();
    expect(captured[0]?.event.userId).toBeUndefined();
    expect(captured[0]?.event.auth).toBeUndefined();
  });

  it("skips Better Auth session resolution on /sync cron routes", async () => {
    const app = createApp(await loadMiddleware());
    app.get("/sync/jobs", (c) => c.json({ ok: true }));

    await app.request("http://localhost/sync/jobs");

    expect(getSessionMock).not.toHaveBeenCalled();
    expect(captured[0]?.event.auth).toBeUndefined();
  });
});
