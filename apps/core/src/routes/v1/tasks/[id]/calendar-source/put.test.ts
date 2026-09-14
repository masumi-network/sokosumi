import { TaskStatus } from "@sokosumi/database";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { errorHandler } from "@/helpers/error-handler";
import { createTaskScheduleRequestFingerprint } from "@/helpers/task-schedule-operation";
import { OpenAPIHonoWithAuth } from "@/lib/hono";
import type { AuthenticationContext } from "@/middleware/auth";

import mountPutTaskCalendarSource from "./put";

vi.mock("@/middleware/auth", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/middleware/auth")>();
  const { stubAuthMiddleware } = await import(
    "@/test-fixtures/auth-middleware"
  );
  return { ...actual, authMiddleware: stubAuthMiddleware };
});

const {
  createTaskSchedulePlannedOccurrencesMock,
  lockCalendarScopeMock,
  lockTaskRowsMock,
  memberFindFirstMock,
  notifyTaskCalendarActionMock,
  prismaMock,
  projectFindManyMock,
  quarantineFindUniqueMock,
  requireAssignedOrganizationSeatMock,
  requireTaskScheduleWriteAccessMock,
  retireTaskScheduleFutureOccurrencesMock,
  serializableTransactionMock,
  taskEventCreateMock,
  taskEventFindUniqueMock,
  taskUpdateMock,
} = vi.hoisted(() => {
  const memberFindFirstMock = vi.fn();
  const projectFindManyMock = vi.fn();
  return {
    createTaskSchedulePlannedOccurrencesMock: vi.fn(),
    lockCalendarScopeMock: vi.fn(),
    lockTaskRowsMock: vi.fn(),
    memberFindFirstMock,
    notifyTaskCalendarActionMock: vi.fn(),
    prismaMock: {
      member: { findFirst: memberFindFirstMock },
      project: { findMany: projectFindManyMock },
    },
    projectFindManyMock,
    quarantineFindUniqueMock: vi.fn(),
    requireAssignedOrganizationSeatMock: vi.fn(),
    requireTaskScheduleWriteAccessMock: vi.fn(),
    retireTaskScheduleFutureOccurrencesMock: vi.fn(),
    serializableTransactionMock: vi.fn(),
    taskEventCreateMock: vi.fn(),
    taskEventFindUniqueMock: vi.fn(),
    taskUpdateMock: vi.fn(),
  };
});

vi.mock("@/helpers/access-control", () => ({
  requireTaskScheduleWriteAccess: requireTaskScheduleWriteAccessMock,
}));
vi.mock("@/helpers/calendar-locks", () => ({
  lockCalendarScope: lockCalendarScopeMock,
  lockTaskRows: lockTaskRowsMock,
}));
vi.mock("@/helpers/organization-assigned-seat", () => ({
  requireAssignedOrganizationSeat: requireAssignedOrganizationSeatMock,
}));
vi.mock("@/helpers/task-notifications", () => ({
  notifyTaskCalendarAction: notifyTaskCalendarActionMock,
}));
vi.mock("@/helpers/task-schedule-occurrence-index", () => ({
  TaskScheduleOccurrenceLimitError: class TaskScheduleOccurrenceLimitError extends Error {},
  createTaskSchedulePlannedOccurrences:
    createTaskSchedulePlannedOccurrencesMock,
  retireTaskScheduleFutureOccurrences: retireTaskScheduleFutureOccurrencesMock,
}));
vi.mock("@/lib/db/transaction", () => ({
  serializableTransaction: serializableTransactionMock,
}));
vi.mock("@/lib/db/prisma", () => ({ default: prismaMock }));

const WORKSPACE_ID = "11111111-1111-7111-8111-111111111111";
const OLD_PROJECT_ID = "22222222-2222-7222-8222-222222222222";
const NEW_PROJECT_ID = "33333333-3333-7333-8333-333333333333";
const TASK_ID = "tsk_123";
const OPERATION_ID = "123e4567-e89b-42d3-a456-426614174777";
const NEXT_RUN_AT = new Date("2099-09-24T09:00:00.000Z");

