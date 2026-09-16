import { HTTPException } from "hono/http-exception";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { OpenAPIHonoWithAuth } from "@/lib/hono";
import type { AuthenticationContext } from "@/middleware/auth";

const { workspaceFindUniqueMock, resolveMemberOrganizationByIdMock } =
  vi.hoisted(() => ({
    workspaceFindUniqueMock: vi.fn(),
    resolveMemberOrganizationByIdMock: vi.fn(),
  }));

vi.mock("@/middleware/auth", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/middleware/auth")>()),
  authMiddleware: (await import("@/test-fixtures/auth-middleware"))
    .stubAuthMiddleware,
  requireUserContext: (authContext: AuthenticationContext | null) => {
    if (authContext?.actor === "user") {
      return { source: "session" as const, ...authContext };
    }
    if (authContext?.actor === "coworker" && authContext.context) {
      return {
        source: "context" as const,
        userId: authContext.context.userId,
        organizationId: authContext.context.organizationId,
      };
    }
    throw new HTTPException(403, { message: "User authentication required" });
  },
}));

vi.mock("@/lib/db/prisma", () => ({
  default: {
    workspace: {
      findUnique: workspaceFindUniqueMock,
    },
  },
}));

vi.mock("@/helpers/organization", () => ({
  resolveMemberOrganizationById: (...args: unknown[]) =>
    resolveMemberOrganizationByIdMock(...args),
}));

// Let a coworker past the vendor grant gate so these cases exercise the
// workspace binding, not grant policy.
vi.mock("@/helpers/personal-workspace-error", () => ({
  resolveWorkspaceForContextOrNotFound: async () => ({ id: "workspace_a" }),
}));

vi.mock("@/helpers/vendor-grants", () => ({
  getWorkspaceGrant: async () => ({ status: "GRANTED" }),
  isGrantDeniedOrRevoked: () => false,
  throwGrantAccessError: () => {
    throw new Error("unexpected grant rejection");
  },
}));

const USER_AUTH_CONTEXT: AuthenticationContext = {
  actor: "user",
  userId: "user_123",
  organizationId: null,
  role: "user",
};

const WORKSPACE_ID = "11111111-1111-7111-8111-111111111111";

let mountGetWorkspaceById: (app: OpenAPIHonoWithAuth) => void;

function createApp(
  authContext: AuthenticationContext = USER_AUTH_CONTEXT,
  activeWorkspaceId: string | null = null,
) {
  const app = new OpenAPIHonoWithAuth();
  app.use("*", async (c, next) => {
    c.set("requestId", "req_123");
    c.set("isAuthenticated", true);
    c.set("authContext", authContext);
    c.set(
      "workspaceContext",
      activeWorkspaceId
        ? {
            workspaceId: activeWorkspaceId,
            userId: "user_123",
            organizationId: "org_1",
          }
        : null,
    );
    return await next();
  });
  mountGetWorkspaceById(app);
  return app;
}

beforeAll(async () => {
  const module = await import("./get");
  mountGetWorkspaceById = module.default;
});

describe("GET /workspaces/{id}", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns organizationId for an organization workspace the user belongs to", async () => {
    workspaceFindUniqueMock.mockResolvedValueOnce({
      userId: null,
      organizationId: "org_1",
    });
    resolveMemberOrganizationByIdMock.mockResolvedValueOnce({
      id: "org_1",
      name: "Org One",
    });

    const app = createApp();
    const response = await app.request(`http://localhost/${WORKSPACE_ID}`);

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      data: {
        organizationId: "org_1",
      },
      meta: expect.objectContaining({
        requestId: "req_123",
      }),
    });
    expect(resolveMemberOrganizationByIdMock).toHaveBeenCalledWith({
      id: "org_1",
      userId: "user_123",
      tx: expect.anything(),
    });
  });

  it("returns null organizationId for the caller personal workspace", async () => {
    workspaceFindUniqueMock.mockResolvedValueOnce({
      userId: "user_123",
      organizationId: null,
    });

    const app = createApp();
    const response = await app.request(`http://localhost/${WORKSPACE_ID}`);

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      data: {
        organizationId: null,
      },
      meta: expect.objectContaining({
        requestId: "req_123",
      }),
    });
    expect(resolveMemberOrganizationByIdMock).not.toHaveBeenCalled();
  });

  it("returns 403 when the workspace belongs to another user", async () => {
    workspaceFindUniqueMock.mockResolvedValueOnce({
      userId: "user_other",
      organizationId: null,
    });

    const app = createApp();
    const response = await app.request(`http://localhost/${WORKSPACE_ID}`);

    expect(response.status).toBe(403);
  });

  it("returns 404 when the workspace does not exist", async () => {
    workspaceFindUniqueMock.mockResolvedValueOnce(null);

    const app = createApp();
    const response = await app.request(`http://localhost/${WORKSPACE_ID}`);

    expect(response.status).toBe(404);
  });
});

/** A Serviceplan-style coworker key acting in an organization workspace. */
const COWORKER_CONTEXT: AuthenticationContext = {
  actor: "coworker",
  coworkerId: "cow_123",
  vendorId: "11111111-1111-7111-8111-111111111111",
  context: { userId: "user_123", organizationId: "org_1" },
};

const OTHER_WORKSPACE_ID = "99999999-9999-7999-8999-999999999999";

describe("GET /workspaces/{id} workspace scope", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    workspaceFindUniqueMock.mockResolvedValue({
      userId: null,
      organizationId: "org_1",
    });
    resolveMemberOrganizationByIdMock.mockResolvedValue({
      organization: { id: "org_1" },
      role: "member",
    });
  });

  it("serves the workspace the coworker context is active in", async () => {
    const app = createApp(COWORKER_CONTEXT, WORKSPACE_ID);

    const response = await app.request(`http://localhost/${WORKSPACE_ID}`);

    expect(response.status).toBe(200);
  });

  it("refuses another workspace, without reading it", async () => {
    const app = createApp(COWORKER_CONTEXT, WORKSPACE_ID);

    const response = await app.request(
      `http://localhost/${OTHER_WORKSPACE_ID}`,
    );

    expect(response.status).toBe(403);
    expect(workspaceFindUniqueMock).not.toHaveBeenCalled();
  });

  it("does not narrow a session user to the active workspace", async () => {
    const app = createApp(USER_AUTH_CONTEXT, WORKSPACE_ID);

    const response = await app.request(
      `http://localhost/${OTHER_WORKSPACE_ID}`,
    );

    expect(response.status).toBe(200);
  });
});
