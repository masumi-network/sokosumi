import { Hono } from "hono";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { AuthVariables } from "./auth";
import { authMiddleware } from "./auth";

const {
  verifyApiKeyMock,
  getSessionMock,
  getEnvMock,
  coworkerApiKeyFindUniqueMock,
  prismaTransactionMock,
  oauthAccessTokenFindUniqueMock,
  oauthConsentFindFirstMock,
} = vi.hoisted(() => ({
  verifyApiKeyMock: vi.fn(),
  getSessionMock: vi.fn(),
  getEnvMock: vi.fn(),
  coworkerApiKeyFindUniqueMock: vi.fn(),
  prismaTransactionMock: vi.fn(),
  oauthAccessTokenFindUniqueMock: vi.fn(),
  oauthConsentFindFirstMock: vi.fn(),
}));

vi.mock("@/config/env", () => ({
  getEnv: getEnvMock,
}));

vi.mock("@/lib/auth", () => ({
  auth: {
    api: {
      verifyApiKey: verifyApiKeyMock,
      getSession: getSessionMock,
    },
  },
}));

vi.mock("@/lib/db/prisma", () => ({
  default: {
    coworkerApiKey: {
      findUnique: coworkerApiKeyFindUniqueMock,
    },
    $transaction: prismaTransactionMock,
  },
}));

function createApp() {
  const app = new Hono<{
    Variables: AuthVariables;
  }>();

  app.use("*", authMiddleware);
  app.get("/", (c) => {
    return c.json(c.var.authContext);
  });

  return app;
}

