import { OpenAPIHono } from "@hono/zod-openapi";
import { TaskStatus } from "@sokosumi/database";
import { HTTPException } from "hono/http-exception";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { OpenAPIHonoWithAuth } from "@/lib/hono";
import type { AuthVariables } from "@/middleware/auth";
import type {
  WorkspaceContext,
  WorkspaceVariables,
} from "@/middleware/workspace";

import mountPatchTask from "./patch";

const {
  prismaTransactionMock,
  requireUserTaskAccessMock,
  requireTaskAssignableCoworkerMock,
  buildTaskIncludeForViewerMock,
  mapTaskMock,
  validateTaskCoworkerAssignmentMock,
  taskUpdateMock,
} = vi.hoisted(() => ({
  prismaTransactionMock: vi.fn(),
  requireUserTaskAccessMock: vi.fn(),
  requireTaskAssignableCoworkerMock: vi.fn(),
  buildTaskIncludeForViewerMock: vi.fn().mockReturnValue({}),
  mapTaskMock: vi.fn((task: unknown) => task),
  validateTaskCoworkerAssignmentMock: vi.fn(),
  taskUpdateMock: vi.fn(),
}));

vi.mock("@/lib/db/prisma", () => ({
  default: {
    $transaction: prismaTransactionMock,
  },
}));

vi.mock("@/helpers/access-control", () => ({
  requireUserTaskAccess: requireUserTaskAccessMock,
  requireTaskAssignableCoworker: requireTaskAssignableCoworkerMock,
}));

vi.mock("@/helpers/task", () => ({
  mapTask: mapTaskMock,
  validateTaskCoworkerAssignment: validateTaskCoworkerAssignmentMock,
}));

vi.mock("@/types/task", () => ({
  buildTaskIncludeForViewer: buildTaskIncludeForViewerMock,
}));

vi.mock("@/schemas/task.schema", () => ({
  taskSchema: {
    parse: (value: unknown) => value,
  },
}));

/** Matches production when tasks router runs with `includeWorkspaceContext: true`. */
const testWorkspaceContext: WorkspaceContext = {
  workspaceId: "workspace_123",
  userId: "user_123",
  organizationId: "org_123",
};

function createApp() {
  const app = new OpenAPIHono<{
    Variables: AuthVariables & WorkspaceVariables;
  }>();

  app.use("*", async (c, next) => {
    c.set("isAuthenticated", true);
    c.set("authContext", {
      actor: "user",
      userId: "user_123",
      organizationId: "org_123",
    });
    c.set("workspaceContext", testWorkspaceContext);

    return await next();
  });

  mountPatchTask(app as unknown as OpenAPIHonoWithAuth);

  return app;
}

function createTaskRecord(
  overrides: Partial<{
    userId: string;
    workspaceId: string;
    status: TaskStatus;
    coworkerId: string | null;
    name: string;
    description: string | null;
  }> = {},
) {
  return {
    id: "tsk_123",
    userId: "user_123",
    workspaceId: "workspace_123",
    status: TaskStatus.READY,
    coworkerId: null,
    name: "Original name",
    description: null,
    ...overrides,
  };
}

describe("PATCH /tasks/{id}", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    prismaTransactionMock.mockImplementation(async (callback) => {
      return await callback({
        task: {
          update: taskUpdateMock,
        },
      });
    });
    requireTaskAssignableCoworkerMock.mockResolvedValue(undefined);
    validateTaskCoworkerAssignmentMock.mockReturnValue(undefined);
    requireUserTaskAccessMock.mockResolvedValue(createTaskRecord());
    taskUpdateMock.mockResolvedValue({
      id: "tsk_123",
      name: "Updated task title",
      userId: "user_123",
      workspaceId: "workspace_123",
      status: TaskStatus.READY,
    });
  });

  it("requires owner task access before updating task metadata", async () => {
    const app = createApp();

    const response = await app.request("http://localhost/tsk_123", {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        name: "Updated task title",
      }),
    });

    expect(response.status).toBe(200);
    expect(requireUserTaskAccessMock).toHaveBeenCalledWith(
      {
        actor: "user",
        userId: "user_123",
        organizationId: "org_123",
      },
      "tsk_123",
      expect.any(Object),
    );
    expect(taskUpdateMock).toHaveBeenCalledWith({
      where: {
        id: "tsk_123",
        userId: "user_123",
        status: { in: [TaskStatus.DRAFT, TaskStatus.READY] },
      },
      data: {
        name: "Updated task title",
        description: undefined,
        coworkerId: undefined,
      },
      include: expect.any(Object),
    });
  });

  it("returns 404 when the current user does not own the task", async () => {
    requireUserTaskAccessMock.mockRejectedValueOnce(
      new HTTPException(404, { message: "Task not found" }),
    );

    const app = createApp();

    const response = await app.request("http://localhost/tsk_123", {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        name: "Updated task title",
      }),
    });

    expect(response.status).toBe(404);
    expect(taskUpdateMock).not.toHaveBeenCalled();
  });
});
