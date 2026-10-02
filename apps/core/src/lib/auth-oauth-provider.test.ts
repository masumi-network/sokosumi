import { createHash } from "node:crypto";
import { setTimeout } from "node:timers/promises";
import { oauthProvider } from "@better-auth/oauth-provider";
import { prismaAdapter } from "@better-auth/prisma-adapter";
import type { DBAdapter } from "better-auth";
import { memoryAdapter } from "better-auth/adapters/memory";
import { APIError, createAuthMiddleware } from "better-auth/api";
import { betterAuth } from "better-auth/minimal";
import { jwt } from "better-auth/plugins";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { isProductionEnvironment } from "@/config/env";
import {
  acceptCmoPreviewCallback,
  guardOAuthTokenIssuance,
  handleOAuthRefreshTokenRequest,
  isRefreshTokenRotating,
  jwtKeyStoreOptions,
  oauthRefreshTokenOptions,
  revokePasswordResetCredentials,
  revokeUserOAuthTokens,
} from "./auth-oauth-provider";

type MemoryDb = Record<string, Record<string, unknown>[]>;

const CLIENT_ID = "cmo-client";
const USER_ID = "user-1";
const SEED_REFRESH_TOKEN = "seed-refresh-token";
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
        token: hashToken(SEED_REFRESH_TOKEN),
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
  {
    replayDelay = 0,
    rateLimitEnabled = false,
    beforeRefreshCreate,
    tokenWriteFailure = false,
  }: {
    replayDelay?: number;
    rateLimitEnabled?: boolean;
    beforeRefreshCreate?: () => Promise<void>;
    tokenWriteFailure?: boolean;
  } = {},
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
    const create: typeof instance.create = async (input) => {
      if (input.model === "oauthRefreshToken") await beforeRefreshCreate?.();
      return instance.create(input);
    };
    const updateMany: typeof instance.updateMany = async (input) => {
      if (tokenWriteFailure && input.model === "oauthRefreshToken")
        throw new Error("token write unavailable");
      return instance.updateMany(input);
    };
    const customized = { ...instance, update, create, updateMany };
    // memoryAdapter has no DB transaction/locking. Keep fault injection on
    // the callback adapter; the separate Prisma adapter test proves wiring.
    return {
      ...customized,
      transaction: async (callback) => callback(customized),
    };
  };
  const auth = betterAuth({
    baseURL: "https://auth.example.com",
    basePath: "/auth",
    secret: "test-secret-that-is-long-enough-for-better-auth",
    database: delayedAdapter,
    emailAndPassword: {
      enabled: true,
      revokeSessionsOnPasswordReset: true,
      onPasswordReset: async ({ user }): Promise<void> =>
        revokePasswordResetCredentials(await auth.$context, user.id),
    },
    hooks: {
      after: createAuthMiddleware(async (ctx) => {
        if (
          ctx.path === "/oauth2/token" &&
          !(ctx.context.returned instanceof APIError)
        ) {
          await guardOAuthTokenIssuance(
            ctx.context.adapter,
            ctx.body,
            ctx.context.returned,
          );
        }
      }),
    },
    plugins: [
      jwt({ disableSettingJwtHeader: true }),
      oauthProvider({
        loginPage: "https://app.example.com/signin",
        consentPage: "https://app.example.com/oauth/consent",
        ...oauthRefreshTokenOptions,
        rateLimit: { token: { max: 2, window: 60 } },
      }),
    ],
    rateLimit: { enabled: rateLimitEnabled, storage: "memory" },
  });

  const retry = vi.fn<Parameters<typeof handleOAuthRefreshTokenRequest>[2]>(
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
    return isRefreshTokenRotating(refreshToken, "", async (storedToken) => {
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
    });
  }

  async function refresh(refreshToken: string) {
    const response = await handleOAuthRefreshTokenRequest(
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

  return { auth, refresh, retry };
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

describe("user OAuth revocation", () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"], now: NOW });
  });
  afterEach(() => vi.useRealTimers());

  it("withdraws all clients' tokens, keeps another user's tokens, and disables rotation replay", async () => {
    const db = createDb();
    const { auth, refresh } = createTestAuth(db);
    const first = await refresh(SEED_REFRESH_TOKEN);
    expect(first.status).toBe(200);
    db.oauthRefreshToken.push({
      ...db.oauthRefreshToken[1],
      id: "other-client",
      clientId: "apple-client",
    });
    db.oauthRefreshToken.push({
      ...db.oauthRefreshToken[1],
      id: "other-user",
      userId: "user-2",
      token: "other-token",
    });
    db.oauthAccessToken.push({
      ...db.oauthAccessToken[0],
      id: "other-client-access",
      clientId: "apple-client",
    });
    db.oauthAccessToken.push({
      ...db.oauthAccessToken[0],
      id: "other-user-access",
      userId: "user-2",
      token: "other-access",
    });
    await revokeUserOAuthTokens((await auth.$context).adapter, USER_ID);
    for (const model of ["oauthAccessToken", "oauthRefreshToken"]) {
      expect(
        db[model]
          .filter((row) => row.userId === USER_ID)
          .every((row) => row.revoked),
      ).toBe(true);
      expect(
        db[model].find((row) => row.userId === "user-2")?.revoked,
      ).toBeFalsy();
    }
    const replay = await refresh(SEED_REFRESH_TOKEN);
    expect(replay.status).toBe(400);
    expect(replay.body.error).toBe("invalid_grant");
    expect((await refresh(String(first.body.refresh_token))).status).toBe(400);
  });

  it("cancels a successor minted after the revocation sweep", async () => {
    const db = createDb();
    const reached = Promise.withResolvers<void>();
    const resume = Promise.withResolvers<void>();
    const { auth, refresh } = createTestAuth(db, {
      beforeRefreshCreate: async () => {
        reached.resolve();
        await resume.promise;
      },
    });
    const pending = refresh(SEED_REFRESH_TOKEN);
    await reached.promise;
    await revokeUserOAuthTokens((await auth.$context).adapter, USER_ID);
    resume.resolve();
    const result = await pending;
    expect(result.status).toBe(400);
    expect(result.body.error).toBe("invalid_grant");
    expect(db.oauthRefreshToken.every((row) => row.revoked)).toBe(true);
    expect(db.oauthAccessToken.every((row) => row.revoked)).toBe(true);
    expect((await refresh(SEED_REFRESH_TOKEN)).status).toBe(400);
  });

  it("revokes a completed rotation before its successor can renew", async () => {
    const db = createDb();
    const { auth, refresh } = createTestAuth(db);
    const issued = await refresh(SEED_REFRESH_TOKEN);
    expect(issued.status).toBe(200);
    await revokeUserOAuthTokens((await auth.$context).adapter, USER_ID);
    expect((await refresh(String(issued.body.refresh_token))).status).toBe(400);
    expect(db.oauthAccessToken.every((row) => row.revoked)).toBe(true);
  });

  it.each([null, "deleted-session"])(
    "withdraws an in-flight code exchange after session deletion (%s)",
    async (sessionId) => {
      const db = createDb();
      const { auth } = createTestAuth(db);
      db.oauthAccessToken.push({
        id: "late-access",
        token: hashToken("late-access"),
        userId: USER_ID,
        sessionId,
        revoked: null,
      });
      db.oauthRefreshToken.push({
        id: "late-refresh",
        token: hashToken("late-refresh"),
        userId: USER_ID,
        sessionId,
        revoked: null,
      });
      await expect(
        guardOAuthTokenIssuance(
          (await auth.$context).adapter,
          { grant_type: "authorization_code" },
          {
            access_token: "soko_access_token_late-access",
            refresh_token: "soko_refresh_token_late-refresh",
          },
        ),
      ).rejects.toMatchObject({ body: { error: "invalid_grant" } });
      expect(db.oauthAccessToken[0].revoked).toEqual(NOW);
      expect(db.oauthRefreshToken[1].revoked).toEqual(NOW);
    },
  );

  it("allows a new code exchange from a preserved session", async () => {
    const db = createDb();
    const { auth } = createTestAuth(db);
    db.session.push({ id: "kept-session", userId: USER_ID });
    db.oauthAccessToken.push({
      id: "fresh-access",
      token: hashToken("fresh-access"),
      userId: USER_ID,
      sessionId: "kept-session",
      revoked: null,
    });
    await expect(
      guardOAuthTokenIssuance(
        (await auth.$context).adapter,
        { grant_type: "authorization_code" },
        {
          access_token: "fresh-access",
        },
      ),
    ).resolves.toBeUndefined();
    expect(db.oauthAccessToken[0].revoked).toBeNull();
  });

  it("deletes sessions despite reset revocation failure and cannot reuse the consumed link", async () => {
    const db = createDb();
    const { auth } = createTestAuth(db, { tokenWriteFailure: true });
    const context = await auth.$context;
    db.account.push({
      id: "credential",
      userId: USER_ID,
      providerId: "credential",
      accountId: USER_ID,
      password: await context.password.hash("old-password-secure"),
    });
    db.session.push({
      id: "session-1",
      token: "attacker-session",
      userId: USER_ID,
      createdAt: NOW,
      updatedAt: NOW,
      expiresAt: new Date(NOW.getTime() + 86400000),
    });
    db.verification.push({
      id: "reset-link",
      identifier: "reset-password:reset-token",
      value: USER_ID,
      createdAt: NOW,
      updatedAt: NOW,
      expiresAt: new Date(NOW.getTime() + 86400000),
    });
    await expect(
      auth.api.resetPassword({
        body: { token: "reset-token", newPassword: "new-password-secure" },
      }),
    ).rejects.toThrow("token write unavailable");
    expect(db.session).toEqual([]);
    expect(
      await context.password.verify({
        hash: String(db.account[0].password),
        password: "new-password-secure",
      }),
    ).toBe(true);
    await expect(
      auth.api.resetPassword({
        body: { token: "reset-token", newPassword: "new-password-secure" },
      }),
    ).rejects.toMatchObject({ body: { code: "INVALID_TOKEN" } });
  });

  it("withdraws an orphan successor even if its access row disappeared", async () => {
    const db = createDb();
    const { auth } = createTestAuth(db);
    db.oauthRefreshToken.push({
      id: "orphan-refresh",
      token: hashToken("orphan-refresh"),
      userId: USER_ID,
      revoked: null,
    });
    await expect(
      guardOAuthTokenIssuance(
        (await auth.$context).adapter,
        { grant_type: "refresh_token", refresh_token: SEED_REFRESH_TOKEN },
        {
          access_token: "missing-access",
          refresh_token: "orphan-refresh",
        },
      ),
    ).rejects.toMatchObject({ body: { error: "invalid_grant" } });
    expect(db.oauthRefreshToken[1].revoked).toEqual(NOW);
  });

  it("guards JWT resource refresh grants through the returned refresh row", async () => {
    const db = createDb();
    const { auth } = createTestAuth(db);
    db.oauthRefreshToken[0].revoked = NOW;
    db.oauthRefreshToken[0].rotatedAt = NOW;
    db.oauthRefreshToken.push({
      id: "jwt-refresh",
      token: hashToken("jwt-refresh"),
      userId: USER_ID,
      revoked: null,
    });
    const body = {
      grant_type: "refresh_token",
      refresh_token: SEED_REFRESH_TOKEN,
    };
    const response = {
      access_token: "header.payload.signature",
      refresh_token: "jwt-refresh",
    };
    await expect(
      guardOAuthTokenIssuance((await auth.$context).adapter, body, response),
    ).resolves.toBeUndefined();
    // The provider may replay the original response after the successor has
    // itself rotated. That is not an explicit user revocation.
    db.oauthRefreshToken[1].revoked = NOW;
    db.oauthRefreshToken[1].rotatedAt = NOW;
    await expect(
      guardOAuthTokenIssuance((await auth.$context).adapter, body, response),
    ).resolves.toBeUndefined();
    db.oauthRefreshToken[0].rotatedAt = null;
    await expect(
      guardOAuthTokenIssuance((await auth.$context).adapter, body, response),
    ).rejects.toMatchObject({ body: { error: "invalid_grant" } });
    expect(db.oauthRefreshToken[1].revoked).toEqual(NOW);
  });

  it("still attempts token revocation if session deletion fails", async () => {
    const deleteUserSessions = vi
      .fn()
      .mockRejectedValue(new Error("session write unavailable"));
    const updateMany = vi.fn();
    const tx = { updateMany, incrementOne: vi.fn(), findOne: vi.fn() };
    await expect(
      revokePasswordResetCredentials(
        {
          internalAdapter: { deleteUserSessions },
          adapter: {
            transaction: async (callback) => callback(tx),
          },
        },
        USER_ID,
      ),
    ).rejects.toThrow("session write unavailable");
    expect(updateMany).toHaveBeenCalledTimes(2);
  });

  it("uses the Prisma transaction adapter and a user-row write before both sweeps", async () => {
    const calls: string[] = [];
    const tx = {
      user: {
        update: vi.fn(async () => {
          calls.push("user-lock");
          return { id: USER_ID, updatedAt: NOW };
        }),
      },
      oauthRefreshToken: {
        updateMany: vi.fn(async () => {
          calls.push("refresh-sweep");
          return { count: 1 };
        }),
      },
      oauthAccessToken: {
        updateMany: vi.fn(async () => {
          calls.push("access-sweep");
          return { count: 1 };
        }),
      },
    };
    const prisma = {
      $transaction: vi.fn(async (callback: (tx: unknown) => unknown) =>
        callback(tx),
      ),
    };
    const db = createDb();
    const { auth } = createTestAuth(db);
    const adapter: DBAdapter = prismaAdapter(prisma, {
      provider: "postgresql",
      transaction: true,
    })((await auth.$context).options);
    await revokeUserOAuthTokens(adapter, USER_ID);
    expect(calls).toEqual(["user-lock", "refresh-sweep", "access-sweep"]);
    expect(tx.user.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: { updatedAt: NOW } }),
    );
    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
  });
});

