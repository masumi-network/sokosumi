import { Hono } from "hono";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { AuthVariables } from "./auth";
import { authMiddleware } from "./auth";

const {
  verifyApiKeyMock,
  getSessionMock,
  coworkerApiKeyFindUniqueMock,
  userFindUniqueMock,
  prismaTransactionMock,
  oauthAccessTokenFindUniqueMock,
  oauthConsentFindFirstMock,
} = vi.hoisted(() => ({
  verifyApiKeyMock: vi.fn(),
  getSessionMock: vi.fn(),
  coworkerApiKeyFindUniqueMock: vi.fn(),
  userFindUniqueMock: vi.fn(),
  prismaTransactionMock: vi.fn(),
  oauthAccessTokenFindUniqueMock: vi.fn(),
  oauthConsentFindFirstMock: vi.fn(),
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
    user: {
      findUnique: userFindUniqueMock,
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

    coworkerApiKeyFindUniqueMock.mockResolvedValue(null);

    verifyApiKeyMock.mockResolvedValue({
      valid: false,
      key: null,
    });
    getSessionMock.mockResolvedValue(null);
    userFindUniqueMock.mockResolvedValue({
      role: "user",
    });
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

  it("authenticates Better Auth API key as user and ignores deprecated metadata", async () => {
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
      actor: "user",
      userId: "user_api_key",
      organizationId: null,
      isAdmin: false,
    });
    expect(getSessionMock).not.toHaveBeenCalled();
    expect(oauthAccessTokenFindUniqueMock).not.toHaveBeenCalled();
  });

  it("authenticates Better Auth API key as admin when user role is admin", async () => {
    userFindUniqueMock.mockResolvedValueOnce({
      role: "admin",
    });
    verifyApiKeyMock.mockResolvedValue({
      valid: true,
      key: {
        userId: "user_admin",
        metadata: {
          organizationId: "org_admin",
        },
      },
    });

    const app = createApp();
    const response = await app.request("http://localhost/", {
      headers: {
        authorization: "Bearer token_admin",
      },
    });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      actor: "user",
      userId: "user_admin",
      organizationId: null,
      isAdmin: true,
    });
    expect(getSessionMock).not.toHaveBeenCalled();
    expect(oauthAccessTokenFindUniqueMock).not.toHaveBeenCalled();
  });

  it("authenticates Better Auth API key as admin when role list includes admin", async () => {
    userFindUniqueMock.mockResolvedValueOnce({
      role: "admin,user",
    });
    verifyApiKeyMock.mockResolvedValue({
      valid: true,
      key: {
        userId: "user_admin_multi_role",
        metadata: {
          organizationId: "org_admin",
        },
      },
    });

    const app = createApp();
    const response = await app.request("http://localhost/", {
      headers: {
        authorization: "Bearer token_admin_multi_role",
      },
    });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      actor: "user",
      userId: "user_admin_multi_role",
      organizationId: null,
      isAdmin: true,
    });
    expect(getSessionMock).not.toHaveBeenCalled();
    expect(oauthAccessTokenFindUniqueMock).not.toHaveBeenCalled();
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
      isAdmin: false,
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
      isAdmin: false,
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
