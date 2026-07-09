import { OpenAPIHono } from "@hono/zod-openapi";
import { TaskStatus } from "@sokosumi/utils";
import { HTTPException } from "hono/http-exception";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { OpenAPIHonoWithAuth } from "@/lib/hono";
import type { AuthVariables } from "@/middleware/auth";
import type { WorkspaceVariables } from "@/middleware/workspace";

import mountPutTaskWorkspace, { putTaskWorkspaceRequestSchema } from "./put";

const {
  jobFindFirstMock,
  jobUpdateManyMock,
  mapTaskMock,
  prismaTransactionMock,
  upsertWorkspaceForContextMock,
  resolveMemberOrganizationByIdMock,
  taskFindFirstMock,
  taskLinkFindFirstMock,
  taskFindUniqueOrThrowMock,
  taskUpdateMock,
} = vi.hoisted(() => ({
  jobFindFirstMock: vi.fn(),
  jobUpdateManyMock: vi.fn(),
  mapTaskMock: vi.fn(),
  prismaTransactionMock: vi.fn(),
  upsertWorkspaceForContextMock: vi.fn(),
  resolveMemberOrganizationByIdMock: vi.fn(),
  taskFindFirstMock: vi.fn(),
  taskLinkFindFirstMock: vi.fn(),
  taskFindUniqueOrThrowMock: vi.fn(),
  taskUpdateMock: vi.fn(),
}));

vi.mock("@/helpers/organization", () => ({
  resolveMemberOrganizationById: resolveMemberOrganizationByIdMock,
}));

vi.mock("@/helpers/task", () => ({
  mapTask: mapTaskMock,
}));

vi.mock("@sokosumi/database/repositories", () => ({
  workspaceRepository: {
    upsertWorkspaceForContext: upsertWorkspaceForContextMock,
  },
}));

vi.mock("@/lib/db/prisma", () => ({
  default: {
    $transaction: prismaTransactionMock,
  },
}));

interface TaskRecord {
  id: string;
  userId: string;
  organizationId: string | null;
  projectId: string | null;
  workspaceId: string;
  workspace: {
    organizationId: string | null;
  };
  coworkerId: string | null;
  name: string;
  description: string | null;
  status: TaskStatus;
  metadata: string | null;
  nextRunAt: Date | null;
}

interface TransactionMock {
  job: {
    findFirst?: ReturnType<typeof vi.fn>;
    updateMany: ReturnType<typeof vi.fn>;
  };
  task: {
    findFirst: ReturnType<typeof vi.fn>;
    findUniqueOrThrow: ReturnType<typeof vi.fn>;
    update: ReturnType<typeof vi.fn>;
  };
  taskLink: {
    findFirst: ReturnType<typeof vi.fn>;
  };
}

function createTaskRecord(overrides: Partial<TaskRecord> = {}): TaskRecord {
  return {
    id: "tsk_123",
    userId: "user_123",
    organizationId: "org_current",
    projectId: null,
    workspaceId: "11111111-1111-7111-8111-111111111111",
    workspace: {
      organizationId: "org_current",
    },
    coworkerId: "cow_123",
    name: "Current task",
    description: "Current description",
    status: TaskStatus.READY,
    metadata: null,
    nextRunAt: null,
    ...overrides,
  };
}

function createTaskApi(overrides: Partial<Record<string, unknown>> = {}) {
  const { organizationId: orgIdOverride, ...restOverrides } = overrides as {
    organizationId?: string | null;
  };
  const organizationId =
    orgIdOverride !== undefined ? orgIdOverride : "org_current";

  return {
    id: "tsk_123",
    createdAt: "2026-03-25T10:00:00.000Z",
    updatedAt: "2026-03-25T10:00:00.000Z",
    userId: "user_123",
    organizationId,
    projectId: null,
    user: { id: "user_123", name: "Task owner", image: null },
    organization:
      organizationId === null
        ? null
        : {
            id: organizationId,
            name: "Current Org",
            slug: "current-org",
          },
    coworkerId: "cow_123",
    coworker: {
      id: "cow_123",
      name: "Current Coworker",
      image: null,
      slug: "current-coworker",
    },
    name: "Current task",
    description: "Current description",
    status: TaskStatus.READY,
    metadata: null,
    nextRunAt: null,
    pendingVendorGrantId: null,
    awaitingVendorApproval: false,
    credits: 0,
    events: [],
    jobs: [],
    workspace: {
      id: "11111111-1111-4111-8111-111111111111",
      organizationId: "org_current",
      organization: {
        id: "org_current",
        name: "Current Org",
        slug: "current-org",
      },
    },
    share: null,
    links: [],
    ...restOverrides,
  };
}

