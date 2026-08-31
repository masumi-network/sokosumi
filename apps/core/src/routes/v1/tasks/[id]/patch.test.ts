import { TaskStatus } from "@sokosumi/database";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { notifyTaskHumanAssignee } from "@/helpers/task-notifications";
import { OpenAPIHonoWithAuth } from "@/lib/hono";
import type { AuthenticationContext } from "@/middleware/auth";

import mountPatchTask, { patchTaskRequestSchema } from "./patch";

vi.mock("@/middleware/auth", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/middleware/auth")>();
  const { stubAuthMiddleware } = await import(
    "@/test-fixtures/auth-middleware"
  );
  return { ...actual, authMiddleware: stubAuthMiddleware };
});

const {
  mapTaskMock,
  prismaTransactionMock,
  projectFindFirstMock,
  refreshTaskSchedulePlannedOccurrencesMock,
  requireTaskAssignableCoworkerMock,
  requireTaskAssignableUserMock,
  requireTaskOwnershipMock,
  taskUpdateMock,
} = vi.hoisted(() => ({
  mapTaskMock: vi.fn(),
  prismaTransactionMock: vi.fn(),
  projectFindFirstMock: vi.fn(),
  refreshTaskSchedulePlannedOccurrencesMock: vi.fn(),
  requireTaskAssignableCoworkerMock: vi.fn(),
  requireTaskAssignableUserMock: vi.fn(),
  requireTaskOwnershipMock: vi.fn(),
  taskUpdateMock: vi.fn(),
}));

vi.mock("@/helpers/access-control", () => ({
  requireTaskAssignableCoworker: requireTaskAssignableCoworkerMock,
  requireTaskAssignableUser: requireTaskAssignableUserMock,
  requireMutableTaskOwnership: requireTaskOwnershipMock,
}));

vi.mock("@/helpers/task", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/helpers/task")>();

  return {
    ...actual,
    mapTask: mapTaskMock,
  };
});

vi.mock("@/helpers/task-schedule-occurrence-index", () => ({
  refreshTaskSchedulePlannedOccurrences:
    refreshTaskSchedulePlannedOccurrencesMock,
}));

vi.mock("@/helpers/task-notifications", () => ({
  notifyTaskHumanAssignee: vi.fn(),
}));

vi.mock("@/helpers/calendar-locks", () => ({
  lockCalendarScope: vi.fn().mockResolvedValue(true),
  lockTaskRows: vi.fn().mockResolvedValue(true),
}));

vi.mock("@/lib/db/prisma", () => ({
  default: {
    $transaction: prismaTransactionMock,
  },
}));

const WORKSPACE_ID = "11111111-1111-7111-8111-111111111111";
const PROJECT_ID = "aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa";
const OTHER_PROJECT_ID = "bbbbbbbb-bbbb-4bbb-bbbb-bbbbbbbbbbbb";

function createTaskApi(projectId: string | null = null) {
  return {
    id: "tsk_123",
    createdAt: "2026-04-02T08:00:00.000Z",
    updatedAt: "2026-04-02T08:00:00.000Z",
    ownerId: "user_123",
    organizationId: "org_123",
    projectId,
    owner: {
      id: "user_123",
      name: "Ada Lovelace",
      image: null,
    },
    userId: "user_123",
    user: {
      id: "user_123",
      name: "Ada Lovelace",
      image: null,
    },
    organization: {
      id: "org_123",
      name: "Acme Labs",
      slug: "acme-labs",
    },
    assigneeId: null,
    assigneeUserId: null,
    assignee: null,
    coworkerId: null,
    coworker: null,
    creator: {
      type: "user" as const,
      id: "user_123",
      user: {
        id: "user_123",
        name: "Ada Lovelace",
        image: null,
      },
    },
    orchestratorId: null,
    orchestrator: null,
    name: "Updated Task",
    description: null,
    status: TaskStatus.DRAFT,
    metadata: null,
    nextRunAt: null,
    grantResumeStatus: null,
    pendingVendorGrantId: null,
    credits: 0,
    events: [],
    jobs: [],
    workspace: {
      id: WORKSPACE_ID,
      organizationId: "org_123",
      organization: {
        id: "org_123",
        name: "Acme Labs",
        slug: "acme-labs",
      },
    },
    share: null,
    links: [],
    files: [],
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
    c.set("isAuthenticated", true);
    c.set("authContext", authContext);
    c.set("workspaceContext", {
      workspaceId: WORKSPACE_ID,
      userId: null,
      organizationId: "org_123",
    });

    return await next();
  });

  mountPatchTask(app);

  return app;
}

