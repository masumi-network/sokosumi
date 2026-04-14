import { beforeEach, describe, expect, it, vi } from "vitest";

import { OpenAPIHonoWithAuth } from "@/lib/hono";

const {
  verifyApiKeyMock,
  getSessionMock,
  coworkerApiKeyFindUniqueMock,
  prismaTransactionMock,
  workspaceFindUniqueMock,
  memberFindFirstMock,
} = vi.hoisted(() => ({
  verifyApiKeyMock: vi.fn(),
  getSessionMock: vi.fn(),
  coworkerApiKeyFindUniqueMock: vi.fn(),
  prismaTransactionMock: vi.fn(),
  workspaceFindUniqueMock: vi.fn(),
  memberFindFirstMock: vi.fn(),
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
      findUnique: workspaceFindUniqueMock,
    },
    member: {
      findFirst: memberFindFirstMock,
    },
    $transaction: prismaTransactionMock,
  },
}));

function createApp(includeWorkspaceContext: boolean) {
  const app = new OpenAPIHonoWithAuth({
    includeWorkspaceContext,
  });

  app.get("/", (c) => {
    return c.json({
      authContext: c.var.authContext,
      workspaceContext: c.var.workspaceContext,
    });
  });

  return app;
}

describe("workspaceMiddleware", () => {
  beforeEach(() => {
    vi.clearAllMocks();

    verifyApiKeyMock.mockResolvedValue({
      valid: false,
      key: null,
    });
    getSessionMock.mockResolvedValue(null);
    coworkerApiKeyFindUniqueMock.mockResolvedValue(null);
    memberFindFirstMock.mockResolvedValue(null);
    workspaceFindUniqueMock.mockResolvedValue({
      id: "workspace_123",
      userId: "user_123",
      organizationId: null,
    });

    prismaTransactionMock.mockImplementation(async (callback) => {
      return await callback({
        oauthAccessToken: {
          findUnique: vi.fn(),
        },
        oauthConsent: {
          findFirst: vi.fn(),
        },
      });
    });
  });

  it("keeps workspaceContext null when the middleware is not included", async () => {
    getSessionMock.mockResolvedValue({
      session: {
        activeOrganizationId: "org_existing",
      },
      user: {
        id: "user_123",
      },
    });

    const app = createApp(false);
    const response = await app.request("http://localhost/");

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      authContext: {
        actor: "user",
        userId: "user_123",
        organizationId: "org_existing",
      },
      workspaceContext: null,
    });
    expect(workspaceFindUniqueMock).not.toHaveBeenCalled();
  });

  it("resolves workspaceContext for user requests when included", async () => {
    getSessionMock.mockResolvedValue({
      session: {
        activeOrganizationId: null,
      },
      user: {
        id: "user_123",
      },
    });

    memberFindFirstMock.mockResolvedValue({
      organizationId: "org_123",
    });
    workspaceFindUniqueMock.mockResolvedValueOnce({
      id: "workspace_123",
      userId: "user_123",
      organizationId: "org_123",
    });

    const app = createApp(true);
    const response = await app.request("http://localhost/", {
      headers: {
        "x-organization-slug": "team-alpha",
      },
    });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      authContext: {
        actor: "user",
        userId: "user_123",
        organizationId: "org_123",
      },
      workspaceContext: {
        workspaceId: "workspace_123",
        userId: "user_123",
        organizationId: "org_123",
      },
    });
    expect(workspaceFindUniqueMock).toHaveBeenCalledWith({
      where: {
        organizationId: "org_123",
      },
      select: {
        id: true,
        userId: true,
        organizationId: true,
      },
    });
  });

  it("keeps workspaceContext null when no workspace exists", async () => {
    getSessionMock.mockResolvedValue({
      session: {
        activeOrganizationId: "org_existing",
      },
      user: {
        id: "user_123",
      },
    });
    workspaceFindUniqueMock.mockResolvedValueOnce(null);

    const app = createApp(true);
    const response = await app.request("http://localhost/");

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      authContext: {
        actor: "user",
        userId: "user_123",
        organizationId: "org_existing",
      },
      workspaceContext: null,
    });
  });

  it("leaves workspaceContext null for coworker requests", async () => {
    coworkerApiKeyFindUniqueMock.mockResolvedValue({
      coworkerId: "cow_123",
      revokedAt: null,
      expiresAt: null,
      coworker: {
        archivedAt: null,
      },
    });

    const app = createApp(true);
    const response = await app.request("http://localhost/", {
      headers: {
        authorization: "Bearer coworker_validtoken",
        "x-organization-slug": "team-alpha",
      },
    });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      authContext: {
        actor: "coworker",
        coworkerId: "cow_123",
      },
      workspaceContext: null,
    });
    expect(workspaceFindUniqueMock).not.toHaveBeenCalled();
  });
});