function createApp(activeOrganizationId: string | null = "org_current") {
  const app = new OpenAPIHono<{
    Variables: AuthVariables & WorkspaceVariables;
  }>();

  app.use("*", async (c, next) => {
    c.set("isAuthenticated", true);
    c.set("authContext", {
      actor: "user",
      userId: "user_123",
      organizationId: activeOrganizationId,
      role: "user",
    });
    c.set("workspaceContext", {
      workspaceId: "11111111-1111-7111-8111-111111111111",
      userId: null,
      organizationId: activeOrganizationId,
    });

    return await next();
  });

  mountPutTaskWorkspace(app as unknown as OpenAPIHonoWithAuth);

  return app;
}

function mockTransaction(tx: TransactionMock) {
  prismaTransactionMock.mockImplementation(async (callback) => {
    return await callback(tx);
  });
}

describe("putTaskWorkspaceRequestSchema", () => {
  it("requires organizationId", () => {
    expect(() => putTaskWorkspaceRequestSchema.parse({})).toThrow();
  });

  it("accepts a target organization", () => {
    const result = putTaskWorkspaceRequestSchema.parse({
      organizationId: "org_target",
    });

    expect(result.organizationId).toBe("org_target");
  });

  it("accepts null for the personal workspace", () => {
    const result = putTaskWorkspaceRequestSchema.parse({
      organizationId: null,
    });

    expect(result.organizationId).toBeNull();
  });

  it("rejects empty-string organization ids", () => {
    expect(() =>
      putTaskWorkspaceRequestSchema.parse({
        organizationId: "",
      }),
    ).toThrow();
  });
});

