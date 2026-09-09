import { TaskStatus } from "@sokosumi/database";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { errorHandler } from "@/helpers/error-handler";
import { OpenAPIHonoWithAuth } from "@/lib/hono";

import mountPutTaskCalendarSchedule from "./put";

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
  prismaMock,
  quarantineFindUniqueMock,
  requireAssignedOrganizationSeatMock,
  requireTaskCollaborationMock,
  retireTaskScheduleFutureOccurrencesMock,
  serializableTransactionMock,
  taskEventCreateMock,
  taskEventFindUniqueMock,
  taskFindUniqueOrThrowMock,
  taskUpdateMock,
} = vi.hoisted(() => {
  const memberFindFirstMock = vi.fn();
  return {
    createTaskSchedulePlannedOccurrencesMock: vi.fn(),
    lockCalendarScopeMock: vi.fn(),
    lockTaskRowsMock: vi.fn(),
    memberFindFirstMock,
    prismaMock: { member: { findFirst: memberFindFirstMock } },
    quarantineFindUniqueMock: vi.fn(),
    requireAssignedOrganizationSeatMock: vi.fn(),
    requireTaskCollaborationMock: vi.fn(),
    retireTaskScheduleFutureOccurrencesMock: vi.fn(),
    serializableTransactionMock: vi.fn(),
    taskEventCreateMock: vi.fn(),
    taskEventFindUniqueMock: vi.fn(),
    taskFindUniqueOrThrowMock: vi.fn(),
    taskUpdateMock: vi.fn(),
  };
});

