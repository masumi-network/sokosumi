import { beforeEach, describe, expect, it, vi } from "vitest";
import { OpenAPIHonoWithAuth } from "@/lib/hono";
import { TEST_VENDOR_ID } from "@/test-fixtures/vendor.js";

const {
  captureExternalServiceErrorMock,
  verifyApiKeyMock,
  getSessionMock,
  coworkerApiKeyFindUniqueMock,
  prismaTransactionMock,
  upsertWorkspaceForContextMock,
  memberFindFirstMock,
  userFindUniqueMock,
  memberFindUniqueMock,
} = vi.hoisted(() => ({
  captureExternalServiceErrorMock: vi.fn(),
  verifyApiKeyMock: vi.fn(),
  getSessionMock: vi.fn(),
  coworkerApiKeyFindUniqueMock: vi.fn(),
  prismaTransactionMock: vi.fn(),
  upsertWorkspaceForContextMock: vi.fn(),
  memberFindFirstMock: vi.fn(),
  userFindUniqueMock: vi.fn(),
  memberFindUniqueMock: vi.fn(),
}));

vi.mock("@/lib/external-service-errors", () => ({
  captureExternalServiceError: (...args: unknown[]) =>
    captureExternalServiceErrorMock(...args),
}));

vi.mock("@sentry/node", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@sentry/node")>();

  return {
    ...actual,
  };
});

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
    member: {
      findFirst: memberFindFirstMock,
      findUnique: memberFindUniqueMock,
    },
    $transaction: prismaTransactionMock,
  },
}));

vi.mock("@sokosumi/database/repositories", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@sokosumi/database/repositories")>();
  return {
    ...actual,
    workspaceRepository: {
      upsertWorkspaceForContext: (...args: unknown[]) =>
        upsertWorkspaceForContextMock(...args),
    },
  };
});

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
    userFindUniqueMock.mockResolvedValue(null);
    memberFindUniqueMock.mockResolvedValue(null);
    upsertWorkspaceForContextMock.mockResolvedValue({
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
        role: "user",
      },
      workspaceContext: null,
    });
    expect(upsertWorkspaceForContextMock).not.toHaveBeenCalled();
  });

  it("leaves workspaceContext null when personal workspace is missing", async () => {
    const { PersonalWorkspaceMissingError } = await import(
      "@sokosumi/database/repositories"
    );
    getSessionMock.mockResolvedValue({
      session: {
        activeOrganizationId: null,
      },
      user: {
        id: "user_123",
      },
    });
    upsertWorkspaceForContextMock.mockRejectedValueOnce(
      new PersonalWorkspaceMissingError(),
    );

    const app = createApp(true);
    const response = await app.request("http://localhost/");

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      authContext: {
        actor: "user",
        userId: "user_123",
        organizationId: null,
        role: "user",
      },
      workspaceContext: null,
    });
    expect(upsertWorkspaceForContextMock).toHaveBeenCalledWith(
      "user_123",
      null,
      expect.objectContaining({
        $transaction: expect.any(Function),
      }),
    );
    expect(captureExternalServiceErrorMock).not.toHaveBeenCalled();
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
    upsertWorkspaceForContextMock.mockResolvedValueOnce({
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
        role: "user",
      },
      workspaceContext: {
        workspaceId: "workspace_123",
        userId: "user_123",
        organizationId: "org_123",
      },
    });
    expect(upsertWorkspaceForContextMock).toHaveBeenCalledWith(
      "user_123",
      "org_123",
      expect.objectContaining({
        $transaction: expect.any(Function),
        coworkerApiKey: expect.any(Object),
        user: expect.any(Object),
        member: expect.any(Object),
      }),
    );
    expect(prismaTransactionMock).not.toHaveBeenCalled();
  });

  it("creates workspaceContext when the active workspace was missing", async () => {
    getSessionMock.mockResolvedValue({
      session: {
        activeOrganizationId: "org_existing",
      },
      user: {
        id: "user_123",
      },
    });
    upsertWorkspaceForContextMock.mockResolvedValueOnce({
      id: "workspace_created",
      userId: null,
      organizationId: "org_existing",
    });

    const app = createApp(true);
    const response = await app.request("http://localhost/");

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      authContext: {
        actor: "user",
        userId: "user_123",
        organizationId: "org_existing",
        role: "user",
      },
      workspaceContext: {
        workspaceId: "workspace_created",
        userId: null,
        organizationId: "org_existing",
      },
    });
  });

  it("captures workspace resolution failures and keeps workspaceContext null", async () => {
    getSessionMock.mockResolvedValue({
      session: {
        activeOrganizationId: "org_existing",
      },
      user: {
        id: "user_123",
      },
    });
    upsertWorkspaceForContextMock.mockRejectedValueOnce(
      new Error("workspace failed"),
    );

    const app = createApp(true);
    const response = await app.request("http://localhost/");

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      authContext: {
        actor: "user",
        userId: "user_123",
        organizationId: "org_existing",
        role: "user",
      },
      workspaceContext: null,
    });
    expect(captureExternalServiceErrorMock).toHaveBeenCalledWith(
      expect.any(Error),
      {
        label: "workspace_context_resolution",
        sentry: {
          tags: {
            context: "workspace_context_resolution",
          },
        },
        extra: {
          activeOrganizationId: "org_existing",
          userId: "user_123",
        },
      },
    );
  });

  it("leaves workspaceContext null for coworker requests", async () => {
    coworkerApiKeyFindUniqueMock.mockResolvedValue({
      coworkerId: "cow_123",
      revokedAt: null,
      expiresAt: null,
      coworker: {
        archivedAt: null,
        vendorId: TEST_VENDOR_ID,
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
        vendorId: TEST_VENDOR_ID,
      },
      workspaceContext: null,
    });
    expect(upsertWorkspaceForContextMock).not.toHaveBeenCalled();
  });

  it("resolves workspaceContext for delegated coworker requests", async () => {
    coworkerApiKeyFindUniqueMock.mockResolvedValue({
      coworkerId: "cow_123",
      revokedAt: null,
      expiresAt: null,
      coworker: {
        archivedAt: null,
        vendorId: TEST_VENDOR_ID,
      },
    });
    userFindUniqueMock.mockResolvedValue({ id: "user_delegate" });
    upsertWorkspaceForContextMock.mockResolvedValueOnce({
      id: "workspace_delegated",
      userId: "user_delegate",
      organizationId: null,
    });

    const app = createApp(true);
    const response = await app.request("http://localhost/", {
      headers: {
        authorization: "Bearer coworker_validtoken",
        "x-delegation-user-id": "user_delegate",
      },
    });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      authContext: {
        actor: "coworker",
        coworkerId: "cow_123",
        vendorId: TEST_VENDOR_ID,
        context: {
          userId: "user_delegate",
          organizationId: null,
        },
      },
      workspaceContext: {
        workspaceId: "workspace_delegated",
        userId: "user_delegate",
        organizationId: null,
      },
    });
    expect(upsertWorkspaceForContextMock).toHaveBeenCalledWith(
      "user_delegate",
      null,
      expect.objectContaining({
        $transaction: expect.any(Function),
        coworkerApiKey: expect.any(Object),
        user: expect.any(Object),
        member: expect.any(Object),
      }),
    );
    expect(prismaTransactionMock).not.toHaveBeenCalled();
  });
});