describe("PUT /tasks/{id}/workspace", () => {
  beforeEach(() => {
    vi.clearAllMocks();

    const defaultTask = createTaskRecord();
    taskFindFirstMock.mockResolvedValue(defaultTask);
    resolveMemberOrganizationByIdMock.mockResolvedValue({
      organization: {
        id: "org_target",
      },
      role: "member",
    });
    upsertWorkspaceForContextMock.mockResolvedValue({
      id: "11111111-1111-4111-8111-111111111111",
      userId: null,
      organizationId: "org_target",
    });
    jobFindFirstMock.mockResolvedValue(null);
    jobUpdateManyMock.mockResolvedValue({ count: 0 });
    taskFindUniqueOrThrowMock.mockResolvedValue(createTaskRecord());
    taskLinkFindFirstMock.mockResolvedValue(null);
    taskUpdateMock.mockResolvedValue(createTaskRecord());
    mapTaskMock.mockImplementation((task: TaskRecord) =>
      createTaskApi({
        organizationId: task.organizationId,
        coworkerId: task.coworkerId,
        name: task.name,
        description: task.description,
        status: task.status,
      }),
    );

    mockTransaction({
      job: {
        findFirst: jobFindFirstMock,
        updateMany: jobUpdateManyMock,
      },
      task: {
        findFirst: taskFindFirstMock,
        findUniqueOrThrow: taskFindUniqueOrThrowMock,
        update: taskUpdateMock,
      },
      taskLink: {
        findFirst: taskLinkFindFirstMock,
      },
    });
  });

  it("moves an owned task by updating placement only", async () => {
    taskFindFirstMock.mockResolvedValue(
      createTaskRecord({
        organizationId: "org_billing",
        workspaceId: "11111111-1111-7111-8111-111111111111",
        workspace: {
          organizationId: null,
        },
        status: TaskStatus.RUNNING,
      }),
    );
    taskFindUniqueOrThrowMock.mockResolvedValue({
      ...createTaskRecord({
        organizationId: "org_billing",
        workspaceId: "11111111-1111-4111-8111-111111111111",
        workspace: {
          organizationId: "org_target",
        },
        status: TaskStatus.RUNNING,
      }),
      events: [],
      jobs: [],
      linksFrom: [],
      linksTo: [],
    });

    const app = createApp(null);
    const response = await app.request("http://localhost/tsk_123/workspace", {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        organizationId: "org_target",
      }),
    });

    expect(response.status).toBe(200);
    expect(resolveMemberOrganizationByIdMock).toHaveBeenCalledWith({
      id: "org_target",
      userId: "user_123",
      tx: expect.any(Object),
    });
    expect(taskUpdateMock).toHaveBeenCalledWith({
      where: {
        id: "tsk_123",
      },
      data: {
        workspaceId: "11111111-1111-4111-8111-111111111111",
        projectId: null,
      },
    });
    expect(jobUpdateManyMock).toHaveBeenCalledWith({
      where: { taskId: "tsk_123" },
      data: {
        workspaceId: "11111111-1111-4111-8111-111111111111",
        projectId: null,
      },
    });
    expect(taskFindUniqueOrThrowMock).toHaveBeenCalledWith({
      where: { id: "tsk_123" },
      include: expect.objectContaining({
        linksFrom: expect.objectContaining({
          where: {
            toTask: {
              is: {
                workspaceId: "11111111-1111-4111-8111-111111111111",
                archivedAt: null,
                pendingVendorGrantId: null,
              },
            },
          },
        }),
        linksTo: expect.objectContaining({
          where: {
            fromTask: {
              is: {
                workspaceId: "11111111-1111-4111-8111-111111111111",
                archivedAt: null,
                pendingVendorGrantId: null,
              },
            },
          },
        }),
      }),
    });
  });

  it("moves an organization task back to the personal workspace", async () => {
    taskFindFirstMock.mockResolvedValue(
      createTaskRecord({
        organizationId: "org_current",
        workspaceId: "11111111-1111-4111-8111-111111111111",
        workspace: {
          organizationId: "org_current",
        },
        status: TaskStatus.INPUT_REQUIRED,
      }),
    );
    taskFindUniqueOrThrowMock.mockResolvedValue({
      ...createTaskRecord({
        organizationId: "org_current",
        workspaceId: "11111111-1111-7111-8111-111111111111",
        workspace: {
          organizationId: null,
        },
        status: TaskStatus.INPUT_REQUIRED,
      }),
      events: [],
      jobs: [],
      linksFrom: [],
      linksTo: [],
    });

    const app = createApp("org_current");
    const response = await app.request("http://localhost/tsk_123/workspace", {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        organizationId: null,
      }),
    });

    expect(response.status).toBe(200);
    expect(resolveMemberOrganizationByIdMock).not.toHaveBeenCalled();
  });

  it("moves an organization task into another organization when the user is a member", async () => {
    taskFindFirstMock.mockResolvedValue(
      createTaskRecord({
        organizationId: "org_current",
        workspaceId: "11111111-1111-7111-8111-111111111111",
        workspace: {
          organizationId: "org_current",
        },
        status: TaskStatus.OUT_OF_CREDITS,
      }),
    );
    taskFindUniqueOrThrowMock.mockResolvedValue({
      ...createTaskRecord({
        organizationId: "org_current",
        workspaceId: "11111111-1111-4111-8111-111111111111",
        workspace: {
          organizationId: "org_other",
        },
        status: TaskStatus.OUT_OF_CREDITS,
      }),
      events: [],
      jobs: [],
      linksFrom: [],
      linksTo: [],
    });
    resolveMemberOrganizationByIdMock.mockResolvedValue({
      organization: {
        id: "org_other",
      },
      role: "member",
    });

    const app = createApp("org_current");
    const response = await app.request("http://localhost/tsk_123/workspace", {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        organizationId: "org_other",
      }),
    });

    expect(response.status).toBe(200);
    expect(resolveMemberOrganizationByIdMock).toHaveBeenCalledWith({
      id: "org_other",
      userId: "user_123",
      tx: expect.any(Object),
    });
  });

  it("returns 403 when the target organization is not a current membership", async () => {
    resolveMemberOrganizationByIdMock.mockRejectedValue(
      new HTTPException(403, {
        message: "You are not a member of this organization",
      }),
    );

    const app = createApp("org_current");
    const response = await app.request("http://localhost/tsk_123/workspace", {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        organizationId: "org_forbidden",
      }),
    });

    expect(response.status).toBe(403);
    expect(taskUpdateMock).not.toHaveBeenCalled();
  });

  it("returns 404 when the task is not accessible from the current context", async () => {
    taskFindFirstMock.mockResolvedValue(null);

    const app = createApp("org_current");
    const response = await app.request("http://localhost/tsk_123/workspace", {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        organizationId: "org_target",
      }),
    });

    expect(response.status).toBe(404);
    expect(taskUpdateMock).not.toHaveBeenCalled();
  });

  it("moves tasks even when they already have linked jobs", async () => {
    taskFindFirstMock.mockResolvedValue(
      createTaskRecord({
        status: TaskStatus.RUNNING,
        workspaceId: "11111111-1111-7111-8111-111111111111",
        workspace: {
          organizationId: "org_current",
        },
      }),
    );
    taskFindUniqueOrThrowMock.mockResolvedValue({
      ...createTaskRecord({
        organizationId: "org_current",
        workspaceId: "11111111-1111-4111-8111-111111111111",
        workspace: {
          organizationId: "org_target",
        },
        status: TaskStatus.RUNNING,
      }),
      events: [],
      jobs: [],
      linksFrom: [],
      linksTo: [],
    });

    const app = createApp("org_current");
    const response = await app.request("http://localhost/tsk_123/workspace", {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        organizationId: "org_target",
      }),
    });

    expect(response.status).toBe(200);
    expect(jobUpdateManyMock).toHaveBeenCalledWith({
      where: { taskId: "tsk_123" },
      data: {
        workspaceId: "11111111-1111-4111-8111-111111111111",
        projectId: null,
      },
    });
  });

  it("returns 409 when moving a task that still has outgoing links", async () => {
    taskLinkFindFirstMock.mockResolvedValue({
      id: "tl_123",
    });

    const app = createApp("org_current");
    const response = await app.request("http://localhost/tsk_123/workspace", {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        organizationId: "org_target",
      }),
    });

    expect(response.status).toBe(409);
    expect(taskLinkFindFirstMock).toHaveBeenCalledWith({
      where: {
        OR: [{ fromTaskId: "tsk_123" }, { toTaskId: "tsk_123" }],
      },
      select: {
        id: true,
      },
    });
    expect(taskUpdateMock).not.toHaveBeenCalled();
    expect(jobUpdateManyMock).not.toHaveBeenCalled();
  });

  it("allows idempotent no-op requests even when the task has links", async () => {
    taskFindFirstMock.mockResolvedValue(
      createTaskRecord({
        organizationId: "org_billing",
        workspaceId: "11111111-1111-4111-8111-111111111111",
        workspace: {
          organizationId: "org_current",
        },
      }),
    );
    taskLinkFindFirstMock.mockResolvedValue({
      id: "tl_123",
    });

    const app = createApp("org_current");
    const response = await app.request("http://localhost/tsk_123/workspace", {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        organizationId: "org_current",
      }),
    });

    expect(response.status).toBe(200);
    expect(taskLinkFindFirstMock).not.toHaveBeenCalled();
    expect(taskUpdateMock).not.toHaveBeenCalled();
    expect(jobUpdateManyMock).not.toHaveBeenCalled();
  });

  it("allows idempotent no-op updates without membership or guard checks", async () => {
    taskFindFirstMock.mockResolvedValue(
      createTaskRecord({
        organizationId: "org_billing",
        workspaceId: "11111111-1111-4111-8111-111111111111",
        workspace: {
          organizationId: "org_current",
        },
        status: TaskStatus.COMPLETED,
      }),
    );

    const app = createApp("org_current");
    const response = await app.request("http://localhost/tsk_123/workspace", {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        organizationId: "org_current",
      }),
    });

    expect(response.status).toBe(200);
    expect(resolveMemberOrganizationByIdMock).not.toHaveBeenCalled();
    expect(taskUpdateMock).not.toHaveBeenCalled();
    expect(jobUpdateManyMock).not.toHaveBeenCalled();
  });

  it("returns 400 for empty-string organization ids", async () => {
    const app = createApp("org_current");
    const response = await app.request("http://localhost/tsk_123/workspace", {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        organizationId: "",
      }),
    });

    expect(response.status).toBe(400);
    expect(taskFindFirstMock).not.toHaveBeenCalled();
    expect(taskUpdateMock).not.toHaveBeenCalled();
  });

  it("reads the current task instead of updating on idempotent no-op requests", async () => {
    const currentTask = createTaskRecord({
      organizationId: "org_billing",
      workspaceId: "11111111-1111-4111-8111-111111111111",
      workspace: {
        organizationId: "org_current",
      },
      status: TaskStatus.COMPLETED,
    });
    taskFindFirstMock.mockResolvedValue(currentTask);

    const currentTaskWithIncludes = {
      ...currentTask,
      events: [],
      jobs: [],
      linksFrom: [],
      linksTo: [],
    };
    taskFindUniqueOrThrowMock.mockResolvedValue(currentTaskWithIncludes);
    mockTransaction({
      job: {
        findFirst: jobFindFirstMock,
        updateMany: jobUpdateManyMock,
      },
      task: {
        findFirst: taskFindFirstMock,
        findUniqueOrThrow: taskFindUniqueOrThrowMock,
        update: taskUpdateMock,
      },
      taskLink: {
        findFirst: taskLinkFindFirstMock,
      },
    });
    mapTaskMock.mockReturnValue(
      createTaskApi({
        organizationId: "org_billing",
        status: TaskStatus.COMPLETED,
      }),
    );

    const app = createApp("org_current");
    const response = await app.request("http://localhost/tsk_123/workspace", {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        organizationId: "org_current",
      }),
    });

    expect(response.status).toBe(200);
    expect(taskFindUniqueOrThrowMock).toHaveBeenCalledWith({
      where: { id: "tsk_123" },
      include: expect.objectContaining({
        linksFrom: expect.objectContaining({
          where: {
            toTask: {
              is: {
                workspaceId: "11111111-1111-4111-8111-111111111111",
                archivedAt: null,
                pendingVendorGrantId: null,
              },
            },
          },
        }),
        linksTo: expect.objectContaining({
          where: {
            fromTask: {
              is: {
                workspaceId: "11111111-1111-4111-8111-111111111111",
                archivedAt: null,
                pendingVendorGrantId: null,
              },
            },
          },
        }),
      }),
    });
    expect(taskUpdateMock).not.toHaveBeenCalled();
  });
});
