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

const { resolveMemberOrganizationByIdMock, taskFindUniqueMock } = vi.hoisted(
  () => ({
    resolveMemberOrganizationByIdMock: vi.fn(),
    taskFindUniqueMock: vi.fn(),
  }),
);

vi.mock("@/helpers/organization", () => ({
  resolveMemberOrganizationById: resolveMemberOrganizationByIdMock,
}));

vi.mock("@/lib/db/prisma", () => ({
  default: {
    task: {
      findUnique: taskFindUniqueMock,
    },
  },
}));

function createTask(
  overrides: { userId?: string; organizationId?: string | null } = {},
) {
  const organizationId =
    "organizationId" in overrides ? overrides.organizationId : "org_123";

  return {
    name: "Research competitor pricing",
    ownerId: overrides.userId ?? "user_123",
    workspaceId: "11111111-1111-7111-8111-111111111111",
    workspace: {
      organizationId,
    },
  };
}

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

    return await next();
  });
  app.onError(errorHandler);

  mountGetTaskWorkspace(app);

  return app;
}

describe("GET /tasks/{id}/workspace", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    taskFindUniqueMock.mockResolvedValue(createTask());
    resolveMemberOrganizationByIdMock.mockResolvedValue({
      organization: {
        id: "org_123",
      },
      role: "member",
    });
  });

  it("returns the task title and workspace mapping for accessible tasks", async () => {
    const response = await createApp().request("/tsk_123/workspace");
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.data).toEqual({
      name: "Research competitor pricing",
      workspaceId: "11111111-1111-7111-8111-111111111111",
      organizationId: "org_123",
    });
    expect(resolveMemberOrganizationByIdMock).toHaveBeenCalledWith({
      id: "org_123",
      userId: "user_123",
      tx: expect.any(Object),
    });
  });

  it("allows personal tasks owned by the caller", async () => {
    taskFindUniqueMock.mockResolvedValue(
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
    expect(resolveMemberOrganizationByIdMock).not.toHaveBeenCalled();
  });

  it("allows orchestrator with context headers as the context user", async () => {
    const response = await createApp({
      actor: "orchestrator",
      orchestratorId: "orch_123",
      context: {
        userId: "user_123",
        organizationId: "org_123",
      },
    }).request("/tsk_123/workspace");
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.data).toEqual({
      name: "Research competitor pricing",
      workspaceId: "11111111-1111-7111-8111-111111111111",
      organizationId: "org_123",
    });
    expect(resolveMemberOrganizationByIdMock).toHaveBeenCalledWith({
      id: "org_123",
      userId: "user_123",
      tx: expect.any(Object),
    });
  });

  it("allows coworker with context headers as the context user", async () => {
    const response = await createApp({
      actor: "coworker",
      coworkerId: "cow_123",
      vendorId: TEST_VENDOR_ID,
      context: {
        userId: "user_123",
        organizationId: "org_123",
      },
    }).request("/tsk_123/workspace");
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.data.workspaceId).toBe("11111111-1111-7111-8111-111111111111");
    expect(resolveMemberOrganizationByIdMock).toHaveBeenCalledWith({
      id: "org_123",
      userId: "user_123",
      tx: expect.any(Object),
    });
  });

  it("returns 403 for bare orchestrator without context headers", async () => {
    const response = await createApp({
      actor: "orchestrator",
      orchestratorId: "orch_123",
    }).request("/tsk_123/workspace");
    const body = await response.json();

    expect(response.status).toBe(403);
    expect(body.message).toBe(
      "Context headers (X-Context-User-Id) are required for this resource",
    );
    expect(taskFindUniqueMock).not.toHaveBeenCalled();
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
    expect(taskFindUniqueMock).not.toHaveBeenCalled();
  });
});
