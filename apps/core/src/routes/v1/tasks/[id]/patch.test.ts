import { TaskStatus } from "@sokosumi/database";
import { beforeEach, describe, expect, it, vi } from "vitest";

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
  requireTaskOwnershipMock,
  taskFindFirstMock,
  taskFindUniqueOrThrowMock,
  taskUpdateMock,
} = vi.hoisted(() => ({
  mapTaskMock: vi.fn(),
  prismaTransactionMock: vi.fn(),
  projectFindFirstMock: vi.fn(),
  refreshTaskSchedulePlannedOccurrencesMock: vi.fn(),
  requireTaskAssignableCoworkerMock: vi.fn(),
  requireTaskOwnershipMock: vi.fn(),
  taskFindFirstMock: vi.fn(),
  taskFindUniqueOrThrowMock: vi.fn(),
  taskUpdateMock: vi.fn(),
}));

vi.mock("@/helpers/access-control", () => ({
  requireTaskAssignableCoworker: requireTaskAssignableCoworkerMock,
  requireMutableTaskOwnership: requireTaskOwnershipMock,
}));

vi.mock("@/helpers/organization-assigned-seat", () => ({
  requireAssignedOrganizationSeat: vi.fn().mockResolvedValue(undefined),
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
    assigneeOrchestratorId: null,
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

  it("rejects conflicting assigneeId and assigneeOrchestratorId", () => {
    expect(() => {
      patchTaskRequestSchema.parse({
        assigneeId: "cow_a",
        assigneeOrchestratorId: "01960001-0001-7001-8001-000000000099",
      });
    }).toThrow();
  });

  it("accepts assigneeOrchestratorId as the only assignee field", () => {
    const result = patchTaskRequestSchema.parse({
      assigneeOrchestratorId: "01960001-0001-7001-8001-000000000099",
    });

    expect(result.assigneeOrchestratorId).toBe(
      "01960001-0001-7001-8001-000000000099",
    );
    expect(result.assigneeId).toBeUndefined();
  });
});

function defaultMutableTaskRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "tsk_123",
    status: TaskStatus.DRAFT,
    assigneeId: null,
    assigneeOrchestratorId: null,
    projectId: null,
    workspaceId: WORKSPACE_ID,
    ownerId: "user_123",
    archivedAt: null,
    organizationId: "org_123",
    metadata: null,
    nextRunAt: null,
    ...overrides,
  };
}

describe("PATCH /tasks/{id}", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    const taskRow = defaultMutableTaskRow();
    requireTaskOwnershipMock.mockResolvedValue({
      id: taskRow.id,
      status: taskRow.status,
      assigneeId: taskRow.assigneeId,
      assigneeOrchestratorId: taskRow.assigneeOrchestratorId,
      projectId: taskRow.projectId,
      workspaceId: taskRow.workspaceId,
    });
    projectFindFirstMock.mockResolvedValue({ id: PROJECT_ID });
    refreshTaskSchedulePlannedOccurrencesMock.mockResolvedValue(undefined);
    taskFindFirstMock.mockResolvedValue(taskRow);
    taskUpdateMock.mockResolvedValue(createTaskApi(PROJECT_ID));
    taskFindUniqueOrThrowMock.mockImplementation(async () => {
      const updated = await taskUpdateMock.mock.results.at(-1)?.value;
      return updated ?? createTaskApi(PROJECT_ID);
    });
    mapTaskMock.mockImplementation((task) => createTaskApi(task.projectId));
    prismaTransactionMock.mockImplementation(async (callback) => {
      return await callback({
        project: {
          findFirst: projectFindFirstMock,
        },
        task: {
          findFirst: taskFindFirstMock,
          update: taskUpdateMock,
          findUniqueOrThrow: taskFindUniqueOrThrowMock,
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
});
