import { OpenAPIHono } from "@hono/zod-openapi";
import { TaskStatus } from "@sokosumi/database";
import { HTTPException } from "hono/http-exception";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { OpenAPIHonoWithAuth } from "@/lib/hono";
import type { AuthVariables } from "@/middleware/auth";

import mountPutTaskWorkspace, { putTaskWorkspaceRequestSchema } from "./put";

const {
  jobCountMock,
  mapTaskMock,
  prismaTransactionMock,
  requireUserTaskAccessMock,
  resolveMemberOrganizationByIdMock,
  taskEventCountMock,
  taskFindUniqueOrThrowMock,
  taskLinkCountMock,
  taskUpdateManyMock,
} = vi.hoisted(() => ({
  jobCountMock: vi.fn(),
  mapTaskMock: vi.fn(),
  prismaTransactionMock: vi.fn(),
  requireUserTaskAccessMock: vi.fn(),
  resolveMemberOrganizationByIdMock: vi.fn(),
  taskEventCountMock: vi.fn(),
  taskFindUniqueOrThrowMock: vi.fn(),
  taskLinkCountMock: vi.fn(),
  taskUpdateManyMock: vi.fn(),
}));

vi.mock("@/helpers/access-control", () => ({
  requireUserTaskAccess: requireUserTaskAccessMock,
}));

vi.mock("@/helpers/organization", () => ({
  resolveMemberOrganizationById: resolveMemberOrganizationByIdMock,
}));

