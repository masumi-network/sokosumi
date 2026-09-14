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
  coworkerFindFirstMock,
  getWorkspaceGrantMock,
  resolveMemberOrganizationByIdMock,
  taskFindFirstMock,
  workspaceRepositoryMock,
} = vi.hoisted(() => ({
  coworkerFindFirstMock: vi.fn(),
  getWorkspaceGrantMock: vi.fn(),
  resolveMemberOrganizationByIdMock: vi.fn(),
  taskFindFirstMock: vi.fn(),
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

vi.mock("@/helpers/organization", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@/helpers/organization")>();
  return {
    ...actual,
    resolveMemberOrganizationById: resolveMemberOrganizationByIdMock,
  };
});

vi.mock("@/lib/db/prisma", () => ({
  default: {
    coworker: {
      findFirst: coworkerFindFirstMock,
    },
    task: {
      findFirst: taskFindFirstMock,
    },
  },
}));

const ACTIVE_WORKSPACE_ID = "11111111-1111-7111-8111-111111111111";
const OTHER_WORKSPACE_ID = "22222222-2222-7222-8222-222222222222";

const otherWorkspaceTask = {
  name: "Quarterly report",
  ownerId: "user_123",
  workspaceId: OTHER_WORKSPACE_ID,
  workspace: {
    organizationId: "org_other",
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
    c.set("requestId", "req_workspace_cross_workspace_test");
    c.set("isAuthenticated", true);
    c.set("authContext", authContext);
    c.set("workspaceContext", {
      workspaceId: ACTIVE_WORKSPACE_ID,
      userId: "user_123",
      organizationId:
        authContext.actor === "user"
          ? authContext.organizationId
          : authContext.actor === "coworker"
            ? (authContext.context?.organizationId ?? "org_123")
            : "org_123",
    });

    return await next();
  });
  app.onError(errorHandler);

  mountGetTaskWorkspace(app);

  return app;
}

describe("GET /tasks/{id}/workspace cross-workspace mapping", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    workspaceRepositoryMock.resolveWorkspaceForContext.mockResolvedValue({
      id: ACTIVE_WORKSPACE_ID,
    });
    getWorkspaceGrantMock.mockResolvedValue({
      id: "grant_123",
      status: "GRANTED",
      permission: "WORKSPACE",
    });
    coworkerFindFirstMock.mockResolvedValue({
      id: "cow_123",
      slug: "ops-agent",
      baseURL: "http://coworker.test",
    });
    resolveMemberOrganizationByIdMock.mockResolvedValue({
      id: "org_other",
    });
    // Simulate the row living only in the other workspace.
    taskFindFirstMock.mockImplementation(
      async (args: { where?: { id?: string; workspaceId?: string } }) => {
        if (args.where?.id !== "tsk_other") {
          return null;
        }
        if (
          args.where.workspaceId &&
          args.where.workspaceId !== OTHER_WORKSPACE_ID
        ) {
          return null;
        }
        return otherWorkspaceTask;
      },
    );
  });

  it("returns the mapping when a session user is a member of the task's other workspace", async () => {
    const response = await createApp().request("/tsk_other/workspace");
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.data).toEqual({
      name: "Quarterly report",
      workspaceId: OTHER_WORKSPACE_ID,
      organizationId: "org_other",
    });
    expect(resolveMemberOrganizationByIdMock).toHaveBeenCalledWith({
      id: "org_other",
      userId: "user_123",
      tx: expect.any(Object),
    });
  });

  it("does not let a granted coworker resolve an unreadable task in another workspace", async () => {
    const response = await createApp({
      actor: "coworker",
      coworkerId: "cow_123",
      vendorId: TEST_VENDOR_ID,
      context: {
        userId: "user_123",
        organizationId: "org_123",
      },
    }).request("/tsk_other/workspace");

    expect(response.status).toBe(404);
    expect(resolveMemberOrganizationByIdMock).not.toHaveBeenCalled();
  });
});
