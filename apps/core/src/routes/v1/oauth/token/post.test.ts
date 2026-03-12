import { OpenAPIHono } from "@hono/zod-openapi";
import { HTTPException } from "hono/http-exception";
import { decodeJwt } from "jose";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { getEnv } from "@/config/env";
import type { OpenAPIHonoWithAuth } from "@/lib/hono";
import type { AuthVariables } from "@/middleware/auth";

import mountPostOAuthToken from "./post";

const {
  hashApiKeyMock,
  requireCoworkerCapabilityMock,
  coworkerFindFirstMock,
  oauthClientFindUniqueMock,
  userFindUniqueMock,
  prismaTransactionMock,
} = vi.hoisted(() => ({
  hashApiKeyMock: vi.fn(),
  requireCoworkerCapabilityMock: vi.fn(),
  coworkerFindFirstMock: vi.fn(),
  oauthClientFindUniqueMock: vi.fn(),
  userFindUniqueMock: vi.fn(),
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

  mountPostOAuthToken(app as unknown as OpenAPIHonoWithAuth);
  return app;
}

function mockTransaction(tx: TxMock) {
  prismaTransactionMock.mockImplementation(async (callback) => {
    return await callback(tx);
  });
}

describe("POST /token", () => {
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
    const response = await app.request("http://localhost/token", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        userId: USER_ID,
        clientId: CLIENT_ID,
      }),
    });

    expect(response.status).toBe(201);
    const body = await response.json();
    expect(body.data.authorizationConfirmed).toBe(true);
    expect(body.data.accessToken).toMatch(/^soko_access_token_/);
    expect(body.data.refreshToken).toMatch(/^soko_refresh_token_/);
    expect(body.data.tokenType).toBe("Bearer");
    expect(body.data.scope).toContain("openid");
    expect(body.data.id_token).toMatch(
      /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/,
    );

    const idTokenPayload = decodeJwt(body.data.id_token);
    expect(idTokenPayload.sub).toBe(USER_ID);
    expect(idTokenPayload.aud).toBe(CLIENT_ID);
    expect(idTokenPayload.iss).toBe(`${getEnv().BETTER_AUTH_URL}/api/auth`);
    expect(idTokenPayload.auth_time).toBeTypeOf("number");
    expect(idTokenPayload.iat).toBeTypeOf("number");
    expect(idTokenPayload.exp).toBeTypeOf("number");
    expect(Number(idTokenPayload.exp)).toBeGreaterThan(
      Number(idTokenPayload.iat),
    );

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
    const response = await app.request("http://localhost/token", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        userId: USER_ID,
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
    const response = await app.request("http://localhost/token", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        userId: USER_ID,
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
    const response = await app.request("http://localhost/token", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        userId: USER_ID,
        clientId: CLIENT_ID,
      }),
    });

    expect(response.status).toBe(403);
    expect(coworkerFindFirstMock).not.toHaveBeenCalled();
  });
});