vi.mock("@/helpers/task", () => ({
  mapTask: mapTaskMock,
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
  coworkerId: string | null;
  name: string;
  description: string | null;
  status: TaskStatus;
}

interface TransactionMock {
  job: {
    count: ReturnType<typeof vi.fn>;
  };
  task: {
    findUniqueOrThrow: ReturnType<typeof vi.fn>;
    updateMany: ReturnType<typeof vi.fn>;
  };
  taskEvent: {
    count: ReturnType<typeof vi.fn>;
  };
  taskLink: {
    count: ReturnType<typeof vi.fn>;
  };
}

function createTaskRecord(overrides: Partial<TaskRecord> = {}): TaskRecord {
  return {
    id: "tsk_123",
    userId: "user_123",
    organizationId: "org_current",
    coworkerId: "cow_123",
    name: "Current task",
    description: "Current description",
    status: TaskStatus.READY,
    ...overrides,
  };
}

function createTaskApi(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: "tsk_123",
    createdAt: "2026-03-25T10:00:00.000Z",
    updatedAt: "2026-03-25T10:00:00.000Z",
    userId: "user_123",
    organizationId: "org_current",
    coworkerId: "cow_123",
    name: "Current task",
    description: "Current description",
    status: TaskStatus.READY,
    credits: 0,
    events: [],
    jobs: [],
    share: null,
    links: [],
    ...overrides,
  };
}

function createApp(activeOrganizationId: string | null = "org_current") {
  const app = new OpenAPIHono<{
    Variables: AuthVariables;
  }>();

  app.use("*", async (c, next) => {
    c.set("isAuthenticated", true);
    c.set("authContext", {
      actor: "user",
      userId: "user_123",
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
    requireUserTaskAccessMock.mockResolvedValue(defaultTask);
    resolveMemberOrganizationByIdMock.mockResolvedValue({
      organization: {
        id: "org_target",
      },
      role: "member",
    });
    jobCountMock.mockResolvedValue(0);
    taskEventCountMock.mockResolvedValue(0);
    taskLinkCountMock.mockResolvedValue(0);
    taskFindUniqueOrThrowMock.mockResolvedValue(createTaskRecord());
    taskUpdateManyMock.mockResolvedValue({ count: 1 });
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
        count: jobCountMock,
      },
      task: {
        findUniqueOrThrow: taskFindUniqueOrThrowMock,
        updateMany: taskUpdateManyMock,
      },
      taskEvent: {
        count: taskEventCountMock,
      },
      taskLink: {
        count: taskLinkCountMock,
      },
    });
  });

  it("moves a personal task into an organization when the user is a member", async () => {
    requireUserTaskAccessMock.mockResolvedValue(
      createTaskRecord({
        organizationId: null,
        status: TaskStatus.RUNNING,
      }),
    );
    taskFindUniqueOrThrowMock.mockResolvedValue({
      ...createTaskRecord({
        organizationId: "org_target",
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
    expect(jobCountMock).toHaveBeenCalledWith({
      where: { taskId: "tsk_123" },
    });
    expect(taskEventCountMock).toHaveBeenCalledWith({
      where: {
        taskId: "tsk_123",
        transactionId: { not: null },
      },
    });
    expect(taskUpdateManyMock).toHaveBeenCalledWith({
      where: {
        id: "tsk_123",
        userId: "user_123",
        organizationId: null,
        archivedAt: null,
        status: TaskStatus.RUNNING,
      },
      data: {
        organizationId: "org_target",
      },
    });
  });

  it("moves an organization task back to the personal workspace", async () => {
    requireUserTaskAccessMock.mockResolvedValue(
      createTaskRecord({
        organizationId: "org_current",
        status: TaskStatus.INPUT_REQUIRED,
      }),
    );
    taskFindUniqueOrThrowMock.mockResolvedValue({
      ...createTaskRecord({
        organizationId: null,
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
    requireUserTaskAccessMock.mockResolvedValue(
      createTaskRecord({
        organizationId: "org_current",
        status: TaskStatus.OUT_OF_CREDITS,
      }),
    );
    taskFindUniqueOrThrowMock.mockResolvedValue({
      ...createTaskRecord({
        organizationId: "org_other",
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
    expect(taskUpdateManyMock).not.toHaveBeenCalled();
  });

  it("returns 404 when the task is not accessible from the current context", async () => {
    requireUserTaskAccessMock.mockRejectedValue(
      new HTTPException(404, {
        message: "Task not found",
      }),
    );

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
    expect(taskUpdateManyMock).not.toHaveBeenCalled();
  });

  it("moves a completed task when it has no jobs and no task events with transactions", async () => {
    requireUserTaskAccessMock.mockResolvedValue(
      createTaskRecord({
        status: TaskStatus.COMPLETED,
      }),
    );
    taskFindUniqueOrThrowMock.mockResolvedValue({
      ...createTaskRecord({
        organizationId: "org_target",
        status: TaskStatus.COMPLETED,
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
    expect(jobCountMock).toHaveBeenCalled();
    expect(taskEventCountMock).toHaveBeenCalled();
    expect(taskUpdateManyMock).toHaveBeenCalledWith({
      where: {
        id: "tsk_123",
        userId: "user_123",
        organizationId: "org_current",
        archivedAt: null,
        status: TaskStatus.COMPLETED,
      },
      data: {
        organizationId: "org_target",
      },
    });
  });

  it("returns 409 when the task already has jobs", async () => {
    requireUserTaskAccessMock.mockResolvedValue(
      createTaskRecord({
        status: TaskStatus.RUNNING,
      }),
    );
    jobCountMock.mockResolvedValue(1);

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
    expect(taskEventCountMock).not.toHaveBeenCalled();
    expect(taskUpdateManyMock).not.toHaveBeenCalled();
  });

  it("returns 409 when the task already has task events linked to a transaction", async () => {
    requireUserTaskAccessMock.mockResolvedValue(
      createTaskRecord({
        status: TaskStatus.RUNNING,
      }),
    );
    taskEventCountMock.mockResolvedValue(1);

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
    expect(taskUpdateManyMock).not.toHaveBeenCalled();
  });

  it("returns 409 when the task already has links", async () => {
    requireUserTaskAccessMock.mockResolvedValue(
      createTaskRecord({
        status: TaskStatus.RUNNING,
      }),
    );
    taskLinkCountMock.mockResolvedValue(1);

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
    expect(taskLinkCountMock).toHaveBeenCalledWith({
      where: {
        OR: [{ fromTaskId: "tsk_123" }, { toTaskId: "tsk_123" }],
      },
    });
    expect(taskUpdateManyMock).not.toHaveBeenCalled();
  });

  it("returns 409 when the task row no longer matches the expected status", async () => {
    requireUserTaskAccessMock.mockResolvedValue(
      createTaskRecord({
        status: TaskStatus.RUNNING,
      }),
    );
    taskUpdateManyMock.mockResolvedValue({ count: 0 });

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
    expect(taskFindUniqueOrThrowMock).not.toHaveBeenCalled();
  });

  it("allows idempotent no-op updates without membership or guard checks", async () => {
    requireUserTaskAccessMock.mockResolvedValue(
      createTaskRecord({
        organizationId: "org_current",
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
    expect(jobCountMock).not.toHaveBeenCalled();
    expect(taskEventCountMock).not.toHaveBeenCalled();
    expect(taskUpdateManyMock).not.toHaveBeenCalled();
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
    expect(requireUserTaskAccessMock).not.toHaveBeenCalled();
    expect(taskUpdateManyMock).not.toHaveBeenCalled();
  });

  it("reads the current task instead of updating on idempotent no-op requests", async () => {
    const currentTask = createTaskRecord({
      organizationId: "org_current",
      status: TaskStatus.COMPLETED,
    });
    requireUserTaskAccessMock.mockResolvedValue(currentTask);

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
        count: jobCountMock,
      },
      task: {
        findUniqueOrThrow: taskFindUniqueOrThrowMock,
        updateMany: taskUpdateManyMock,
      },
      taskEvent: {
        count: taskEventCountMock,
      },
      taskLink: {
        count: taskLinkCountMock,
      },
    });
    mapTaskMock.mockReturnValue(
      createTaskApi({
        organizationId: "org_current",
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
      include: expect.any(Object),
    });
    expect(taskUpdateManyMock).not.toHaveBeenCalled();
  });
});
