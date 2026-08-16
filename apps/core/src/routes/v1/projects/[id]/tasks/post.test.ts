import { OpenAPIHono } from "@hono/zod-openapi";
import { TaskStatus } from "@sokosumi/database";
import { HTTPException } from "hono/http-exception";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import type { OpenAPIHonoWithAuth } from "@/lib/hono";
import type { AuthenticationContext, AuthVariables } from "@/middleware/auth";
import type { WorkspaceVariables } from "@/middleware/workspace";
import { TEST_VENDOR_ID } from "@/test-fixtures/vendor.js";

const { projectFindFirstMock, taskFindFirstMock, taskUpdateMock } = vi.hoisted(
  () => ({
    projectFindFirstMock: vi.fn(),
    taskFindFirstMock: vi.fn(),
    taskUpdateMock: vi.fn(),
  }),
);

vi.mock("@/middleware/auth", () => ({
  requireOwnerUserContext: (authContext: AuthenticationContext | null) => {
    if (!authContext || authContext.actor === "coworker") {
      throw new HTTPException(403, {
        message: "Coworker authentication cannot perform this owner action",
      });
    }
    if (authContext.actor !== "user") {
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
    task: {
      findFirst: taskFindFirstMock,
      update: taskUpdateMock,
    },
  },
}));

const USER_AUTH_CONTEXT: AuthenticationContext = {
  actor: "user",
  userId: "user_123",
  organizationId: null,
  role: "user",
};

const COWORKER_CONTEXT_AUTH: AuthenticationContext = {
  actor: "coworker",
  coworkerId: "cow_1",
  vendorId: TEST_VENDOR_ID,
  context: { userId: "user_123", organizationId: null },
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
  briefing: null,
  briefingUrl: null,
  contextMd: null,
  contextMdUrl: null,
  contextMdUpdatedAt: null,
  contextMdModel: null,
  contextMdUpdatingSince: null,
  contextMdVersion: 0,
  createdAt: new Date("2026-04-03T08:00:00.000Z"),
  updatedAt: new Date("2026-04-03T08:00:00.000Z"),
};

let mountPostProjectTask: (app: OpenAPIHonoWithAuth) => void;

function createApp(authContext: AuthenticationContext = USER_AUTH_CONTEXT) {
  const app = new OpenAPIHono<{
    Variables: AuthVariables & WorkspaceVariables & { requestId: string };
  }>();

  app.use("*", async (c, next) => {
    c.set("requestId", "req_123");
    c.set("isAuthenticated", true);
    c.set("authContext", authContext);
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
  });

  it("links a workspace task to the project without requiring ownership", async () => {
    taskFindFirstMock.mockResolvedValue({
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
    expect(taskUpdateMock).toHaveBeenCalledWith({
      where: { id: TASK_ID },
      data: {
        projectId: PROJECT_ID,
        workspaceId: WORKSPACE_ID,
      },
    });
  });

  it("returns 403 when the task is parked", async () => {
    taskFindFirstMock.mockResolvedValue({
      projectId: null,
      status: TaskStatus.GRANT_PENDING,
    });

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
    expect(taskFindFirstMock).not.toHaveBeenCalled();
  });

  it("rejects coworker context even with X-Context-User-Id", async () => {
    const response = await createApp(COWORKER_CONTEXT_AUTH).request(
      `http://localhost/${PROJECT_ID}/tasks`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ taskId: TASK_ID }),
      },
    );

    expect(response.status).toBe(403);
    expect(projectFindFirstMock).not.toHaveBeenCalled();
    expect(taskUpdateMock).not.toHaveBeenCalled();
  });
});