describe("authMiddleware", () => {
  beforeEach(() => {
    vi.clearAllMocks();

    getEnvMock.mockReturnValue({
      ALLOW_LEGACY_BETTER_AUTH_COWORKER_KEYS: true,
    });

    coworkerApiKeyFindUniqueMock.mockResolvedValue(null);

    verifyApiKeyMock.mockResolvedValue({
      valid: false,
      key: null,
    });
    getSessionMock.mockResolvedValue(null);
    oauthAccessTokenFindUniqueMock.mockResolvedValue(null);
    oauthConsentFindFirstMock.mockResolvedValue(null);

    prismaTransactionMock.mockImplementation(async (callback) => {
      return await callback({
        oauthAccessToken: {
          findUnique: oauthAccessTokenFindUniqueMock,
        },
        oauthConsent: {
          findFirst: oauthConsentFindFirstMock,
        },
      });
    });
  });

  it("authenticates from dedicated coworker API key bearer token", async () => {
    coworkerApiKeyFindUniqueMock.mockResolvedValue({
      coworkerId: "cow_123",
      revokedAt: null,
      expiresAt: null,
    });

    const app = createApp();
    const response = await app.request("http://localhost/", {
      headers: {
        authorization: "Bearer coworker_validtoken",
      },
    });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      actor: "coworker",
      coworkerId: "cow_123",
    });
    expect(coworkerApiKeyFindUniqueMock).toHaveBeenCalledWith({
      where: {
        keyHash: expect.any(String),
      },
      select: {
        coworkerId: true,
        revokedAt: true,
        expiresAt: true,
      },
    });
    expect(verifyApiKeyMock).not.toHaveBeenCalled();
    expect(getSessionMock).not.toHaveBeenCalled();
    expect(oauthAccessTokenFindUniqueMock).not.toHaveBeenCalled();
  });

  it("returns 401 for revoked dedicated coworker API key", async () => {
    coworkerApiKeyFindUniqueMock.mockResolvedValue({
      coworkerId: "cow_123",
      revokedAt: new Date(),
      expiresAt: null,
    });

    const app = createApp();
    const response = await app.request("http://localhost/", {
      headers: {
        authorization: "Bearer coworker_revoked",
      },
    });

    expect(response.status).toBe(401);
  });

  it("returns 401 for expired dedicated coworker API key", async () => {
    coworkerApiKeyFindUniqueMock.mockResolvedValue({
      coworkerId: "cow_123",
      revokedAt: null,
      expiresAt: new Date(Date.now() - 1_000),
    });

    const app = createApp();
    const response = await app.request("http://localhost/", {
      headers: {
        authorization: "Bearer coworker_expired",
      },
    });

    expect(response.status).toBe(401);
  });

  it("does not fall back to user auth schemes for invalid coworker-prefixed token", async () => {
    verifyApiKeyMock.mockResolvedValue({
      valid: true,
      key: {
        userId: "user_api_key",
        metadata: {
          organizationId: "org_api_key",
        },
      },
    });
    oauthAccessTokenFindUniqueMock.mockResolvedValue({
      token: "hashed_token",
      expiresAt: new Date(Date.now() + 60_000),
      userId: "user_oauth",
      refreshId: null,
      refreshToken: null,
      clientId: "client_123",
    });
    oauthConsentFindFirstMock.mockResolvedValue({
      id: "consent_123",
    });

    const app = createApp();
    const response = await app.request("http://localhost/", {
      headers: {
        authorization: "Bearer coworker_invalid",
      },
    });

    expect(response.status).toBe(401);
    expect(verifyApiKeyMock).not.toHaveBeenCalled();
    expect(oauthAccessTokenFindUniqueMock).not.toHaveBeenCalled();
    expect(prismaTransactionMock).not.toHaveBeenCalled();
  });

  it("authenticates Better Auth coworker-metadata key as coworker when legacy fallback is enabled", async () => {
    verifyApiKeyMock.mockResolvedValue({
      valid: true,
      key: {
        userId: "user_api_key",
        metadata: {
          organizationId: "org_api_key",
          coworkerId: "cow_123",
        },
      },
    });

    const app = createApp();
    const response = await app.request("http://localhost/", {
      headers: {
        authorization: "Bearer token",
      },
    });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      actor: "coworker",
      coworkerId: "cow_123",
    });
    expect(getSessionMock).not.toHaveBeenCalled();
    expect(oauthAccessTokenFindUniqueMock).not.toHaveBeenCalled();
  });

  it("rejects Better Auth coworker-metadata key when legacy fallback is disabled (fail closed)", async () => {
    getEnvMock.mockReturnValue({
      ALLOW_LEGACY_BETTER_AUTH_COWORKER_KEYS: false,
    });

    verifyApiKeyMock.mockResolvedValue({
      valid: true,
      key: {
        userId: "user_api_key",
        metadata: {
          organizationId: "org_api_key",
          coworkerId: "cow_123",
        },
      },
    });

    const app = createApp();
    const response = await app.request("http://localhost/", {
      headers: {
        authorization: "Bearer token",
      },
    });

    expect(response.status).toBe(401);
    expect(verifyApiKeyMock).toHaveBeenCalled();
    expect(getSessionMock).not.toHaveBeenCalled();
  });

  it("falls back to OAuth token when API key is invalid", async () => {
    oauthAccessTokenFindUniqueMock.mockResolvedValue({
      token: "hashed_token",
      expiresAt: new Date(Date.now() + 60_000),
      userId: "user_oauth",
      refreshId: null,
      refreshToken: null,
      clientId: "client_123",
    });
    oauthConsentFindFirstMock.mockResolvedValue({
      id: "consent_123",
    });

    const app = createApp();
    const response = await app.request("http://localhost/", {
      headers: {
        authorization: "Bearer oauth_token",
      },
    });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      actor: "user",
      userId: "user_oauth",
      organizationId: null,
    });
    expect(getSessionMock).not.toHaveBeenCalled();
    expect(prismaTransactionMock).toHaveBeenCalledTimes(1);
    expect(oauthAccessTokenFindUniqueMock).toHaveBeenCalledWith({
      where: {
        token: expect.any(String),
      },
      include: {
        refreshToken: true,
      },
    });
  });

  it("returns 401 when bearer token is invalid", async () => {
    const app = createApp();
    const response = await app.request("http://localhost/", {
      headers: {
        authorization: "Bearer invalid",
      },
    });

    expect(response.status).toBe(401);
  });

  it("authenticates from session when authorization header is missing", async () => {
    getSessionMock.mockResolvedValue({
      session: {
        activeOrganizationId: "org_session",
      },
      user: {
        id: "user_session",
      },
    });

    const app = createApp();
    const response = await app.request("http://localhost/");

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      actor: "user",
      userId: "user_session",
      organizationId: "org_session",
    });
    expect(verifyApiKeyMock).not.toHaveBeenCalled();
    expect(prismaTransactionMock).not.toHaveBeenCalled();
  });

  it("returns 401 when session is missing or invalid", async () => {
    const app = createApp();
    const response = await app.request("http://localhost/");

    expect(response.status).toBe(401);
    expect(verifyApiKeyMock).not.toHaveBeenCalled();
  });
});
