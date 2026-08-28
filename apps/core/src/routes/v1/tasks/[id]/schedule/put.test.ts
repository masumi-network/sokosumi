import { TaskStatus } from "@sokosumi/database";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { errorHandler } from "@/helpers/error-handler";
import { OpenAPIHonoWithAuth } from "@/lib/hono";
import type { AuthenticationContext } from "@/middleware/auth";

import mountPutTaskSchedule from "./put";

vi.mock("@/middleware/auth", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/middleware/auth")>();
  const { stubAuthMiddleware } = await import(
    "@/test-fixtures/auth-middleware"
  );
  return { ...actual, authMiddleware: stubAuthMiddleware };
});

const {
  prismaTransactionMock,
  taskUpdateMock,
  requireTaskCollaborationMock,
  hasAssignedOrganizationSeatMock,
  lockCalendarScopeMock,
  lockTaskRowsMock,
  quarantineFindUniqueMock,
  replaceTaskSchedulePlannedOccurrencesMock,
} = vi.hoisted(() => ({
  prismaTransactionMock: vi.fn(),
  taskUpdateMock: vi.fn(),
  requireTaskCollaborationMock: vi.fn(),
  hasAssignedOrganizationSeatMock: vi.fn(),
  lockCalendarScopeMock: vi.fn(),
  lockTaskRowsMock: vi.fn(),
  quarantineFindUniqueMock: vi.fn(),
  replaceTaskSchedulePlannedOccurrencesMock: vi.fn(),
}));

vi.mock("@/helpers/access-control", () => ({
  requireTaskCollaboration: requireTaskCollaborationMock,
}));

vi.mock("@sokosumi/database/helpers", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@sokosumi/database/helpers")>();
  return {
    ...actual,
    hasAssignedOrganizationSeat: (...args: unknown[]) =>
      hasAssignedOrganizationSeatMock(...args),
  };
});

vi.mock("@/helpers/calendar-locks", () => ({
  lockCalendarScope: lockCalendarScopeMock,
  lockTaskRows: lockTaskRowsMock,
}));

vi.mock("@/helpers/task-schedule-occurrence-index", () => ({
  TaskScheduleOccurrenceLimitError: class TaskScheduleOccurrenceLimitError extends Error {},
  replaceTaskSchedulePlannedOccurrences:
    replaceTaskSchedulePlannedOccurrencesMock,
}));

vi.mock("@/lib/db/prisma", () => ({
  default: {
    $transaction: prismaTransactionMock,
    task: {
      update: taskUpdateMock,
    },
  },
}));

const WORKSPACE_ID = "11111111-1111-7111-8111-111111111111";
const TASK_ID = "tsk_123";

