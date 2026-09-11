import { TaskStatus } from "@sokosumi/database";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { errorHandler } from "@/helpers/error-handler";
import { OpenAPIHonoWithAuth } from "@/lib/hono";
import type { AuthenticationContext } from "@/middleware/auth";

import mountDeleteTaskSchedule from "./delete";

vi.mock("@/middleware/auth", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/middleware/auth")>();
  const { stubAuthMiddleware } = await import(
    "@/test-fixtures/auth-middleware"
  );
  return { ...actual, authMiddleware: stubAuthMiddleware };
});

const {
  serializableTransactionMock,
  memberFindFirstMock,
  requireTaskCollaborationMock,
  lockCalendarScopeMock,
  lockTaskRowsMock,
  quarantineFindUniqueMock,
  retireTaskScheduleFutureOccurrencesMock,
  taskEventCreateMock,
  taskEventFindUniqueMock,
  taskFindUniqueOrThrowMock,
  taskUpdateMock,
} = vi.hoisted(() => ({
  serializableTransactionMock: vi.fn(),
  memberFindFirstMock: vi.fn(),
  requireTaskCollaborationMock: vi.fn(),
  lockCalendarScopeMock: vi.fn(),
  lockTaskRowsMock: vi.fn(),
  quarantineFindUniqueMock: vi.fn(),
  retireTaskScheduleFutureOccurrencesMock: vi.fn(),
  taskEventCreateMock: vi.fn(),
  taskEventFindUniqueMock: vi.fn(),
  taskFindUniqueOrThrowMock: vi.fn(),
  taskUpdateMock: vi.fn(),
}));

vi.mock("@/helpers/access-control", () => ({
  requireTaskCollaboration: requireTaskCollaborationMock,
}));

vi.mock("@/helpers/calendar-locks", () => ({
  lockCalendarScope: lockCalendarScopeMock,
  lockTaskRows: lockTaskRowsMock,
}));

vi.mock("@/helpers/task-schedule-occurrence-index", () => ({
  retireTaskScheduleFutureOccurrences: retireTaskScheduleFutureOccurrencesMock,
}));

vi.mock("@/lib/db/transaction", () => ({
  serializableTransaction: serializableTransactionMock,
}));

vi.mock("@/lib/db/prisma", () => ({
  default: {
    member: { findFirst: memberFindFirstMock },
  },
}));

const WORKSPACE_ID = "11111111-1111-7111-8111-111111111111";
const TASK_ID = "tsk_123";
const OPERATION_ID = "123e4567-e89b-42d3-a456-426614174777";

function removalRequest(
  headers: Record<string, string> = {
    "Idempotency-Key": OPERATION_ID,
    "x-schedule-revision": "4",
  },
): [string, RequestInit] {
  return [
    `http://localhost/${TASK_ID}/schedule`,
    { method: "DELETE", headers },
  ];
}