function createMetadata() {
  return JSON.stringify({
    version: 2,
    epochId: "123e4567-e89b-42d3-a456-426614174000",
    mode: "recurring",
    createdAt: "2026-06-01T08:00:00.000Z",
    ruleEffectiveFrom: "2026-06-01T08:00:00.000Z",
    timezone: "UTC",
    expr: "0 9 * * *",
    endsMode: "after",
    targetReleaseCount: 5,
    anchorAt: "2026-06-01T09:00:00.000Z",
    epochReleaseCount: 2,
    lastProcessedSourceAt: "2026-06-03T09:00:00.000Z",
  });
}

function mockCurrentTask(overrides: Record<string, unknown> = {}) {
  requireTaskScheduleWriteAccessMock.mockResolvedValue({
    id: TASK_ID,
    ownerId: "user_123",
    name: "Scheduled task",
    status: TaskStatus.QUEUED,
    assigneeId: "coworker-1",
    assigneeSokoBotId: null,
    assigneeUserId: null,
    workspaceId: WORKSPACE_ID,
    organizationId: null,
    projectId: OLD_PROJECT_ID,
    metadata: createMetadata(),
    nextRunAt: NEXT_RUN_AT,
    scheduleRevision: 4,
    ...overrides,
  });
}

function request(
  source: Record<string, unknown>,
  overrides: Record<string, unknown> = {},
): [string, RequestInit] {
  return [
    `http://localhost/${TASK_ID}/calendar-source`,
    {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        operationId: OPERATION_ID,
        expectedScheduleRevision: 4,
        discardFutureExceptions: true,
        source,
        ...overrides,
      }),
    },
  ];
}

function createApp(
  authContext: AuthenticationContext = {
    actor: "user",
    userId: "user_123",
    organizationId: null,
    role: "user",
  },
) {
  const app = new OpenAPIHonoWithAuth();
  app.use("*", async (c, next) => {
    c.set("requestId", "req_calendar_source_put_test");
    c.set("isAuthenticated", true);
    c.set("authContext", authContext);
    c.set("workspaceContext", {
      workspaceId: WORKSPACE_ID,
      userId: "user_123",
      organizationId: null,
    });
    return await next();
  });
  app.onError(errorHandler);
  mountPutTaskCalendarSource(app);
  return app;
}

