import { beforeEach, describe, expect, it, vi } from "vitest";
import { errorHandler } from "@/helpers/error-handler";
import { OpenAPIHonoWithAuth } from "@/lib/hono";
import type { AuthenticationContext } from "@/middleware/auth";
import { TEST_VENDOR_ID } from "@/test-fixtures/vendor.js";

import mountGetTaskWorkspace from "./get";

vi.mock("@/middleware/auth", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/middleware/auth")>();
  const { stubAuthMiddleware } = await import(
    "@/test-fixtures/auth-middleware"
  );
  return { ...actual, authMiddleware: stubAuthMiddleware };
});

const {
  getWorkspaceGrantMock,
  requireTaskReadForRouteVarsMock,
  workspaceRepositoryMock,
} = vi.hoisted(() => ({
  getWorkspaceGrantMock: vi.fn(),
  requireTaskReadForRouteVarsMock: vi.fn(),
  workspaceRepositoryMock: {
    resolveWorkspaceForContext: vi.fn(),
  },
}));

vi.mock("@sokosumi/database/repositories", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@sokosumi/database/repositories")>();
  return {
    ...actual,
    workspaceRepository: workspaceRepositoryMock,
  };
});

vi.mock("@/helpers/vendor-grants", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@/helpers/vendor-grants")>();
  return {
    ...actual,
    getWorkspaceGrant: getWorkspaceGrantMock,
  };
});

vi.mock("@/helpers/access-control", () => ({
  requireTaskReadForRouteVars: requireTaskReadForRouteVarsMock,
}));

vi.mock("@/lib/db/prisma", () => ({
  default: {},
}));

const WORKSPACE_ID = "11111111-1111-7111-8111-111111111111";

function createTask(overrides: { organizationId?: string | null } = {}) {
  const organizationId =
    "organizationId" in overrides ? overrides.organizationId : "org_123";

  return {
    name: "Research competitor pricing",
    workspaceId: WORKSPACE_ID,
    workspace: {
      organizationId,
    },
  };
}

const coworkerAuth = {
  actor: "coworker" as const,
  coworkerId: "cow_123",
  vendorId: TEST_VENDOR_ID,
  context: {
    userId: "user_123",
    organizationId: "org_123",
  },
};

function createApp(
  authContext: AuthenticationContext = {
    actor: "user",
    userId: "user_123",
    organizationId: "org_123",
    role: "user",
  },
) {
  const app = new OpenAPIHonoWithAuth();

  app.use("*", async (c, next) => {
    c.set("requestId", "req_workspace_get_test");
    c.set("isAuthenticated", true);
    c.set("authContext", authContext);
    c.set("workspaceContext", {
      workspaceId: WORKSPACE_ID,
      userId: null,
      organizationId: "org_123",
    });

    return await next();
  });
  app.onError(errorHandler);

  mountGetTaskWorkspace(app);

  return app;
}

describe("GET /tasks/{id}/workspace", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    workspaceRepositoryMock.resolveWorkspaceForContext.mockResolvedValue({
      id: "ws_task_workspace",
    });
    getWorkspaceGrantMock.mockResolvedValue({
      id: "grant_123",
      status: "GRANTED",
      permission: "WORKSPACE",
    });
    requireTaskReadForRouteVarsMock.mockResolvedValue(createTask());
  });

  it("returns the task title and workspace mapping for accessible tasks", async () => {
    const response = await createApp().request("/tsk_123/workspace");
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.data).toEqual({
      name: "Research competitor pricing",
      workspaceId: WORKSPACE_ID,
      organizationId: "org_123",
    });
    expect(requireTaskReadForRouteVarsMock).toHaveBeenCalledWith(
      expect.objectContaining({
        authContext: expect.objectContaining({
          actor: "user",
          userId: "user_123",
        }),
      }),
      "tsk_123",
      expect.any(Object),
      {
        workspace: { select: { organizationId: true } },
      },
    );
  });

  it("returns a personal workspace mapping when the task has no organization", async () => {
    requireTaskReadForRouteVarsMock.mockResolvedValue(
      createTask({
        organizationId: null,
      }),
    );

    const response = await createApp().request("/tsk_123/workspace");
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.data).toMatchObject({
      name: "Research competitor pricing",
      organizationId: null,
    });
  });

  it("allows coworker with GRANTED context as the context user", async () => {
    const response =
      await createApp(coworkerAuth).request("/tsk_123/workspace");
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.data.workspaceId).toBe(WORKSPACE_ID);
    expect(requireTaskReadForRouteVarsMock).toHaveBeenCalled();
  });

  it("returns 403 for bare coworker without context headers", async () => {
    const response = await createApp({
      actor: "coworker",
      coworkerId: "cow_123",
      vendorId: TEST_VENDOR_ID,
    }).request("/tsk_123/workspace");
    const body = await response.json();

    expect(response.status).toBe(403);
    expect(body.message).toBe(
      "Context headers (X-Context-User-Id) are required for this resource",
    );
    expect(requireTaskReadForRouteVarsMock).not.toHaveBeenCalled();
  });

  it("returns 403 for coworker with a DENIED workspace grant", async () => {
    getWorkspaceGrantMock.mockResolvedValue({
      id: "grant_123",
      status: "DENIED",
      permission: "WORKSPACE",
    });

    const response =
      await createApp(coworkerAuth).request("/tsk_123/workspace");
    const body = await response.json();

    expect(response.status).toBe(403);
    expect(body.message).toBe("Vendor workspace access was denied");
    expect(body.kind).toBe("grant_denied");
    expect(requireTaskReadForRouteVarsMock).not.toHaveBeenCalled();
  });

  it("returns 403 for coworker with a REVOKED workspace grant", async () => {
    getWorkspaceGrantMock.mockResolvedValue({
      id: "grant_123",
      status: "REVOKED",
      permission: "WORKSPACE",
    });

    const response =
      await createApp(coworkerAuth).request("/tsk_123/workspace");
    const body = await response.json();

    expect(response.status).toBe(403);
    expect(body.message).toBe("Vendor workspace access was revoked");
    expect(body.kind).toBe("grant_revoked");
    expect(requireTaskReadForRouteVarsMock).not.toHaveBeenCalled();
  });
});