function createUpdatedTask() {
  const owner = { id: "user_123", name: "Owner", image: null };
  return {
    id: "tsk_123",
    createdAt: new Date("2026-06-01T00:00:00.000Z"),
    updatedAt: new Date("2026-06-01T00:00:00.000Z"),
    ownerId: owner.id,
    owner,
    organizationId: "org_123",
    organization: {
      id: "org_123",
      name: "Organization",
      slug: "organization",
      logo: null,
    },
    projectId: null,
    assigneeId: null,
    assigneeSokoBotId: null,
    assignee: null,
    creatorUserId: owner.id,
    creatorUser: owner,
    creatorCoworkerId: null,
    creatorCoworker: null,
    creatorSokoBotId: null,
    creatorSokoBot: null,
    name: "Scheduled task",
    description: null,
    status: TaskStatus.DRAFT,
    grantResumeStatus: null,
    pendingVendorGrantId: null,
    metadata: null,
    nextRunAt: null,
    scheduleRevision: 0,
    events: [],
    jobs: [],
    files: [],
    linksFrom: [],
    linksTo: [],
    share: null,
    workspace: {
      id: WORKSPACE_ID,
      userId: null,
      organizationId: "org_123",
      organization: {
        id: "org_123",
        name: "Organization",
        slug: "organization",
        logo: null,
      },
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
    c.set("requestId", "req_schedule_delete_test");
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
  mountDeleteTaskSchedule(app);
  return app;
}

describe("DELETE /tasks/{id}/schedule", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    memberFindFirstMock.mockResolvedValue({ id: "member_123" });
    requireTaskCollaborationMock.mockResolvedValue({
      id: TASK_ID,
      status: TaskStatus.READY,
      workspaceId: WORKSPACE_ID,
      projectId: null,
      scheduleRevision: 4,
    });
    lockCalendarScopeMock.mockResolvedValue(true);
    lockTaskRowsMock.mockResolvedValue(true);
    quarantineFindUniqueMock.mockResolvedValue(null);
    retireTaskScheduleFutureOccurrencesMock.mockResolvedValue({
      canceledCount: 0,
    });
    taskEventFindUniqueMock.mockResolvedValue(null);
    taskEventCreateMock.mockResolvedValue({ id: "evt_1" });
    taskFindUniqueOrThrowMock.mockResolvedValue(createUpdatedTask());
    taskUpdateMock.mockResolvedValue(createUpdatedTask());
    serializableTransactionMock.mockImplementation(async (callback) =>
      callback({
        taskScheduleQuarantine: { findUnique: quarantineFindUniqueMock },
        task: {
          update: taskUpdateMock,
          findUniqueOrThrow: taskFindUniqueOrThrowMock,
        },
        taskEvent: {
          create: taskEventCreateMock,
          findUnique: taskEventFindUniqueMock,
        },
      }),
    );
  });

  it("removes a series for a collaborator outside the Calendar beta", async () => {
    // Removal is the escape hatch for schedules the un-gated legacy route can
    // still create, so beta membership must not gate it.
    memberFindFirstMock.mockResolvedValue(null);

    const response = await createApp().request(...removalRequest());

    expect(response.status).toBe(200);
    expect(taskUpdateMock).toHaveBeenCalledOnce();
  });

  it("returns 403 for coworker context even when X-Context-User-Id matches owner", async () => {
    const app = createApp({
      actor: "coworker",
      coworkerId: "cow_123",
      vendorId: "01960001-0001-7001-8001-000000000001",
      context: { userId: "user_123", organizationId: "org_123" },
    });

    const response = await app.request(...removalRequest());

    expect(response.status).toBe(403);
    expect(requireTaskCollaborationMock).not.toHaveBeenCalled();
    expect(serializableTransactionMock).not.toHaveBeenCalled();
  });

  it("requires audited operator removal for a quarantined schedule", async () => {
    quarantineFindUniqueMock.mockResolvedValue({ id: "quarantine-1" });

    const response = await createApp().request(...removalRequest());

    expect(response.status).toBe(409);
    expect(lockCalendarScopeMock).toHaveBeenCalledWith(
      expect.any(Object),
      WORKSPACE_ID,
      [null],
    );
    expect(taskUpdateMock).not.toHaveBeenCalled();
  });

  it("requires a UUID Idempotency-Key", async () => {
    const missing = await createApp().request(
      ...removalRequest({ "x-schedule-revision": "4" }),
    );
    expect(missing.status).toBe(422);

    const malformed = await createApp().request(
      ...removalRequest({
        "Idempotency-Key": "operation-1",
        "x-schedule-revision": "4",
      }),
    );
    expect(malformed.status).toBe(422);
    expect(serializableTransactionMock).not.toHaveBeenCalled();
  });

  it("requires a non-negative integer x-schedule-revision header", async () => {
    const missing = await createApp().request(
      ...removalRequest({ "Idempotency-Key": OPERATION_ID }),
    );
    expect(missing.status).toBe(422);

    for (const value of ["", "-1", "schedule-revision:4", "4.0", "x"]) {
      const response = await createApp().request(
        ...removalRequest({
          "Idempotency-Key": OPERATION_ID,
          "x-schedule-revision": value,
        }),
      );
      expect(response.status, `x-schedule-revision: ${value}`).toBe(422);
    }
    expect(serializableTransactionMock).not.toHaveBeenCalled();
  });

  it("reports the quarantine ahead of a stale schedule revision", async () => {
    quarantineFindUniqueMock.mockResolvedValue({ id: "quarantine-1" });
    requireTaskCollaborationMock.mockResolvedValue({
      id: TASK_ID,
      status: TaskStatus.READY,
      workspaceId: WORKSPACE_ID,
      projectId: null,
      scheduleRevision: 7,
    });

    const response = await createApp().request(...removalRequest());

    expect(response.status).toBe(409);
    // Reloading cannot resolve a quarantine, so the revision conflict must not
    // mask it.
    expect(await response.json()).toMatchObject({
      kind: "schedule_quarantined",
    });
    expect(taskUpdateMock).not.toHaveBeenCalled();
  });

  it("rejects a removal that observed an older schedule revision", async () => {
    requireTaskCollaborationMock.mockResolvedValue({
      id: TASK_ID,
      status: TaskStatus.READY,
      workspaceId: WORKSPACE_ID,
      projectId: null,
      scheduleRevision: 7,
    });

    const response = await createApp().request(...removalRequest());

    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({
      kind: "schedule_revision_conflict",
    });
    expect(taskUpdateMock).not.toHaveBeenCalled();
  });

  it("clears the series, restores the Draft template, and advances the revision once", async () => {
    const response = await createApp().request(...removalRequest());

    expect(response.status).toBe(200);
    expect(taskUpdateMock).toHaveBeenCalledOnce();
    expect(taskUpdateMock.mock.calls[0][0].data).toMatchObject({
      metadata: null,
      nextRunAt: null,
      status: TaskStatus.DRAFT,
      scheduleRevision: { increment: 1 },
    });
  });

  it("restores a queued series template to Draft as well", async () => {
    requireTaskCollaborationMock.mockResolvedValue({
      id: TASK_ID,
      status: TaskStatus.QUEUED,
      workspaceId: WORKSPACE_ID,
      projectId: null,
      scheduleRevision: 4,
    });

    const response = await createApp().request(...removalRequest());

    expect(response.status).toBe(200);
    expect(taskUpdateMock.mock.calls[0][0].data.status).toBe(TaskStatus.DRAFT);
  });

  it("preserves released and past occurrence history when removing the series", async () => {
    const response = await createApp().request(...removalRequest());

    expect(response.status).toBe(200);
    expect(retireTaskScheduleFutureOccurrencesMock).toHaveBeenCalledWith(
      expect.any(Object),
      TASK_ID,
      expect.any(Date),
    );
    const [retireOrder] =
      retireTaskScheduleFutureOccurrencesMock.mock.invocationCallOrder;
    expect(lockCalendarScopeMock.mock.invocationCallOrder[0]).toBeLessThan(
      retireOrder,
    );
    expect(lockTaskRowsMock.mock.invocationCallOrder[0]).toBeLessThan(
      retireOrder,
    );
  });

  it("returns the stored Task without a second write when the removal is retried", async () => {
    const app = createApp();

    const first = await app.request(...removalRequest());
    expect(first.status).toBe(200);
    const storedPayload =
      taskEventCreateMock.mock.calls[0][0].data.schedulePayload;

    taskUpdateMock.mockClear();
    taskEventCreateMock.mockClear();
    retireTaskScheduleFutureOccurrencesMock.mockClear();
    taskEventFindUniqueMock.mockResolvedValue({
      schedulePayload: storedPayload,
    });
    requireTaskCollaborationMock.mockResolvedValue({
      id: TASK_ID,
      status: TaskStatus.DRAFT,
      workspaceId: WORKSPACE_ID,
      projectId: null,
      scheduleRevision: 5,
    });

    const retry = await app.request(...removalRequest());

    expect(retry.status).toBe(200);
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

  it("rejects an idempotency key already used for a different series operation", async () => {
    taskEventFindUniqueMock.mockResolvedValue({
      schedulePayload: {
        action: "update_schedule",
        requestFingerprint: "0".repeat(64),
      },
    });

    const response = await createApp().request(...removalRequest());

    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({
      kind: "idempotency_conflict",
    });
    expect(taskUpdateMock).not.toHaveBeenCalled();
  });

  it("records the removal operation with its request fingerprint", async () => {
    const response = await createApp().request(...removalRequest());

    expect(response.status).toBe(200);
    expect(taskEventCreateMock).toHaveBeenCalledOnce();
    const event = taskEventCreateMock.mock.calls[0][0].data;
    expect(event).toMatchObject({
      taskId: TASK_ID,
      scheduleKind: "REMOVED",
      scheduleOperationId: OPERATION_ID,
      userId: "user_123",
    });
    expect(event.schedulePayload).toMatchObject({
      action: "remove_schedule",
      requestFingerprint: expect.stringMatching(/^[0-9a-f]{64}$/),
      workspaceId: WORKSPACE_ID,
    });
    expect(event.schedulePayload).not.toHaveProperty("data");
  });
});
