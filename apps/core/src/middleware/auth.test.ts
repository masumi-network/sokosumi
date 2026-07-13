import { Hono } from "hono";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { TEST_VENDOR_ID } from "@/test-fixtures/vendor.js";

import type { AuthVariables } from "./auth";
import { authMiddleware, requireAdminAuthContext } from "./auth";

const {
  verifyApiKeyMock,
  getSessionMock,
  coworkerApiKeyFindUniqueMock,
  prismaTransactionMock,
  oauthAccessTokenFindUniqueMock,
  oauthConsentFindFirstMock,
  userFindUniqueMock,
} = vi.hoisted(() => ({
  verifyApiKeyMock: vi.fn(),
  getSessionMock: vi.fn(),
  coworkerApiKeyFindUniqueMock: vi.fn(),
  prismaTransactionMock: vi.fn(),
  oauthAccessTokenFindUniqueMock: vi.fn(),
  oauthConsentFindFirstMock: vi.fn(),
  userFindUniqueMock: vi.fn(),
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
    oauthAccessTokenFindUniqueMock.mockResolvedValue(null);
    oauthConsentFindFirstMock.mockResolvedValue(null);
    userFindUniqueMock.mockResolvedValue({ role: "user" });

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
      coworker: {
        archivedAt: null,
        vendorId: "01960001-0001-7001-8001-000000000001",
      },
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
      vendorId: "01960001-0001-7001-8001-000000000001",
    });
    expect(coworkerApiKeyFindUniqueMock).toHaveBeenCalledWith({
      where: {
        keyHash: expect.any(String),
      },
      select: {
        coworkerId: true,
        revokedAt: true,
        expiresAt: true,
        coworker: {
          select: {
            archivedAt: true,
            vendorId: true,
          },
        },
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
      coworker: {
        archivedAt: null,
      },
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
      coworker: {
        archivedAt: null,
      },
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
        referenceId: "user_api_key",
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
        referenceId: "user_api_key",
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
      role: "user",
    });
    expect(userFindUniqueMock).toHaveBeenCalledWith({
      where: { id: "user_api_key" },
      select: { role: true },
    });
    expect(verifyApiKeyMock).toHaveBeenCalledWith({
      body: { configId: "default", key: "token" },
    });
    expect(getSessionMock).not.toHaveBeenCalled();
    expect(oauthAccessTokenFindUniqueMock).not.toHaveBeenCalled();
  });

  it("returns 401 for dedicated coworker API key tied to archived coworker", async () => {
    coworkerApiKeyFindUniqueMock.mockResolvedValue({
      coworkerId: "cow_123",
      revokedAt: null,
      expiresAt: null,
      coworker: {
        archivedAt: new Date(),
      },
    });

    const app = createApp();
    const response = await app.request("http://localhost/", {
      headers: {
        authorization: "Bearer coworker_archived",
      },
    });

    expect(response.status).toBe(401);
    expect(verifyApiKeyMock).not.toHaveBeenCalled();
    expect(oauthAccessTokenFindUniqueMock).not.toHaveBeenCalled();
    expect(prismaTransactionMock).not.toHaveBeenCalled();
  });

  it("falls back to OAuth token when API key is invalid", async () => {
    oauthAccessTokenFindUniqueMock.mockResolvedValue({
      token: "hashed_token",
      expiresAt: new Date(Date.now() + 60_000),
      userId: "user_oauth",
      refreshId: null,
      refreshToken: null,
      clientId: "client_123",
      user: { role: "user" },
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
      role: "user",
    });
    expect(getSessionMock).not.toHaveBeenCalled();
    expect(prismaTransactionMock).toHaveBeenCalledTimes(1);
    expect(oauthAccessTokenFindUniqueMock).toHaveBeenCalledWith({
      where: {
        token: expect.any(String),
      },
      include: {
        refreshToken: true,
        user: {
          select: { role: true },
        },
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
        role: "user",
      },
    });

    const app = createApp();
    const response = await app.request("http://localhost/");

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      actor: "user",
      userId: "user_session",
      organizationId: "org_session",
      role: "user",
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

describe("requireAdminAuthContext", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("allows user role admin", () => {
    expect(
      requireAdminAuthContext({
        actor: "user",
        userId: "user_123",
        organizationId: null,
        role: "admin",
      }),
    ).toEqual({
      actor: "user",
      userId: "user_123",
      organizationId: null,
      role: "admin",
    });
  });

  it("allows comma-separated roles that include admin", () => {
    expect(
      requireAdminAuthContext({
        actor: "user",
        userId: "user_123",
        organizationId: null,
        role: "user, admin",
      }),
    ).toEqual({
      actor: "user",
      userId: "user_123",
      organizationId: null,
      role: "user, admin",
    });
  });

  it("rejects missing admin role", () => {
    expect(() =>
      requireAdminAuthContext({
        actor: "user",
        userId: "user_123",
        organizationId: null,
        role: "user",
      }),
    ).toThrowError("Admin access required");
  });

  it("rejects coworker actor", () => {
    expect(() =>
      requireAdminAuthContext({
        actor: "coworker",
        coworkerId: "cow_123",
        vendorId: TEST_VENDOR_ID,
      }),
    ).toThrowError("User authentication required");
  });

  it("rejects delegated coworker actor", () => {
    expect(() =>
      requireAdminAuthContext({
        actor: "coworker",
        coworkerId: "cow_123",
        vendorId: TEST_VENDOR_ID,
        context: {
          userId: "user_456",
          organizationId: "org_1",
        },
      }),
    ).toThrowError("User authentication required");
  });
});