describe("handleOAuthRefreshTokenRequest", () => {
  it.each([
    {
      url: "https://auth.example.com/auth/sign-in/email",
      body: "grant_type=refresh_token",
    },
    { body: "grant_type=authorization_code" },
    { body: "grant_type=refresh_token&client_assertion=single-use-assertion" },
    { body: "grant_type=refresh_token", headers: { dpop: "single-use-proof" } },
  ])(
    "leaves other grants and single-use proofs untouched (%j)",
    async ({ url, body, headers }) => {
      const response = new Response("{}", { status: 400 });
      const handler = vi.fn().mockResolvedValue(response);
      const retry = vi.fn();
      const request = new Request(
        url ?? "https://auth.example.com/auth/oauth2/token",
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
        await handleOAuthRefreshTokenRequest(request, handler, retry, vi.fn()),
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
      await handleOAuthRefreshTokenRequest(request, handler, retry, vi.fn()),
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
      await handleOAuthRefreshTokenRequest(request, handler, retry, isRotating),
    ).toBe(response);
    expect(isRotating).toHaveBeenCalledExactlyOnceWith("expired-token");
    expect(retry).not.toHaveBeenCalled();
  });
});

describe("isRefreshTokenRotating", () => {
  const prefix = "soko_refresh_token_";
  const token = `${prefix}raw-token`;

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(NOW);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("looks up the stored digest of the token without its prefix", async () => {
    const findRotation = vi.fn().mockResolvedValue(null);

    expect(await isRefreshTokenRotating(token, prefix, findRotation)).toBe(
      false,
    );
    expect(findRotation).toHaveBeenCalledExactlyOnceWith(
      hashToken("raw-token"),
    );
  });

  it("skips the lookup for a token without Core's prefix", async () => {
    const findRotation = vi.fn();

    expect(
      await isRefreshTokenRotating("raw-token", prefix, findRotation),
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
      await isRefreshTokenRotating(token, prefix, async () => rotation),
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
