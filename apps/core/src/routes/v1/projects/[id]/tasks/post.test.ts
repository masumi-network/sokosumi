import { OpenAPIHono } from "@hono/zod-openapi";
import { HTTPException } from "hono/http-exception";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { forbidden } from "@/helpers/error";
import type { OpenAPIHonoWithAuth } from "@/lib/hono";
import type { AuthenticationContext, AuthVariables } from "@/middleware/auth";
import type { WorkspaceVariables } from "@/middleware/workspace";

const {
  projectFindFirstMock,
  prismaTransactionMock,
  requireMutableTaskOwnershipMock,
  taskUpdateMock,
} = vi.hoisted(() => ({
  projectFindFirstMock: vi.fn(),
  prismaTransactionMock: vi.fn(),
  requireMutableTaskOwnershipMock: vi.fn(),
  taskUpdateMock: vi.fn(),
}));

vi.mock("@/helpers/access-control", () => ({
  requireMutableTaskOwnership: (...args: unknown[]) =>
    requireMutableTaskOwnershipMock(...args),
}));

vi.mock("@/middleware/auth", () => ({
  requireUserContext: (authContext: AuthenticationContext | null) => {
    if (!authContext || authContext.actor !== "user") {
      throw new HTTPException(403, { message: "User authentication required" });
    }
    return { source: "session" as const, ...authContext };
  },
}));

vi.mock("@/middleware/workspace", () => ({
  requireWorkspaceContext: (
    workspaceContext: { workspaceId: string } | null,
  ) => {
    if (!workspaceContext) {
      throw new HTTPException(400, { message: "Workspace context required" });
    }
    return workspaceContext;
  },
}));

vi.mock("@/lib/db/prisma", () => ({
  default: {
    project: { findFirst: projectFindFirstMock },
    $transaction: prismaTransactionMock,
  },
}));

const USER_AUTH_CONTEXT: AuthenticationContext = {
  actor: "user",
  userId: "user_123",
  organizationId: null,
  role: "user",
};

const WORKSPACE_ID = "aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa";
const PROJECT_ID = "22222222-2222-4222-8222-222222222222";
const TASK_ID = "tsk_abc";

const WORKSPACE_CONTEXT = {
  workspaceId: WORKSPACE_ID,
  userId: "user_123",
  organizationId: null,
} satisfies WorkspaceVariables["workspaceContext"];

const sampleProject = {
  id: PROJECT_ID,
  workspaceId: WORKSPACE_ID,
  name: "P",
  description: null,
  createdAt: new Date("2026-04-03T08:00:00.000Z"),
  updatedAt: new Date("2026-04-03T08:00:00.000Z"),
};

let mountPostProjectTask: (app: OpenAPIHonoWithAuth) => void;

function createApp() {
  const app = new OpenAPIHono<{
    Variables: AuthVariables & WorkspaceVariables & { requestId: string };
  }>();

  app.use("*", async (c, next) => {
    c.set("requestId", "req_123");
    c.set("isAuthenticated", true);
    c.set("authContext", USER_AUTH_CONTEXT);
    c.set("workspaceContext", WORKSPACE_CONTEXT);
    return await next();
  });

  mountPostProjectTask(app as unknown as OpenAPIHonoWithAuth);
  return app;
}

beforeAll(async () => {
  const module = await import("./post");
  mountPostProjectTask = module.default;
});

describe("POST /projects/{id}/tasks", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    projectFindFirstMock.mockResolvedValue(sampleProject);
    taskUpdateMock.mockResolvedValue({});
    prismaTransactionMock.mockImplementation(
      async (callback: (tx: unknown) => unknown) =>
        callback({
          task: { update: taskUpdateMock },
        }),
    );
  });

  it("links an owned mutable task to the project", async () => {
    requireMutableTaskOwnershipMock.mockResolvedValue({
      id: TASK_ID,
      workspaceId: WORKSPACE_ID,
      projectId: null,
      pendingVendorGrantId: null,
    });

    const response = await createApp().request(
      `http://localhost/${PROJECT_ID}/tasks`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ taskId: TASK_ID }),
      },
    );

    expect(response.status).toBe(200);
    expect(requireMutableTaskOwnershipMock).toHaveBeenCalledWith(
      expect.objectContaining({ userId: "user_123" }),
      TASK_ID,
      expect.anything(),
    );
    expect(taskUpdateMock).toHaveBeenCalledWith({
      where: { id: TASK_ID },
      data: {
        projectId: PROJECT_ID,
        workspaceId: WORKSPACE_ID,
      },
    });
  });

  it("returns 403 when the task is parked", async () => {
    requireMutableTaskOwnershipMock.mockRejectedValue(
      forbidden(
        "Parked tasks cannot be modified until vendor create access is granted",
        {
          kind: "task_parked",
        },
      ),
    );

    const response = await createApp().request(
      `http://localhost/${PROJECT_ID}/tasks`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ taskId: TASK_ID }),
      },
    );

    expect(response.status).toBe(403);
    expect(taskUpdateMock).not.toHaveBeenCalled();
  });

  it("returns 404 when project is missing", async () => {
    projectFindFirstMock.mockResolvedValue(null);

    const response = await createApp().request(
      `http://localhost/${PROJECT_ID}/tasks`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ taskId: TASK_ID }),
      },
    );

    expect(response.status).toBe(404);
    expect(requireMutableTaskOwnershipMock).not.toHaveBeenCalled();
  });
});