describe("patchTaskRequestSchema", () => {
  it("accepts projectId as the only patch field", () => {
    const result = patchTaskRequestSchema.parse({
      projectId: PROJECT_ID,
    });

    expect(result.projectId).toBe(PROJECT_ID);
  });

  it("accepts deprecated coworkerId as assigneeId", () => {
    const result = patchTaskRequestSchema.parse({
      coworkerId: "cow_legacy",
    });

    expect(result.assigneeId).toBe("cow_legacy");
    expect(result).not.toHaveProperty("coworkerId");
  });

  it("rejects conflicting assigneeId and coworkerId", () => {
    expect(() => {
      patchTaskRequestSchema.parse({
        assigneeId: "cow_a",
        coworkerId: "cow_b",
      });
    }).toThrow();
  });

  it("accepts assigneeUserId as the only patch field", () => {
    const result = patchTaskRequestSchema.parse({
      assigneeUserId: "user_123",
    });

    expect(result.assigneeUserId).toBe("user_123");
  });

  it("rejects coworker and user assignees together", () => {
    expect(() => {
      patchTaskRequestSchema.parse({
        assigneeId: "cow_a",
        assigneeUserId: "user_a",
      });
    }).toThrow();
  });
});

describe("PATCH /tasks/{id}", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    requireTaskOwnershipMock.mockResolvedValue({
      id: "tsk_123",
      status: TaskStatus.DRAFT,
      assigneeId: null,
      assigneeUserId: null,
      projectId: null,
      workspaceId: WORKSPACE_ID,
    });
    projectFindFirstMock.mockResolvedValue({ id: PROJECT_ID });
    refreshTaskSchedulePlannedOccurrencesMock.mockResolvedValue(undefined);
    taskUpdateMock.mockResolvedValue(createTaskApi(PROJECT_ID));
    mapTaskMock.mockImplementation((task) => createTaskApi(task.projectId));
    prismaTransactionMock.mockImplementation(async (callback) => {
      return await callback({
        project: {
          findFirst: projectFindFirstMock,
        },
        task: {
          update: taskUpdateMock,
        },
      });
    });
  });

  it("assigns a task to a workspace project", async () => {
    const app = createApp();

    const response = await app.request("http://localhost/tsk_123", {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        projectId: PROJECT_ID,
      }),
    });

    expect(response.status).toBe(200);
    expect(projectFindFirstMock).toHaveBeenCalledWith({
      where: {
        id: PROJECT_ID,
        workspaceId: WORKSPACE_ID,
      },
      select: { id: true },
    });
    expect(taskUpdateMock).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          projectId: PROJECT_ID,
        }),
      }),
    );
  });

  it("unassigns a task from its project", async () => {
    const app = createApp();
    requireTaskOwnershipMock.mockResolvedValue({
      id: "tsk_123",
      status: TaskStatus.DRAFT,
      assigneeId: null,
      assigneeUserId: null,
      projectId: PROJECT_ID,
      workspaceId: WORKSPACE_ID,
    });
    taskUpdateMock.mockResolvedValue(createTaskApi(null));

    const response = await app.request("http://localhost/tsk_123", {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        projectId: null,
      }),
    });

    expect(response.status).toBe(200);
    expect(projectFindFirstMock).not.toHaveBeenCalled();
    expect(taskUpdateMock).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          projectId: null,
        }),
      }),
    );
  });

  it("rejects assignment to a project outside the task workspace", async () => {
    const app = createApp();
    projectFindFirstMock.mockResolvedValue(null);

    const response = await app.request("http://localhost/tsk_123", {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        projectId: PROJECT_ID,
      }),
    });

    expect(response.status).toBe(404);
    expect(taskUpdateMock).not.toHaveBeenCalled();
  });

  it("rejects an update when the task moves workspaces before its row is locked", async () => {
    const app = createApp();
    requireTaskOwnershipMock
      .mockResolvedValueOnce({
        id: "tsk_123",
        status: TaskStatus.DRAFT,
        assigneeId: null,
        projectId: null,
        workspaceId: WORKSPACE_ID,
      })
      .mockResolvedValueOnce({
        id: "tsk_123",
        status: TaskStatus.DRAFT,
        assigneeId: null,
        projectId: null,
        workspaceId: "33333333-3333-4333-8333-333333333333",
      });

    const response = await app.request("http://localhost/tsk_123", {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        projectId: PROJECT_ID,
      }),
    });

    expect(response.status).toBe(409);
    expect(taskUpdateMock).not.toHaveBeenCalled();
    expect(refreshTaskSchedulePlannedOccurrencesMock).not.toHaveBeenCalled();
  });

  it("moves a task directly between projects", async () => {
    const app = createApp();
    requireTaskOwnershipMock.mockResolvedValue({
      id: "tsk_123",
      status: TaskStatus.DRAFT,
      assigneeId: null,
      assigneeUserId: null,
      projectId: OTHER_PROJECT_ID,
      workspaceId: WORKSPACE_ID,
    });

    const response = await app.request("http://localhost/tsk_123", {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        projectId: PROJECT_ID,
      }),
    });

    expect(response.status).toBe(200);
    expect(taskUpdateMock).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          projectId: PROJECT_ID,
        }),
      }),
    );
    expect(refreshTaskSchedulePlannedOccurrencesMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        id: "tsk_123",
        projectId: PROJECT_ID,
      }),
    );
  });

  it("updates metadata for a queued task", async () => {
    const app = createApp();
    requireTaskOwnershipMock.mockResolvedValue({
      id: "tsk_123",
      status: TaskStatus.QUEUED,
      assigneeId: "cow_123",
      assigneeUserId: null,
      projectId: null,
      workspaceId: WORKSPACE_ID,
    });
    taskUpdateMock.mockResolvedValue({
      ...createTaskApi(null),
      status: TaskStatus.QUEUED,
      name: "Updated queued task",
    });

    const response = await app.request("http://localhost/tsk_123", {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        name: "Updated queued task",
      }),
    });

    expect(response.status).toBe(200);
    expect(taskUpdateMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          status: {
            in: [TaskStatus.DRAFT, TaskStatus.QUEUED, TaskStatus.READY],
          },
        }),
        data: expect.objectContaining({
          name: "Updated queued task",
        }),
      }),
    );
  });

  it("returns 403 for coworker context even when X-Context-User-Id matches owner", async () => {
    const app = createApp({
      actor: "coworker",
      coworkerId: "cow_123",
      vendorId: "01960001-0001-7001-8001-000000000001",
      context: { userId: "user_123", organizationId: "org_123" },
    });

    const response = await app.request("http://localhost/tsk_123", {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        name: "Hijacked",
      }),
    });

    expect(response.status).toBe(403);
    expect(requireTaskOwnershipMock).not.toHaveBeenCalled();
  });

  it("notifies when a workspace member becomes the assignee", async () => {
    const app = createApp();
    taskUpdateMock.mockResolvedValue({
      ...createTaskApi(null),
      assigneeUserId: "user_assignee",
    });

    const response = await app.request("http://localhost/tsk_123", {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        assigneeUserId: "user_assignee",
      }),
    });

    expect(response.status).toBe(200);
    expect(notifyTaskHumanAssignee).toHaveBeenCalledWith(
      "tsk_123",
      "user_assignee",
    );
  });

  it("does not notify when the human assignee is cleared", async () => {
    const app = createApp();
    requireTaskOwnershipMock.mockResolvedValue({
      id: "tsk_123",
      status: TaskStatus.DRAFT,
      assigneeId: null,
      assigneeUserId: "user_assignee",
      projectId: null,
      workspaceId: WORKSPACE_ID,
    });
    taskUpdateMock.mockResolvedValue({
      ...createTaskApi(null),
      assigneeUserId: null,
    });

    const response = await app.request("http://localhost/tsk_123", {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        assigneeUserId: null,
      }),
    });

    expect(response.status).toBe(200);
    expect(notifyTaskHumanAssignee).not.toHaveBeenCalled();
  });

  it("does not notify when the task is assigned to a coworker", async () => {
    const app = createApp();
    taskUpdateMock.mockResolvedValue({
      ...createTaskApi(null),
      assigneeId: "cow_123",
      assigneeUserId: null,
    });

    const response = await app.request("http://localhost/tsk_123", {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        assigneeId: "cow_123",
        assigneeUserId: null,
      }),
    });

    expect(response.status).toBe(200);
    expect(notifyTaskHumanAssignee).not.toHaveBeenCalled();
  });
});
