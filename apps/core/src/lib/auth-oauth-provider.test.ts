import { createHash } from "node:crypto";
import { oauthProvider } from "@better-auth/oauth-provider";
import { memoryAdapter } from "better-auth/adapters/memory";
import { betterAuth } from "better-auth/minimal";
import { jwt } from "better-auth/plugins";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { oauthRefreshTokenOptions } from "./auth-oauth-provider";

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
function createTestAuth(db: MemoryDb) {
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
        ...oauthRefreshTokenOptions,
      }),
    ],
    rateLimit: { enabled: false },
  });

  async function refresh(refreshToken: string) {
    const response = await auth.handler(
      new Request("https://auth.example.com/auth/oauth2/token", {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          grant_type: "refresh_token",
          refresh_token: refreshToken,
          client_id: CLIENT_ID,
        }).toString(),
      }),
    );
    return {
      status: response.status,
      body: (await response.json()) as Record<string, unknown>,
    };
  }

  return { refresh };
}

describe("oauthRefreshTokenOptions", () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(NOW);
  });

  afterEach(() => {
    vi.useRealTimers();
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