function createTaskResult(metadata: string, nextRunAt: Date) {
  const owner = { id: "user-1", name: "Owner", image: null };
  const assignee = {
    id: "coworker-1",
    name: "Coworker",
    image: null,
    slug: "coworker",
  };

  return {
    id: TASK_ID,
    createdAt: new Date("2026-08-01T00:00:00.000Z"),
    updatedAt: new Date("2026-08-01T00:00:00.000Z"),
    ownerId: owner.id,
    owner,
    organizationId: null,
    organization: null,
    projectId: null,
    assigneeId: assignee.id,
    assignee,
    creatorUserId: owner.id,
    creatorUser: owner,
    creatorCoworkerId: null,
    creatorCoworker: null,
    creatorOrchestratorId: null,
    creatorOrchestrator: null,
    name: "Scheduled task",
    description: "Do scheduled work",
    status: TaskStatus.QUEUED,
    grantResumeStatus: null,
    pendingVendorGrantId: null,
    metadata,
    nextRunAt,
    scheduleRevision: 0,
    events: [],
    jobs: [],
    files: [],
    linksFrom: [],
    linksTo: [],
    share: null,
    workspace: {
      id: WORKSPACE_ID,
      userId: owner.id,
      organizationId: null,
      organization: null,
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
    c.set("requestId", "req_schedule_put_test");
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
  mountPutTaskSchedule(app);
  return app;
}

describe("PUT /tasks/{id}/schedule", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    hasAssignedOrganizationSeatMock.mockResolvedValue(true);
    requireTaskCollaborationMock.mockResolvedValue({
      id: TASK_ID,
      status: TaskStatus.READY,
      assigneeId: "cow_123",
      ownerId: "user_123",
      workspaceId: WORKSPACE_ID,
      organizationId: "org_123",
      projectId: null,
    });
    lockCalendarScopeMock.mockResolvedValue(true);
    lockTaskRowsMock.mockResolvedValue(true);
    quarantineFindUniqueMock.mockResolvedValue(null);
    prismaTransactionMock.mockImplementation(async (callback) =>
      callback({
        task: { update: taskUpdateMock },
        taskScheduleQuarantine: { findUnique: quarantineFindUniqueMock },
        taskScheduleOccurrence: { deleteMany: vi.fn(), createMany: vi.fn() },
      }),
    );
    taskUpdateMock.mockImplementation(async ({ data }) =>
      createTaskResult(data.metadata, data.nextRunAt),
    );
  });

  it("returns 403 when the member has no assigned organization seat", async () => {
    hasAssignedOrganizationSeatMock.mockResolvedValue(false);

    const app = createApp();
    const response = await app.request(`http://localhost/${TASK_ID}/schedule`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        mode: "once",
        runAt: "2099-01-01T09:00:00.000Z",
      }),
    });

    expect(response.status).toBe(403);
    expect(prismaTransactionMock).toHaveBeenCalled();
    expect(taskUpdateMock).not.toHaveBeenCalled();
  });

  it("returns 403 for coworker context even when X-Context-User-Id matches owner", async () => {
    const app = createApp({
      actor: "coworker",
      coworkerId: "cow_123",
      vendorId: "01960001-0001-7001-8001-000000000001",
      context: { userId: "user_123", organizationId: "org_123" },
    });

    const response = await app.request(`http://localhost/${TASK_ID}/schedule`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        mode: "once",
        runAt: "2099-01-01T09:00:00.000Z",
      }),
    });

    expect(response.status).toBe(403);
    expect(requireTaskCollaborationMock).not.toHaveBeenCalled();
    expect(taskUpdateMock).not.toHaveBeenCalled();
  });

  it.each([
    {
      name: "legacy",
      body: { mode: "once", runAt: "2099-09-24T09:00:00.000Z" },
    },
    {
      name: "operation-aware",
      body: {
        operationId: "123e4567-e89b-42d3-a456-426614174000",
        expectedScheduleRevision: 0,
        discardFutureExceptions: true,
        schedule: { mode: "once", runAt: "2099-09-24T09:00:00.000Z" },
      },
    },
  ])("persists $name requests as metadata version 1", async ({ body }) => {
    requireTaskCollaborationMock.mockResolvedValue({
      id: TASK_ID,
      status: TaskStatus.DRAFT,
      assigneeId: "coworker-1",
      workspaceId: WORKSPACE_ID,
      organizationId: null,
      projectId: null,
    });
    taskUpdateMock.mockImplementation(async ({ data }) =>
      createTaskResult(data.metadata, data.nextRunAt),
    );

    const response = await createApp().request(
      `http://localhost/${TASK_ID}/schedule`,
      {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      },
    );

    expect(response.status).toBe(200);
    const update = taskUpdateMock.mock.calls[0]?.[0];
    expect(JSON.parse(update.data.metadata)).toMatchObject({
      version: 1,
      mode: "once",
      runAt: "2099-09-24T09:00:00.000Z",
    });
    expect(lockCalendarScopeMock).toHaveBeenCalledWith(
      expect.any(Object),
      WORKSPACE_ID,
      [null],
    );
  });

  it("returns a conflict when the Task Calendar source cannot be locked", async () => {
    lockCalendarScopeMock.mockResolvedValue(false);

    const response = await createApp().request(
      `http://localhost/${TASK_ID}/schedule`,
      {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          mode: "once",
          runAt: "2099-09-24T09:00:00.000Z",
        }),
      },
    );

    expect(response.status).toBe(409);
    expect(taskUpdateMock).not.toHaveBeenCalled();
  });

  it("materializes the rolling planned occurrence index with the saved schedule", async () => {
    const response = await createApp().request(
      `http://localhost/${TASK_ID}/schedule`,
      {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          mode: "once",
          runAt: "2099-09-24T09:00:00.000Z",
        }),
      },
    );

    expect(response.status).toBe(200);
    expect(replaceTaskSchedulePlannedOccurrencesMock).toHaveBeenCalledWith(
      expect.any(Object),
      expect.objectContaining({
        id: TASK_ID,
        workspaceId: WORKSPACE_ID,
        projectId: null,
        nextRunAt: expect.any(Date),
        schedule: expect.objectContaining({ version: 1, mode: "once" }),
      }),
    );
  });

  it("does not overwrite a quarantined schedule", async () => {
    quarantineFindUniqueMock.mockResolvedValue({ id: "quarantine-1" });

    const response = await createApp().request(
      `http://localhost/${TASK_ID}/schedule`,
      {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          mode: "once",
          runAt: "2099-09-24T09:00:00.000Z",
        }),
      },
    );

    expect(response.status).toBe(409);
    expect(taskUpdateMock).not.toHaveBeenCalled();
  });
});