describe("PUT /tasks/{id}/calendar-source", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockCurrentTask();
    memberFindFirstMock.mockResolvedValue({ id: "member_123" });
    projectFindManyMock.mockImplementation(({ where }) =>
      where.id.in.map((id: string) => ({
        id,
        closingAt: null,
        closedAt: null,
      })),
    );
    lockCalendarScopeMock.mockResolvedValue(true);
    lockTaskRowsMock.mockResolvedValue(true);
    quarantineFindUniqueMock.mockResolvedValue(null);
    requireAssignedOrganizationSeatMock.mockResolvedValue(undefined);
    retireTaskScheduleFutureOccurrencesMock.mockResolvedValue({
      canceledCount: 2,
    });
    taskEventFindUniqueMock.mockResolvedValue(null);
    taskEventCreateMock.mockResolvedValue({ id: "evt_1" });
    taskUpdateMock.mockResolvedValue({ scheduleRevision: 5 });
    serializableTransactionMock.mockImplementation(async (callback) =>
      callback({
        project: { findMany: projectFindManyMock },
        task: { update: taskUpdateMock },
        taskEvent: {
          create: taskEventCreateMock,
          findUnique: taskEventFindUniqueMock,
        },
        taskScheduleQuarantine: { findUnique: quarantineFindUniqueMock },
      }),
    );
  });

  it("moves a live series to an open Project under both source locks", async () => {
    const response = await createApp().request(
      ...request({ type: "project", projectId: NEW_PROJECT_ID }),
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      data: {
        previousSource: { type: "project", projectId: OLD_PROJECT_ID },
        source: { type: "project", projectId: NEW_PROJECT_ID },
        scheduleRevision: 5,
        canceledFutureExceptionCount: 2,
      },
    });
    expect(lockCalendarScopeMock).toHaveBeenCalledWith(
      expect.any(Object),
      WORKSPACE_ID,
      [OLD_PROJECT_ID, NEW_PROJECT_ID],
    );
    expect(taskUpdateMock).toHaveBeenCalledWith({
      where: { id: TASK_ID },
      data: expect.objectContaining({
        projectId: NEW_PROJECT_ID,
        scheduleRevision: { increment: 1 },
        metadata: expect.any(String),
        nextRunAt: expect.any(Date),
      }),
      select: { scheduleRevision: true },
    });
    const nextMetadata = JSON.parse(
      taskUpdateMock.mock.calls[0][0].data.metadata,
    );
    expect(nextMetadata).toMatchObject({
      version: 2,
      expr: "0 9 * * *",
      targetReleaseCount: 3,
      epochReleaseCount: 0,
      anchorAt: "2026-06-01T09:00:00.000Z",
    });
    expect(nextMetadata.epochId).not.toBe(
      "123e4567-e89b-42d3-a456-426614174000",
    );
    expect(retireTaskScheduleFutureOccurrencesMock).toHaveBeenCalledOnce();
    expect(createTaskSchedulePlannedOccurrencesMock).toHaveBeenCalledWith(
      expect.any(Object),
      expect.objectContaining({
        id: TASK_ID,
        workspaceId: WORKSPACE_ID,
        projectId: NEW_PROJECT_ID,
        schedule: expect.objectContaining({ epochId: nextMetadata.epochId }),
      }),
      expect.any(Date),
    );
    expect(taskEventCreateMock).toHaveBeenCalledWith({
      data: expect.objectContaining({
        taskId: TASK_ID,
        scheduleKind: "SOURCE_CHANGED",
        scheduleOperationId: OPERATION_ID,
        schedulePayload: expect.objectContaining({
          action: "move_source",
          response: expect.objectContaining({ scheduleRevision: 5 }),
        }),
      }),
      select: { id: true },
    });
  });

  it("moves for a collaborating coworker acting with user context and attributes the event to the coworker", async () => {
    const app = createApp({
      actor: "coworker",
      coworkerId: "cow_123",
      vendorId: "01960001-0001-7001-8001-000000000001",
      context: { userId: "user_123", organizationId: "org_123" },
    });

    const response = await app.request(
      ...request({ type: "project", projectId: NEW_PROJECT_ID }),
    );

    expect(response.status).toBe(200);
    expect(memberFindFirstMock).toHaveBeenCalled();
    expect(requireAssignedOrganizationSeatMock).toHaveBeenCalledWith(
      "user_123",
      null,
      expect.anything(),
    );
    expect(taskEventCreateMock).toHaveBeenCalledWith({
      data: expect.objectContaining({
        taskId: TASK_ID,
        userId: null,
        coworkerId: "cow_123",
        sokoBotId: null,
        scheduleKind: "SOURCE_CHANGED",
      }),
      select: { id: true },
    });
  });

  it("moves a Project series back to its Workspace source", async () => {
    const response = await createApp().request(
      ...request({ type: "workspace" }),
    );

    expect(response.status).toBe(200);
    expect(projectFindManyMock).toHaveBeenCalledWith({
      where: {
        id: { in: [OLD_PROJECT_ID] },
        workspaceId: WORKSPACE_ID,
      },
      select: { id: true, closingAt: true, closedAt: true },
    });
    expect(taskUpdateMock).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ projectId: null }),
      }),
    );
  });

  it("replays the stored response before checking the stale revision", async () => {
    const storedResponse = {
      previousSource: { type: "project", projectId: OLD_PROJECT_ID },
      source: { type: "project", projectId: NEW_PROJECT_ID },
      scheduleRevision: 5,
      canceledFutureExceptionCount: 2,
    };
    taskEventFindUniqueMock.mockResolvedValue({
      id: "evt_1",
      schedulePayload: {
        requestFingerprint: createTaskScheduleRequestFingerprint({
          action: "move_source",
          taskId: TASK_ID,
          discardFutureExceptions: true,
          source: { type: "project", projectId: NEW_PROJECT_ID },
        }),
        response: storedResponse,
      },
    });
    mockCurrentTask({ projectId: NEW_PROJECT_ID, scheduleRevision: 5 });

    const response = await createApp().request(
      ...request({ type: "project", projectId: NEW_PROJECT_ID }),
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ data: storedResponse });
    expect(taskUpdateMock).not.toHaveBeenCalled();
    expect(retireTaskScheduleFutureOccurrencesMock).not.toHaveBeenCalled();
    expect(notifyTaskCalendarActionMock).toHaveBeenCalledWith(
      expect.objectContaining({
        eventId: "evt_1",
        messageKey: "Notifications.Task.scheduleSourceChangedByMember",
      }),
    );
  });

  it("rejects a stale schedule revision", async () => {
    mockCurrentTask({ scheduleRevision: 5 });

    const response = await createApp().request(
      ...request({ type: "workspace" }),
    );

    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({
      kind: "schedule_revision_conflict",
    });
    expect(taskUpdateMock).not.toHaveBeenCalled();
  });

  it("rejects when the source changes between preflight and the locked read", async () => {
    requireTaskScheduleWriteAccessMock
      .mockResolvedValueOnce({
        id: TASK_ID,
        status: TaskStatus.QUEUED,
        assigneeId: "coworker-1",
        assigneeSokoBotId: null,
        assigneeUserId: null,
        workspaceId: WORKSPACE_ID,
        organizationId: null,
        projectId: OLD_PROJECT_ID,
        metadata: createMetadata(),
        nextRunAt: NEXT_RUN_AT,
        scheduleRevision: 4,
      })
      .mockResolvedValueOnce({
        id: TASK_ID,
        status: TaskStatus.QUEUED,
        assigneeId: "coworker-1",
        assigneeSokoBotId: null,
        assigneeUserId: null,
        workspaceId: WORKSPACE_ID,
        organizationId: null,
        projectId: null,
        metadata: createMetadata(),
        nextRunAt: NEXT_RUN_AT,
        scheduleRevision: 5,
      });

    const response = await createApp().request(
      ...request({ type: "project", projectId: NEW_PROJECT_ID }),
    );

    expect(response.status).toBe(409);
    expect(taskEventFindUniqueMock).not.toHaveBeenCalled();
    expect(taskUpdateMock).not.toHaveBeenCalled();
  });

  it("rejects a closing target Project after taking the source locks", async () => {
    projectFindManyMock.mockResolvedValue([
      { id: OLD_PROJECT_ID, closingAt: null, closedAt: null },
      {
        id: NEW_PROJECT_ID,
        closingAt: new Date("2026-09-01T00:00:00.000Z"),
        closedAt: null,
      },
    ]);

    const response = await createApp().request(
      ...request({ type: "project", projectId: NEW_PROJECT_ID }),
    );

    expect(response.status).toBe(409);
    expect(lockCalendarScopeMock).toHaveBeenCalledOnce();
    expect(taskUpdateMock).not.toHaveBeenCalled();
  });

  it("rejects moving a postponed one-time series after its source run passed", async () => {
    mockCurrentTask({
      metadata: JSON.stringify({
        version: 2,
        epochId: "123e4567-e89b-42d3-a456-426614174000",
        mode: "once",
        createdAt: "2026-06-01T08:00:00.000Z",
        ruleEffectiveFrom: "2026-06-01T08:00:00.000Z",
        timezone: "UTC",
        sourceRunAt: "2020-06-01T09:00:00.000Z",
        effectiveRunAt: "2099-09-24T09:00:00.000Z",
      }),
    });

    const response = await createApp().request(
      ...request({ type: "workspace" }),
    );

    expect(response.status).toBe(409);
    expect(taskUpdateMock).not.toHaveBeenCalled();
    expect(retireTaskScheduleFutureOccurrencesMock).not.toHaveBeenCalled();
  });

  it("rejects moving an ended recurring rule kept live by an exception", async () => {
    mockCurrentTask({
      metadata: JSON.stringify({
        version: 2,
        epochId: "123e4567-e89b-42d3-a456-426614174000",
        mode: "recurring",
        createdAt: "2020-06-01T08:00:00.000Z",
        ruleEffectiveFrom: "2020-06-01T08:00:00.000Z",
        timezone: "UTC",
        expr: "0 9 * * *",
        endsMode: "on",
        endsOn: "2020-06-02T09:00:00.000Z",
        anchorAt: "2020-06-01T09:00:00.000Z",
        epochReleaseCount: 0,
      }),
    });

    const response = await createApp().request(
      ...request({ type: "workspace" }),
    );

    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({
      message: expect.stringContaining("leaves no future rule occurrence"),
    });
    expect(taskUpdateMock).not.toHaveBeenCalled();
    expect(retireTaskScheduleFutureOccurrencesMock).not.toHaveBeenCalled();
  });

  it("requires explicit confirmation before canceling future exceptions", async () => {
    const response = await createApp().request(
      ...request({ type: "workspace" }, { discardFutureExceptions: false }),
    );

    expect(response.status).toBe(422);
    expect(serializableTransactionMock).not.toHaveBeenCalled();
  });
});
