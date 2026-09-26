import { Hono } from "hono";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { TEST_VENDOR_ID } from "@/test-fixtures/vendor.js";

import type { AuthVariables } from "./auth";
import {
  authMiddleware,
  denialAuditActor,
  forbidAgentActor,
  requireAdminAuthContext,
  requireInteractiveAdminAuthContext,
  requireOwnerUserContext,
  resolveUserContext,
} from "./auth";

const {
  verifyApiKeyMock,
  getSessionMock,
  coworkerApiKeyFindUniqueMock,
  workspaceFindFirstMock,
  oauthAccessTokenFindUniqueMock,
  oauthConsentFindFirstMock,
  userFindUniqueMock,
} = vi.hoisted(() => ({
  verifyApiKeyMock: vi.fn(),
  getSessionMock: vi.fn(),
  coworkerApiKeyFindUniqueMock: vi.fn(),
  workspaceFindFirstMock: vi.fn(),
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
    workspace: {
      findFirst: workspaceFindFirstMock,
    },
    user: {
      findUnique: userFindUniqueMock,
    },
    oauthAccessToken: {
      findUnique: oauthAccessTokenFindUniqueMock,
    },
    oauthConsent: {
      findFirst: oauthConsentFindFirstMock,
    },
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
    workspaceFindFirstMock.mockResolvedValue({ organizationId: "org_123" });

    verifyApiKeyMock.mockResolvedValue({
      valid: false,
      key: null,
    });
    getSessionMock.mockResolvedValue(null);
    oauthAccessTokenFindUniqueMock.mockResolvedValue(null);
    oauthConsentFindFirstMock.mockResolvedValue(null);
    userFindUniqueMock.mockResolvedValue({
      role: "user",
      banned: false,
      banExpires: null,
    });
  });

  it("authenticates from dedicated coworker API key bearer token", async () => {
    coworkerApiKeyFindUniqueMock.mockResolvedValue({
      coworkerId: "cow_123",
      sokoBotId: null,
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
        sokoBotId: true,
        revokedAt: true,
        expiresAt: true,
        coworker: {
          select: {
            archivedAt: true,
            vendorId: true,
          },
        },
        sokoBot: {
          select: {
            archivedAt: true,
            deletedAt: true,
            userId: true,
            workspaceId: true,
            user: {
              select: { role: true, banned: true, banExpires: true },
            },
          },
        },
      },
    });
    expect(verifyApiKeyMock).not.toHaveBeenCalled();
    expect(getSessionMock).not.toHaveBeenCalled();
    expect(oauthAccessTokenFindUniqueMock).not.toHaveBeenCalled();
  });

  it.each(["coworker_legacytoken", "sokoBot_currenttoken"])(
    "authenticates %s for a remapped Soko Bot key as the soko bot",
    async (token) => {
      coworkerApiKeyFindUniqueMock.mockResolvedValue({
        coworkerId: null,
        sokoBotId: "01960001-0001-7001-8001-000000000099",
        revokedAt: null,
        expiresAt: null,
        coworker: null,
        sokoBot: {
          archivedAt: null,
          deletedAt: null,
          userId: "user_123",
          workspaceId: "01960001-0001-7001-8001-000000000010",
          user: { role: "user", banned: false, banExpires: null },
        },
      });

      const app = createApp();
      const response = await app.request("http://localhost/", {
        headers: { authorization: `Bearer ${token}` },
      });

      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({
        actor: "sokoBot",
        sokoBotId: "01960001-0001-7001-8001-000000000099",
        userId: "user_123",
        workspaceId: "01960001-0001-7001-8001-000000000010",
        organizationId: "org_123",
      });
      expect(verifyApiKeyMock).not.toHaveBeenCalled();
    },
  );

  it("returns 401 for a Soko Bot API key whose owner is banned", async () => {
    coworkerApiKeyFindUniqueMock.mockResolvedValue({
      coworkerId: null,
      sokoBotId: "01960001-0001-7001-8001-000000000099",
      revokedAt: null,
      expiresAt: null,
      coworker: null,
      sokoBot: {
        archivedAt: null,
        deletedAt: null,
        userId: "user_banned",
        workspaceId: "01960001-0001-7001-8001-000000000010",
        user: { role: "user", banned: true, banExpires: null },
      },
    });

    const app = createApp();
    const response = await app.request("http://localhost/", {
      headers: { authorization: "Bearer sokoBot_bannedowner" },
    });

    expect(response.status).toBe(401);
    expect(await response.text()).toBe("Invalid or expired agent token");
    expect(verifyApiKeyMock).not.toHaveBeenCalled();
  });

  it("returns 401 for a Soko Bot API key whose owner row is gone", async () => {
    // SokoBot.userId cascades on delete, so a live key with a missing owner
    // should not happen. Cover the dangling relation the same way OAuth does.
    coworkerApiKeyFindUniqueMock.mockResolvedValue({
      coworkerId: null,
      sokoBotId: "01960001-0001-7001-8001-000000000099",
      revokedAt: null,
      expiresAt: null,
      coworker: null,
      sokoBot: {
        archivedAt: null,
        deletedAt: null,
        userId: "user_deleted",
        workspaceId: "01960001-0001-7001-8001-000000000010",
        user: null,
      },
    });

    const app = createApp();
    const response = await app.request("http://localhost/", {
      headers: { authorization: "Bearer sokoBot_deletedowner" },
    });

    expect(response.status).toBe(401);
  });

  it("authenticates a Soko Bot API key once the owner's ban has expired", async () => {
    coworkerApiKeyFindUniqueMock.mockResolvedValue({
      coworkerId: null,
      sokoBotId: "01960001-0001-7001-8001-000000000099",
      revokedAt: null,
      expiresAt: null,
      coworker: null,
      sokoBot: {
        archivedAt: null,
        deletedAt: null,
        userId: "user_ban_expired",
        workspaceId: "01960001-0001-7001-8001-000000000010",
        user: {
          role: "user",
          banned: true,
          banExpires: new Date(Date.now() - 60_000),
        },
      },
    });

    const app = createApp();
    const response = await app.request("http://localhost/", {
      headers: { authorization: "Bearer sokoBot_expiredban" },
    });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      actor: "sokoBot",
      sokoBotId: "01960001-0001-7001-8001-000000000099",
      userId: "user_ban_expired",
      workspaceId: "01960001-0001-7001-8001-000000000010",
      organizationId: "org_123",
    });
  });

  it("returns 401 for a Soko Bot API key whose owner left the organization", async () => {
    // Removing the Member row is the whole of an organization exit. The bot,
    // its key and the workspace context stored on that key all survive it.
    coworkerApiKeyFindUniqueMock.mockResolvedValue({
      coworkerId: null,
      sokoBotId: "01960001-0001-7001-8001-000000000099",
      revokedAt: null,
      expiresAt: null,
      coworker: null,
      sokoBot: {
        archivedAt: null,
        deletedAt: null,
        userId: "user_left",
        workspaceId: "01960001-0001-7001-8001-000000000010",
        user: { role: "user", banned: false, banExpires: null },
      },
    });
    workspaceFindFirstMock.mockResolvedValue(null);

    const app = createApp();
    const response = await app.request("http://localhost/", {
      headers: { authorization: "Bearer sokoBot_ownerleft" },
    });

    expect(response.status).toBe(401);
    expect(await response.text()).toBe("Invalid or expired agent token");
    expect(workspaceFindFirstMock).toHaveBeenCalledWith({
      where: {
        id: "01960001-0001-7001-8001-000000000010",
        OR: [
          { userId: "user_left" },
          { organization: { members: { some: { userId: "user_left" } } } },
        ],
      },
      select: { organizationId: true },
    });
  });

  it("authenticates a Soko Bot API key in the owner's personal workspace", async () => {
    coworkerApiKeyFindUniqueMock.mockResolvedValue({
      coworkerId: null,
      sokoBotId: "01960001-0001-7001-8001-000000000099",
      revokedAt: null,
      expiresAt: null,
      coworker: null,
      sokoBot: {
        archivedAt: null,
        deletedAt: null,
        userId: "user_personal",
        workspaceId: "01960001-0001-7001-8001-000000000010",
        user: { role: "user", banned: false, banExpires: null },
      },
    });
    workspaceFindFirstMock.mockResolvedValue({ organizationId: null });

    const app = createApp();
    const response = await app.request("http://localhost/", {
      headers: { authorization: "Bearer sokoBot_personal" },
    });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      actor: "sokoBot",
      sokoBotId: "01960001-0001-7001-8001-000000000099",
      userId: "user_personal",
      workspaceId: "01960001-0001-7001-8001-000000000010",
      organizationId: null,
    });
  });

  it("does not treat an orchestrator_ token as a Soko Bot API key", async () => {
    const app = createApp();
    const response = await app.request("http://localhost/", {
      headers: {
        authorization: "Bearer orchestrator_currenttoken",
      },
    });

    expect(response.status).toBe(401);
    expect(coworkerApiKeyFindUniqueMock).not.toHaveBeenCalled();
    expect(verifyApiKeyMock).toHaveBeenCalled();
  });

  it("rejects the removed orchestrator service token", async () => {
    verifyApiKeyMock.mockResolvedValue({ valid: false, key: null });
    const app = createApp();
    const response = await app.request("http://localhost/", {
      headers: {
        authorization: "Bearer test-orchestrator-service-token0",
      },
    });

    expect(response.status).toBe(401);
    expect(coworkerApiKeyFindUniqueMock).not.toHaveBeenCalled();
    expect(verifyApiKeyMock).toHaveBeenCalled();
  });

  it("does not treat a wrong bearer as orchestrator service auth", async () => {
    verifyApiKeyMock.mockResolvedValue({
      valid: false,
      key: null,
    });
    const app = createApp();
    const response = await app.request("http://localhost/", {
      headers: {
        authorization: "Bearer wrong-orchestrator-token",
      },
    });

    // Falls through to other schemes and ends unauthenticated/401 path.
    expect(response.status).not.toBe(200);
    expect(verifyApiKeyMock).toHaveBeenCalled();
  });

  it("never authenticates legacy orch_ API keys as the orchestrator actor", async () => {
    verifyApiKeyMock.mockResolvedValue({
      valid: false,
      key: null,
    });
    const app = createApp();
    const response = await app.request("http://localhost/", {
      headers: {
        // Pre-hard-cut DB-minted keys; table and verify path are gone.
        authorization: "Bearer orch_deadbeefcafebabedeadbeefcafebabe",
      },
    });

    // Hard cut: must not become actor sokoBot (falls through → 401).
    expect(response.status).toBe(401);
    expect(verifyApiKeyMock).toHaveBeenCalled();
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
      scopes: ["openid", "sokosumi:api"],
    });
    oauthConsentFindFirstMock.mockResolvedValue({
      id: "consent_123",
      scopes: ["openid", "sokosumi:api"],
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
      authenticationMethod: "api_key",
    });
    expect(userFindUniqueMock).toHaveBeenCalledWith({
      where: { id: "user_api_key" },
      select: { role: true, banned: true, banExpires: true },
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
  });

  it("returns 401 for a Better Auth API key whose owner is banned", async () => {
    verifyApiKeyMock.mockResolvedValue({
      valid: true,
      key: { referenceId: "user_banned" },
    });
    userFindUniqueMock.mockResolvedValue({
      role: "user",
      banned: true,
      banExpires: null,
    });

    const app = createApp();
    const response = await app.request("http://localhost/", {
      headers: {
        authorization: "Bearer token",
      },
    });

    expect(response.status).toBe(401);
  });

  it("returns 401 for a Better Auth API key whose owner was deleted", async () => {
    verifyApiKeyMock.mockResolvedValue({
      valid: true,
      key: { referenceId: "user_deleted" },
    });
    // `Apikey.referenceId` has no relation to `User`, so the key row outlives
    // the account and Better Auth still reports it as valid.
    userFindUniqueMock.mockResolvedValue(null);

    const app = createApp();
    const response = await app.request("http://localhost/", {
      headers: {
        authorization: "Bearer token",
      },
    });

    expect(response.status).toBe(401);
  });

  it("authenticates a Better Auth API key once the owner's ban has expired", async () => {
    verifyApiKeyMock.mockResolvedValue({
      valid: true,
      key: { referenceId: "user_ban_expired" },
    });
    userFindUniqueMock.mockResolvedValue({
      role: "user",
      banned: true,
      banExpires: new Date(Date.now() - 60_000),
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
      userId: "user_ban_expired",
      organizationId: null,
      role: "user",
      authenticationMethod: "api_key",
    });
  });

  it("falls back to OAuth token when API key is invalid", async () => {
    oauthAccessTokenFindUniqueMock.mockResolvedValue({
      token: "hashed_token",
      expiresAt: new Date(Date.now() + 60_000),
      userId: "user_oauth",
      refreshId: null,
      refreshToken: null,
      clientId: "client_123",
      scopes: ["openid", "sokosumi:api"],
      user: { role: "user", banned: false, banExpires: null },
      client: {
        disabled: false,
        scopes: ["openid", "sokosumi:api"],
      },
    });
    oauthConsentFindFirstMock.mockResolvedValue({
      id: "consent_123",
      scopes: ["openid", "sokosumi:api"],
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
      authenticationMethod: "oauth",
    });
    expect(getSessionMock).not.toHaveBeenCalled();
    expect(oauthAccessTokenFindUniqueMock).toHaveBeenCalledWith({
      where: {
        token: expect.any(String),
      },
      include: {
        refreshToken: true,
        user: {
          select: { role: true, banned: true, banExpires: true },
        },
        client: {
          select: {
            disabled: true,
            scopes: true,
          },
        },
      },
    });
    expect(oauthConsentFindFirstMock).toHaveBeenCalledWith({
      where: {
        userId: "user_oauth",
        clientId: "client_123",
      },
      orderBy: [{ updatedAt: "desc" }, { id: "desc" }],
      select: {
        id: true,
        scopes: true,
      },
    });
  });

  it("returns 401 for an OAuth token whose user is banned", async () => {
    oauthAccessTokenFindUniqueMock.mockResolvedValue({
      token: "hashed_token",
      expiresAt: new Date(Date.now() + 60_000),
      revoked: null,
      userId: "user_oauth",
      refreshId: null,
      refreshToken: null,
      clientId: "client_123",
      scopes: ["openid", "sokosumi:api"],
      user: { role: "user", banned: true, banExpires: null },
      client: {
        disabled: false,
        scopes: ["openid", "sokosumi:api"],
      },
    });
    oauthConsentFindFirstMock.mockResolvedValue({
      id: "consent_123",
      scopes: ["openid", "sokosumi:api"],
    });

    const app = createApp();
    const response = await app.request("http://localhost/", {
      headers: {
        authorization: "Bearer oauth_token",
      },
    });

    expect(response.status).toBe(401);
  });

  it("returns 401 for an OAuth token whose user row is gone", async () => {
    // `OauthAccessToken.userId` is `onDelete: SetNull`, so a deleted user
    // normally nulls the column. Cover the dangling row as well.
    oauthAccessTokenFindUniqueMock.mockResolvedValue({
      token: "hashed_token",
      expiresAt: new Date(Date.now() + 60_000),
      revoked: null,
      userId: "user_deleted",
      refreshId: null,
      refreshToken: null,
      clientId: "client_123",
      scopes: ["openid", "sokosumi:api"],
      user: null,
      client: {
        disabled: false,
        scopes: ["openid", "sokosumi:api"],
      },
    });
    oauthConsentFindFirstMock.mockResolvedValue({
      id: "consent_123",
      scopes: ["openid", "sokosumi:api"],
    });

    const app = createApp();
    const response = await app.request("http://localhost/", {
      headers: {
        authorization: "Bearer oauth_token",
      },
    });

    expect(response.status).toBe(401);
  });

  it("returns 401 for an OAuth token whose userId was nulled by deletion", async () => {
    oauthAccessTokenFindUniqueMock.mockResolvedValue({
      token: "hashed_token",
      expiresAt: new Date(Date.now() + 60_000),
      revoked: null,
      userId: null,
      refreshId: null,
      refreshToken: null,
      clientId: "client_123",
      scopes: ["openid", "sokosumi:api"],
      user: null,
      client: {
        disabled: false,
        scopes: ["openid", "sokosumi:api"],
      },
    });

    const app = createApp();
    const response = await app.request("http://localhost/", {
      headers: {
        authorization: "Bearer oauth_token",
      },
    });

    expect(response.status).toBe(401);
  });

  it("returns 401 for an OAuth access token revoked on its own", async () => {
    // The grant's refresh token is still live: only this access token was
    // withdrawn, which the refresh-token check cannot see.
    oauthAccessTokenFindUniqueMock.mockResolvedValue({
      token: "hashed_token",
      expiresAt: new Date(Date.now() + 60_000),
      revoked: new Date(),
      userId: "user_oauth",
      refreshId: "refresh_123",
      refreshToken: { revoked: null },
      clientId: "client_123",
      scopes: ["openid", "sokosumi:api"],
      user: { role: "user", banned: false, banExpires: null },
      client: {
        disabled: false,
        scopes: ["openid", "sokosumi:api"],
      },
    });
    oauthConsentFindFirstMock.mockResolvedValue({
      id: "consent_123",
      scopes: ["openid", "sokosumi:api"],
    });

    const app = createApp();
    const response = await app.request("http://localhost/", {
      headers: {
        authorization: "Bearer oauth_token",
      },
    });

    expect(response.status).toBe(401);
  });

  it("returns 401 for OAuth tokens that only have openid scope", async () => {
    oauthAccessTokenFindUniqueMock.mockResolvedValue({
      token: "hashed_token",
      expiresAt: new Date(Date.now() + 60_000),
      userId: "user_oauth",
      refreshId: null,
      refreshToken: null,
      clientId: "client_123",
      scopes: ["openid"],
      user: { role: "user" },
      client: {
        disabled: false,
        scopes: ["openid", "sokosumi:api"],
      },
    });
    oauthConsentFindFirstMock.mockResolvedValue({
      id: "consent_123",
      scopes: ["openid", "sokosumi:api"],
    });

    const app = createApp();
    const response = await app.request("http://localhost/", {
      headers: {
        authorization: "Bearer oauth_openid_only",
      },
    });

    expect(response.status).toBe(401);
    expect(oauthConsentFindFirstMock).not.toHaveBeenCalled();
  });

  it("returns 401 for OAuth tokens that only have openid and offline_access", async () => {
    oauthAccessTokenFindUniqueMock.mockResolvedValue({
      token: "hashed_token",
      expiresAt: new Date(Date.now() + 60_000),
      userId: "user_oauth",
      refreshId: null,
      refreshToken: null,
      clientId: "client_123",
      scopes: ["openid", "offline_access"],
      user: { role: "user" },
      client: {
        disabled: false,
        scopes: ["openid", "offline_access", "sokosumi:api"],
      },
    });

    const app = createApp();
    const response = await app.request("http://localhost/", {
      headers: { authorization: "Bearer oauth_offline_only" },
    });

    expect(response.status).toBe(401);
    expect(oauthConsentFindFirstMock).not.toHaveBeenCalled();
  });

  it("returns 401 when OAuth consent no longer includes sokosumi:api", async () => {
    oauthAccessTokenFindUniqueMock.mockResolvedValue({
      token: "hashed_token",
      expiresAt: new Date(Date.now() + 60_000),
      userId: "user_oauth",
      refreshId: null,
      refreshToken: null,
      clientId: "client_123",
      scopes: ["openid", "sokosumi:api"],
      user: { role: "user" },
      client: {
        disabled: false,
        scopes: ["openid", "sokosumi:api"],
      },
    });
    oauthConsentFindFirstMock.mockResolvedValue({
      id: "consent_123",
      scopes: ["openid"],
    });

    const app = createApp();
    const response = await app.request("http://localhost/", {
      headers: {
        authorization: "Bearer oauth_revoked_api_scope",
      },
    });

    expect(response.status).toBe(401);
  });

  it("returns 401 when OAuth client no longer allows sokosumi:api", async () => {
    oauthAccessTokenFindUniqueMock.mockResolvedValue({
      token: "hashed_token",
      expiresAt: new Date(Date.now() + 60_000),
      userId: "user_oauth",
      refreshId: null,
      refreshToken: null,
      clientId: "client_123",
      scopes: ["openid", "sokosumi:api"],
      user: { role: "user" },
      client: {
        disabled: false,
        scopes: ["openid"],
      },
    });
    oauthConsentFindFirstMock.mockResolvedValue({
      id: "consent_123",
      scopes: ["openid", "sokosumi:api"],
    });

    const app = createApp();
    const response = await app.request("http://localhost/", {
      headers: {
        authorization: "Bearer oauth_client_scope_reduced",
      },
    });

    expect(response.status).toBe(401);
    expect(oauthConsentFindFirstMock).not.toHaveBeenCalled();
  });

  it("returns 401 when OAuth client is disabled", async () => {
    oauthAccessTokenFindUniqueMock.mockResolvedValue({
      token: "hashed_token",
      expiresAt: new Date(Date.now() + 60_000),
      userId: "user_oauth",
      refreshId: null,
      refreshToken: null,
      clientId: "client_123",
      scopes: ["openid", "sokosumi:api"],
      user: { role: "user" },
      client: {
        disabled: true,
        scopes: ["openid", "sokosumi:api"],
      },
    });
    oauthConsentFindFirstMock.mockResolvedValue({
      id: "consent_123",
      scopes: ["openid", "sokosumi:api"],
    });

    const app = createApp();
    const response = await app.request("http://localhost/", {
      headers: {
        authorization: "Bearer oauth_client_disabled",
      },
    });

    expect(response.status).toBe(401);
    expect(oauthConsentFindFirstMock).not.toHaveBeenCalled();
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
      authenticationMethod: "session",
    });
    expect(verifyApiKeyMock).not.toHaveBeenCalled();
    expect(oauthAccessTokenFindUniqueMock).not.toHaveBeenCalled();
  });

  it("carries the impersonation marker from an impersonated session", async () => {
    getSessionMock.mockResolvedValue({
      session: {
        activeOrganizationId: null,
        impersonatedBy: "user_admin",
      },
      user: {
        id: "user_target",
        role: "user",
      },
    });

    const app = createApp();
    const response = await app.request("http://localhost/");

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      actor: "user",
      userId: "user_target",
      organizationId: null,
      role: "user",
      authenticationMethod: "session",
      impersonatedBy: "user_admin",
    });
  });

  it("returns 401 when the session belongs to a banned user", async () => {
    // Better Auth's own ban path revokes the sessions too, so what this
    // covers is a ban written straight to the column.
    getSessionMock.mockResolvedValue({
      session: { activeOrganizationId: "org_session" },
      user: {
        id: "user_session",
        role: "user",
        banned: true,
        banExpires: null,
      },
    });

    const app = createApp();
    const response = await app.request("http://localhost/");

    expect(response.status).toBe(401);
  });

  it("returns 401 when the session user's ban has not expired yet", async () => {
    getSessionMock.mockResolvedValue({
      session: { activeOrganizationId: "org_session" },
      user: {
        id: "user_session",
        role: "user",
        banned: true,
        banExpires: new Date(Date.now() + 60_000),
      },
    });

    const app = createApp();
    const response = await app.request("http://localhost/");

    expect(response.status).toBe(401);
  });

  it("authenticates a session once the user's ban has expired", async () => {
    getSessionMock.mockResolvedValue({
      session: { activeOrganizationId: "org_session" },
      user: {
        id: "user_session",
        role: "user",
        banned: true,
        banExpires: new Date(Date.now() - 60_000),
      },
    });

    const app = createApp();
    const response = await app.request("http://localhost/");

    expect(response.status).toBe(200);
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

describe("requireInteractiveAdminAuthContext", () => {
  it("allows an interactive admin session", () => {
    expect(
      requireInteractiveAdminAuthContext({
        actor: "user",
        userId: "user_123",
        organizationId: null,
        role: "admin",
        authenticationMethod: "session",
      }),
    ).toEqual(
      expect.objectContaining({
        userId: "user_123",
        authenticationMethod: "session",
      }),
    );
  });

  it.each(["api_key", "oauth", undefined] as const)(
    "rejects non-session admin credential %s",
    (authenticationMethod) => {
      expect(() =>
        requireInteractiveAdminAuthContext({
          actor: "user",
          userId: "user_123",
          organizationId: null,
          role: "admin",
          authenticationMethod,
        }),
      ).toThrowError("Interactive admin session required");
    },
  );
});

describe("forbidAgentActor", () => {
  it("allows user actors", () => {
    expect(() =>
      forbidAgentActor({
        actor: "user",
        userId: "user_123",
        organizationId: null,
        role: "user",
      }),
    ).not.toThrow();
  });

  it("rejects agent actors", () => {
    expect(() =>
      forbidAgentActor({
        actor: "coworker",
        coworkerId: "cow_123",
        vendorId: TEST_VENDOR_ID,
        context: { userId: "user_123", organizationId: null },
      }),
    ).toThrowError("Agent authentication cannot perform this owner action");
  });
});

describe("denialAuditActor", () => {
  it("audits coworker callers as agents", () => {
    expect(
      denialAuditActor({
        actor: "coworker",
        coworkerId: "cow_123",
        vendorId: TEST_VENDOR_ID,
      }),
    ).toEqual({ actorId: "cow_123", actorType: "agent" });
  });

  it("audits Soko Bot callers as agents", () => {
    expect(
      denialAuditActor({
        actor: "sokoBot",
        sokoBotId: "sokobot_123",
        userId: "user_123",
        workspaceId: "ws_123",
        organizationId: null,
      }),
    ).toEqual({ actorId: "sokobot_123", actorType: "agent" });
  });

  it("keeps the historical user shape for anything else", () => {
    expect(
      denialAuditActor({
        actor: "user",
        userId: "user_123",
        organizationId: null,
        role: "user",
      }),
    ).toEqual({ actorId: "unknown", actorType: "user" });
  });
});

describe("requireOwnerUserContext", () => {
  it("returns session user context", () => {
    expect(
      requireOwnerUserContext({
        actor: "user",
        userId: "user_123",
        organizationId: "org_1",
        role: "user",
      }),
    ).toEqual({
      source: "session",
      actor: "user",
      userId: "user_123",
      organizationId: "org_1",
      role: "user",
    });
  });

  it("rejects an agent even with a matching owner user", () => {
    expect(() =>
      requireOwnerUserContext({
        actor: "coworker",
        coworkerId: "cow_123",
        vendorId: TEST_VENDOR_ID,
        context: { userId: "user_123", organizationId: null },
      }),
    ).toThrowError("Agent authentication cannot perform this owner action");
  });
});

describe("resolveUserContext", () => {
  it("returns the session user context", () => {
    expect(
      resolveUserContext({
        actor: "user",
        userId: "user_123",
        organizationId: "org_1",
        role: "user",
      }),
    ).toEqual(
      expect.objectContaining({ source: "session", userId: "user_123" }),
    );
  });

  it("returns the contextual user for a coworker with X-Context headers", () => {
    expect(
      resolveUserContext({
        actor: "coworker",
        coworkerId: "cow_123",
        vendorId: TEST_VENDOR_ID,
        context: { userId: "user_456", organizationId: "org_1" },
      }),
    ).toEqual({
      source: "context",
      userId: "user_456",
      organizationId: "org_1",
    });
  });

  it("returns the owner user for a Soko Bot", () => {
    expect(
      resolveUserContext({
        actor: "sokoBot",
        sokoBotId: "01960001-0001-7001-8001-000000000099",
        userId: "user_123",
        workspaceId: "11111111-1111-7111-8111-111111111111",
        organizationId: "org_1",
      }),
    ).toEqual({
      source: "context",
      userId: "user_123",
      organizationId: "org_1",
    });
  });

  it("returns null for a standalone coworker key", () => {
    expect(
      resolveUserContext({
        actor: "coworker",
        coworkerId: "cow_123",
        vendorId: TEST_VENDOR_ID,
      }),
    ).toBeNull();
  });
});