vi.mock("@/helpers/access-control", () => ({
  requireTaskCollaboration: requireTaskCollaborationMock,
}));
vi.mock("@/helpers/calendar-locks", () => ({
  lockCalendarScope: lockCalendarScopeMock,
  lockTaskRows: lockTaskRowsMock,
}));
vi.mock("@/helpers/organization-assigned-seat", () => ({
  requireAssignedOrganizationSeat: requireAssignedOrganizationSeatMock,
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
const TASK_ID = "tsk_123";
const NEXT_RUN_AT = new Date("2099-09-24T09:00:00.000Z");
const OPERATION_ID = "123e4567-e89b-42d3-a456-426614174777";
const V2_EPOCH_ID = "123e4567-e89b-42d3-a456-426614174000";

const RECURRING_SCHEDULE = {
  mode: "recurring" as const,
  timezone: "UTC",
  expr: "0 9 * * *",
  endsMode: "never" as const,
};

function createV2Metadata(epochId = V2_EPOCH_ID) {
  return JSON.stringify({
    version: 2,
    epochId,
    mode: "recurring",
    createdAt: "2026-06-01T08:00:00.000Z",
    ruleEffectiveFrom: "2026-06-01T08:00:00.000Z",
    timezone: "UTC",
    expr: "0 9 * * *",
    endsMode: "never",
    anchorAt: "2026-06-01T08:00:00.000Z",
    epochReleaseCount: 0,
  });
}

function calendarRequest(body: Record<string, unknown>): [string, RequestInit] {
  return [
    `http://localhost/${TASK_ID}/calendar-schedule`,
    {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    },
  ];
}

function seriesEdit(
  schedule: Record<string, unknown>,
  overrides: Record<string, unknown> = {},
) {
  return {
    operationId: OPERATION_ID,
    expectedScheduleRevision: 4,
    discardFutureExceptions: true,
    schedule,
    ...overrides,
  };
}

function mockCurrentTask(
  metadata: string,
  overrides: Record<string, unknown> = {},
) {
  requireTaskCollaborationMock.mockResolvedValue({
    id: TASK_ID,
    status: TaskStatus.QUEUED,
    assigneeId: "coworker-1",
    assigneeSokoBotId: null,
    workspaceId: WORKSPACE_ID,
    organizationId: null,
    projectId: null,
    metadata,
    nextRunAt: NEXT_RUN_AT,
    scheduleRevision: 4,
    ...overrides,
  });
}

function createTaskResult(metadata: string, nextRunAt: Date) {
  const owner = { id: "user_123", name: "Owner", image: null };
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
    creatorSokoBotId: null,
    creatorSokoBot: null,
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

function createApp() {
  const app = new OpenAPIHonoWithAuth();
  app.use("*", async (c, next) => {
    c.set("requestId", "req_calendar_schedule_put_test");
    c.set("isAuthenticated", true);
    c.set("authContext", {
      actor: "user",
      userId: "user_123",
      organizationId: null,
      role: "user",
    });
    c.set("workspaceContext", {
      workspaceId: WORKSPACE_ID,
      userId: "user_123",
      organizationId: null,
    });
    return await next();
  });
  app.onError(errorHandler);
  mountPutTaskCalendarSchedule(app);
  return app;
}

describe("PUT /tasks/{id}/calendar-schedule", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    lockCalendarScopeMock.mockResolvedValue(true);
    lockTaskRowsMock.mockResolvedValue(true);
    quarantineFindUniqueMock.mockResolvedValue(null);
    requireAssignedOrganizationSeatMock.mockResolvedValue(undefined);
    retireTaskScheduleFutureOccurrencesMock.mockResolvedValue({
      canceledCount: 0,
    });
    taskEventFindUniqueMock.mockResolvedValue(null);
    taskEventCreateMock.mockResolvedValue({ id: "evt_1" });
    taskFindUniqueOrThrowMock.mockResolvedValue(
      createTaskResult(createV2Metadata(), NEXT_RUN_AT),
    );
    serializableTransactionMock.mockImplementation(async (callback) =>
      callback({
        task: {
          update: taskUpdateMock,
          findUniqueOrThrow: taskFindUniqueOrThrowMock,
        },
        taskEvent: {
          create: taskEventCreateMock,
          findUnique: taskEventFindUniqueMock,
        },
        taskScheduleQuarantine: { findUnique: quarantineFindUniqueMock },
      }),
    );
    taskUpdateMock.mockImplementation(async ({ data }) =>
      createTaskResult(data.metadata, data.nextRunAt ?? NEXT_RUN_AT),
    );
    memberFindFirstMock.mockResolvedValue({ id: "member_123" });
  });

  it("replaces a finite v1 rule with a mutable epoch in one revision", async () => {
    const metadata = JSON.stringify({
      version: 1,
      mode: "recurring",
      scheduledAt: "2026-06-01T08:00:00.000Z",
      lastRunAt: "2026-06-02T09:00:00.000Z",
      timezone: "UTC",
      expr: "0 9 * * *",
      endsMode: "after",
      occurrences: 3,
    });
    mockCurrentTask(metadata);

    const response = await createApp().request(
      ...calendarRequest(
        seriesEdit({
          mode: "recurring",
          timezone: "UTC",
          expr: "0 9 * * *",
          endsMode: "after",
          occurrences: 3,
        }),
      ),
    );

    expect(response.status).toBe(200);
    expect(serializableTransactionMock).toHaveBeenCalledOnce();
    expect(lockCalendarScopeMock).toHaveBeenCalledWith(
      expect.any(Object),
      WORKSPACE_ID,
      [null],
    );
    expect(taskUpdateMock).toHaveBeenCalledOnce();
    expect(taskUpdateMock.mock.calls[0][0].data.scheduleRevision).toEqual({
      increment: 1,
    });
    const saved = JSON.parse(taskUpdateMock.mock.calls[0][0].data.metadata);
    expect(saved).toMatchObject({
      version: 2,
      epochId: expect.stringMatching(
        /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
      ),
      expr: "0 9 * * *",
      targetReleaseCount: 3,
      epochReleaseCount: 0,
    });
    // The submitted count is what remains of the legacy series, so the new
    // epoch owes the same number of runs.
    expect(saved.targetReleaseCount - saved.epochReleaseCount).toBe(3);
    expect(createTaskSchedulePlannedOccurrencesMock).toHaveBeenCalledWith(
      expect.any(Object),
      expect.objectContaining({
        id: TASK_ID,
        schedule: expect.objectContaining({
          version: 2,
          epochId: saved.epochId,
        }),
      }),
      expect.any(Date),
    );
  });

  it("starts a new epoch and discards future exceptions even when the rule is unchanged", async () => {
    retireTaskScheduleFutureOccurrencesMock.mockResolvedValue({
      canceledCount: 3,
    });
    mockCurrentTask(createV2Metadata());

    const response = await createApp().request(
      ...calendarRequest(seriesEdit(RECURRING_SCHEDULE)),
    );

    expect(response.status).toBe(200);
    expect(taskUpdateMock).toHaveBeenCalledOnce();
    // A confirmed discardFutureExceptions never silently no-ops.
    expect(
      JSON.parse(taskUpdateMock.mock.calls[0][0].data.metadata).epochId,
    ).not.toBe(V2_EPOCH_ID);
    expect(retireTaskScheduleFutureOccurrencesMock).toHaveBeenCalledOnce();
    expect(createTaskSchedulePlannedOccurrencesMock).toHaveBeenCalledOnce();
    expect(
      taskEventCreateMock.mock.calls[0][0].data.schedulePayload,
    ).toMatchObject({ canceledFutureExceptionCount: 3 });
  });

  it("rejects users outside the Calendar beta before updating a Calendar schedule", async () => {
    memberFindFirstMock.mockResolvedValue(null);
    mockCurrentTask(createV2Metadata("123e4567-e89b-42d3-a456-426614174004"));

    const response = await createApp().request(
      ...calendarRequest(seriesEdit(RECURRING_SCHEDULE)),
    );

    expect(response.status).toBe(403);
    expect(requireTaskCollaborationMock).not.toHaveBeenCalled();
  });

  it("rejects the legacy bare schedule body on the Calendar route", async () => {
    mockCurrentTask(createV2Metadata());

    const response = await createApp().request(
      ...calendarRequest(RECURRING_SCHEDULE),
    );

    expect(response.status).toBe(422);
    expect(serializableTransactionMock).not.toHaveBeenCalled();
  });

  it("rejects an edit that does not confirm discarding future exceptions", async () => {
    mockCurrentTask(createV2Metadata());

    const response = await createApp().request(
      ...calendarRequest(
        seriesEdit(RECURRING_SCHEDULE, { discardFutureExceptions: false }),
      ),
    );

    expect(response.status).toBe(422);
    expect(serializableTransactionMock).not.toHaveBeenCalled();
  });

  it("rejects an edit that observed an older schedule revision", async () => {
    mockCurrentTask(createV2Metadata(), { scheduleRevision: 5 });

    const response = await createApp().request(
      ...calendarRequest(
        seriesEdit({ ...RECURRING_SCHEDULE, expr: "0 10 * * *" }),
      ),
    );

    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({
      kind: "schedule_revision_conflict",
    });
    expect(taskUpdateMock).not.toHaveBeenCalled();
    expect(retireTaskScheduleFutureOccurrencesMock).not.toHaveBeenCalled();
  });

  it("advances the schedule revision once and records the operation fingerprint", async () => {
    mockCurrentTask(createV2Metadata());

    const response = await createApp().request(
      ...calendarRequest(
        seriesEdit({ ...RECURRING_SCHEDULE, expr: "0 10 * * *" }),
      ),
    );

    expect(response.status).toBe(200);
    expect(taskUpdateMock).toHaveBeenCalledOnce();
    expect(taskUpdateMock.mock.calls[0][0].data.scheduleRevision).toEqual({
      increment: 1,
    });
    expect(taskEventCreateMock).toHaveBeenCalledOnce();
    const event = taskEventCreateMock.mock.calls[0][0].data;
    expect(event).toMatchObject({
      taskId: TASK_ID,
      scheduleKind: "UPDATED",
      scheduleOperationId: OPERATION_ID,
      userId: "user_123",
    });
    expect(event.schedulePayload).toMatchObject({
      action: "update_schedule",
      requestFingerprint: expect.stringMatching(/^[0-9a-f]{64}$/),
      workspaceId: WORKSPACE_ID,
    });
    // The audit record stores identity, never a rendered API response.
    expect(event.schedulePayload).not.toHaveProperty("data");
    expect(event.schedulePayload).not.toHaveProperty("task");
  });

  it("returns the stored Task without a second write when the operation is replayed", async () => {
    const app = createApp();
    const edit = seriesEdit({ ...RECURRING_SCHEDULE, expr: "0 10 * * *" });
    mockCurrentTask(createV2Metadata());

    const first = await app.request(...calendarRequest(edit));
    expect(first.status).toBe(200);
    const storedPayload =
      taskEventCreateMock.mock.calls[0][0].data.schedulePayload;

    taskUpdateMock.mockClear();
    taskEventCreateMock.mockClear();
    retireTaskScheduleFutureOccurrencesMock.mockClear();
    taskEventFindUniqueMock.mockResolvedValue({
      schedulePayload: storedPayload,
    });
    // The successful attempt already advanced the revision past the one the
    // client observed; the retry must still replay instead of conflicting.
    mockCurrentTask(createV2Metadata(), { scheduleRevision: 5 });

    const response = await app.request(...calendarRequest(edit));

    expect(response.status).toBe(200);
    expect(taskEventFindUniqueMock).toHaveBeenCalledWith({
      where: {
        taskId_scheduleOperationId: {
          taskId: TASK_ID,
          scheduleOperationId: OPERATION_ID,
        },
      },
      select: { schedulePayload: true },
    });
    expect(taskUpdateMock).not.toHaveBeenCalled();
    expect(taskEventCreateMock).not.toHaveBeenCalled();
    expect(retireTaskScheduleFutureOccurrencesMock).not.toHaveBeenCalled();
    expect(taskFindUniqueOrThrowMock).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: TASK_ID } }),
    );
  });

  it("rejects reusing one operation identity for a different schedule", async () => {
    mockCurrentTask(createV2Metadata());
    taskEventFindUniqueMock.mockResolvedValue({
      schedulePayload: {
        action: "update_schedule",
        requestFingerprint: "0".repeat(64),
      },
    });

    const response = await createApp().request(
      ...calendarRequest(
        seriesEdit({ ...RECURRING_SCHEDULE, expr: "0 10 * * *" }),
      ),
    );

    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({
      kind: "idempotency_conflict",
    });
    expect(taskUpdateMock).not.toHaveBeenCalled();
  });

  it("cancels durable future exceptions under the Calendar and Task locks", async () => {
    retireTaskScheduleFutureOccurrencesMock.mockResolvedValue({
      canceledCount: 2,
    });
    mockCurrentTask(createV2Metadata());

    const response = await createApp().request(
      ...calendarRequest(
        seriesEdit({ ...RECURRING_SCHEDULE, expr: "0 10 * * *" }),
      ),
    );

    expect(response.status).toBe(200);
    expect(retireTaskScheduleFutureOccurrencesMock).toHaveBeenCalledWith(
      expect.any(Object),
      TASK_ID,
      expect.any(Date),
    );
    const [retireOrder] =
      retireTaskScheduleFutureOccurrencesMock.mock.invocationCallOrder;
    const [scopeLockOrder] = lockCalendarScopeMock.mock.invocationCallOrder;
    const [taskLockOrder] = lockTaskRowsMock.mock.invocationCallOrder;
    expect(scopeLockOrder).toBeLessThan(retireOrder);
    expect(taskLockOrder).toBeLessThan(retireOrder);
    expect(
      retireTaskScheduleFutureOccurrencesMock.mock.invocationCallOrder[0],
    ).toBeLessThan(
      createTaskSchedulePlannedOccurrencesMock.mock.invocationCallOrder[0],
    );
    expect(
      taskEventCreateMock.mock.calls[0][0].data.schedulePayload,
    ).toMatchObject({ canceledFutureExceptionCount: 2 });
  });
});
