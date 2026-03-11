import { OpenAPIHono } from "@hono/zod-openapi";
import { HTTPException } from "hono/http-exception";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { OpenAPIHonoWithAuth } from "@/lib/hono";
import type { AuthVariables } from "@/middleware/auth";

import mountPostCoworkerMeOAuthToken from "./post";

const {
  hashApiKeyMock,
  requireCoworkerCapabilityMock,
  coworkerFindFirstMock,
  oauthClientFindUniqueMock,
  userFindUniqueMock,
  memberFindUniqueMock,
  prismaTransactionMock,
} = vi.hoisted(() => ({
  hashApiKeyMock: vi.fn(),
  requireCoworkerCapabilityMock: vi.fn(),
  coworkerFindFirstMock: vi.fn(),
  oauthClientFindUniqueMock: vi.fn(),
  userFindUniqueMock: vi.fn(),
  memberFindUniqueMock: vi.fn(),
  prismaTransactionMock: vi.fn(),
}));

vi.mock("@/helpers/access-control", () => ({
  requireCoworkerCapability: requireCoworkerCapabilityMock,
}));

vi.mock("@/lib/coworker-api-key", () => ({
  hashApiKey: hashApiKeyMock,
}));

vi.mock("@/lib/db/prisma", () => ({
  default: {
    coworker: {
      findFirst: coworkerFindFirstMock,
    },
    oauthClient: {
      findUnique: oauthClientFindUniqueMock,
    },
    user: {
      findUnique: userFindUniqueMock,
    },
    member: {
      findUnique: memberFindUniqueMock,
    },
    $transaction: prismaTransactionMock,
  },
}));

interface TxMock {
  oauthConsent: {
    findFirst: ReturnType<typeof vi.fn>;
    create: ReturnType<typeof vi.fn>;
  };
  oauthRefreshToken: {
    create: ReturnType<typeof vi.fn>;
  };
  oauthAccessToken: {
    create: ReturnType<typeof vi.fn>;
  };
}

const COWORKER_ID = "cow_123";
const COWORKER_SLUG = "ops-agent";
const USER_ID = "user_123";
const CLIENT_ID = "client_123";

function createApp() {
  const app = new OpenAPIHono<{
    Variables: AuthVariables;
  }>();

  app.use("*", async (c, next) => {
    c.set("isAuthenticated", true);
    c.set("authContext", {
      actor: "coworker",
      coworkerId: COWORKER_ID,
    });

    return await next();
  });

  mountPostCoworkerMeOAuthToken(app as unknown as OpenAPIHonoWithAuth);
  return app;
}

function mockTransaction(tx: TxMock) {
  prismaTransactionMock.mockImplementation(async (callback) => {
    return await callback(tx);
  });
}

describe("POST /me/oauth/token", () => {
  beforeEach(() => {
    vi.clearAllMocks();

    requireCoworkerCapabilityMock.mockResolvedValue(undefined);
    coworkerFindFirstMock.mockResolvedValue({
      id: COWORKER_ID,
      slug: COWORKER_SLUG,
      isWhitelisted: true,
    });
    oauthClientFindUniqueMock.mockResolvedValue({
      clientId: CLIENT_ID,
      disabled: false,
      scopes: ["openid", "offline_access"],
      referenceId: COWORKER_ID,
      metadata: null,
    });
    userFindUniqueMock.mockResolvedValue({ id: USER_ID });
    memberFindUniqueMock.mockResolvedValue({ userId: USER_ID });
    hashApiKeyMock.mockResolvedValue("hashed_value");
  });

  it("issues background OAuth tokens for a whitelisted coworker", async () => {
    const tx: TxMock = {
      oauthConsent: {
        findFirst: vi.fn().mockResolvedValue(null),
        create: vi.fn().mockResolvedValue({ id: "consent_123" }),
      },
      oauthRefreshToken: {
        create: vi.fn().mockResolvedValue({ id: "refresh_123" }),
      },
      oauthAccessToken: {
        create: vi.fn().mockResolvedValue({ id: "access_123" }),
      },
    };
    mockTransaction(tx);

    const app = createApp();
    const response = await app.request("http://localhost/me/oauth/token", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        userId: USER_ID,
        organizationId: null,
        clientId: CLIENT_ID,
        scope: "openid offline_access",
      }),
    });

    expect(response.status).toBe(201);
    const body = await response.json();
    expect(body.data.authorizationConfirmed).toBe(true);
    expect(body.data.accessToken).toMatch(/^soko_access_token_/);
    expect(body.data.refreshToken).toMatch(/^soko_refresh_token_/);
    expect(body.data.tokenType).toBe("Bearer");
    expect(tx.oauthConsent.create).toHaveBeenCalledTimes(1);
    expect(tx.oauthRefreshToken.create).toHaveBeenCalledTimes(1);
    expect(tx.oauthAccessToken.create).toHaveBeenCalledTimes(1);
  });

  it("rejects non-whitelisted coworker", async () => {
    coworkerFindFirstMock.mockResolvedValue({
      id: COWORKER_ID,
      slug: COWORKER_SLUG,
      isWhitelisted: false,
    });

    const app = createApp();
    const response = await app.request("http://localhost/me/oauth/token", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        userId: USER_ID,
        organizationId: null,
        clientId: CLIENT_ID,
      }),
    });

    expect(response.status).toBe(403);
    expect(prismaTransactionMock).not.toHaveBeenCalled();
  });

  it("rejects OAuth clients not mapped to current coworker", async () => {
    oauthClientFindUniqueMock.mockResolvedValue({
      clientId: CLIENT_ID,
      disabled: false,
      scopes: ["openid", "offline_access"],
      referenceId: "another-coworker",
      metadata: null,
    });

    const app = createApp();
    const response = await app.request("http://localhost/me/oauth/token", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        userId: USER_ID,
        organizationId: null,
        clientId: CLIENT_ID,
      }),
    });

    expect(response.status).toBe(403);
    expect(prismaTransactionMock).not.toHaveBeenCalled();
  });

  it("returns 403 when coworker capability check fails", async () => {
    requireCoworkerCapabilityMock.mockRejectedValue(
      new HTTPException(403, {
        message: "Coworker is not allowed to use chat",
      }),
    );

    const app = createApp();
    const response = await app.request("http://localhost/me/oauth/token", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        userId: USER_ID,
        organizationId: null,
        clientId: CLIENT_ID,
      }),
    });

    expect(response.status).toBe(403);
    expect(coworkerFindFirstMock).not.toHaveBeenCalled();
  });
});
