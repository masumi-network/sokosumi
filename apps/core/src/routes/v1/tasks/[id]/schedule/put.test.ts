import { TaskScheduleOccurrenceState, TaskStatus } from "@sokosumi/database";
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
  createTaskSchedulePlannedOccurrencesMock,
  prismaTransactionMock,
  memberFindFirstMock,
  taskUpdateMock,
  requireTaskScheduleWriteAccessMock,
  hasAssignedOrganizationSeatMock,
  lockCalendarScopeMock,
  lockTaskRowsMock,
  quarantineFindUniqueMock,
  replaceTaskSchedulePlannedOccurrencesMock,
  retireTaskScheduleFutureOccurrencesMock,
} = vi.hoisted(() => ({
  createTaskSchedulePlannedOccurrencesMock: vi.fn(),
  prismaTransactionMock: vi.fn(),
  memberFindFirstMock: vi.fn(),
  taskUpdateMock: vi.fn(),
  requireTaskScheduleWriteAccessMock: vi.fn(),
  hasAssignedOrganizationSeatMock: vi.fn(),
  lockCalendarScopeMock: vi.fn(),
  lockTaskRowsMock: vi.fn(),
  quarantineFindUniqueMock: vi.fn(),
  replaceTaskSchedulePlannedOccurrencesMock: vi.fn(),
  retireTaskScheduleFutureOccurrencesMock: vi.fn(),
}));

vi.mock("@/helpers/access-control", () => ({
  requireTaskScheduleWriteAccess: requireTaskScheduleWriteAccessMock,
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
  requireOpenCalendarProject: vi.fn(),
}));

vi.mock("@/helpers/task-schedule-occurrence-index", async (importOriginal) => {
  const actual =
    await importOriginal<
      typeof import("@/helpers/task-schedule-occurrence-index")
    >();
  return {
    ...actual,
    createTaskSchedulePlannedOccurrences:
      createTaskSchedulePlannedOccurrencesMock,
    replaceTaskSchedulePlannedOccurrences:
      replaceTaskSchedulePlannedOccurrencesMock,
    retireTaskScheduleFutureOccurrences:
      retireTaskScheduleFutureOccurrencesMock,
  };
});

vi.mock("@/lib/db/prisma", () => ({
  default: {
    $transaction: prismaTransactionMock,
    member: { findFirst: memberFindFirstMock },
    task: {
      update: taskUpdateMock,
    },
  },
}));

const WORKSPACE_ID = "11111111-1111-7111-8111-111111111111";
const TASK_ID = "tsk_123";
const V2_EPOCH_ID = "123e4567-e89b-42d3-a456-426614174001";
const MOVED_OCCURRENCE_ID = "00000000-0000-7000-8000-000000000042";
const RULE_NOW = new Date("2026-06-01T08:00:00.000Z");

interface LedgerOccurrence {
  id: string;
  seriesTaskId: string;
  epochId: string | null;
  originalScheduledAt: Date | null;
  effectiveScheduledAt: Date;
  state: string;
  scheduleVersion: number;
  sourceWorkspaceId?: string;
  sourceType?: string;
  sourceProjectId?: string | null;
  sourceAccuracy?: string;
  timeAccuracy?: string;
}

function createOccurrenceLedger(initial: LedgerOccurrence[]) {
  const rows = [...initial];
  let nextId = 1;

  function matches(
    row: LedgerOccurrence,
    where: Record<string, unknown> = {},
  ): boolean {
    if (where.seriesTaskId != null && row.seriesTaskId !== where.seriesTaskId) {
      return false;
    }
    if ("epochId" in where && row.epochId !== where.epochId) {
      return false;
    }
    if (typeof where.state === "string" && row.state !== where.state) {
      return false;
    }
    if (
      where.state &&
      typeof where.state === "object" &&
      where.state !== null &&
      "in" in where.state &&
      Array.isArray((where.state as { in: string[] }).in) &&
      !(where.state as { in: string[] }).in.includes(row.state)
    ) {
      return false;
    }
    const effective = where.effectiveScheduledAt as
      | { gte?: Date; lte?: Date }
      | undefined;
    if (effective?.gte && row.effectiveScheduledAt < effective.gte) {
      return false;
    }
    if (effective?.lte && row.effectiveScheduledAt > effective.lte) {
      return false;
    }
    const idWhere = where.id as { in?: string[] } | undefined;
    if (idWhere?.in && !idWhere.in.includes(row.id)) {
      return false;
    }
    return true;
  }

  const client = {
    findMany: vi.fn(
      async ({ where }: { where?: Record<string, unknown> } = {}) =>
        rows.filter((row) => matches(row, where)),
    ),
    updateMany: vi.fn(
      async ({
        where,
        data,
      }: {
        where?: Record<string, unknown>;
        data: Partial<LedgerOccurrence>;
      }) => {
        let count = 0;
        for (const row of rows) {
          if (matches(row, where)) {
            Object.assign(row, data);
            count += 1;
          }
        }
        return { count };
      },
    ),
    deleteMany: vi.fn(
      async ({ where }: { where?: Record<string, unknown> } = {}) => {
        const remaining = rows.filter((row) => !matches(row, where));
        const count = rows.length - remaining.length;
        rows.splice(0, rows.length, ...remaining);
        return { count };
      },
    ),
    createMany: vi.fn(
      async ({
        data,
        skipDuplicates,
      }: {
        data: Array<Omit<LedgerOccurrence, "id"> & { id?: string }>;
        skipDuplicates?: boolean;
      }) => {
        let count = 0;
        for (const item of data) {
          const duplicate = rows.some(
            (row) =>
              row.seriesTaskId === item.seriesTaskId &&
              row.epochId === (item.epochId ?? null) &&
              row.originalScheduledAt?.getTime() ===
                item.originalScheduledAt?.getTime(),
          );
          if (duplicate && skipDuplicates) {
            continue;
          }
          rows.push({
            ...item,
            id: item.id ?? `occ_new_${nextId++}`,
            epochId: item.epochId ?? null,
            originalScheduledAt: item.originalScheduledAt ?? null,
          });
          count += 1;
        }
        return { count };
      },
    ),
  };

  return { rows, client };
}

function createMovedV2Occurrence(epochId = V2_EPOCH_ID): LedgerOccurrence {
  return {
    id: MOVED_OCCURRENCE_ID,
    seriesTaskId: TASK_ID,
    epochId,
    originalScheduledAt: new Date("2026-06-02T09:00:00.000Z"),
    effectiveScheduledAt: new Date("2026-06-04T15:00:00.000Z"),
    state: TaskScheduleOccurrenceState.PLANNED,
    scheduleVersion: 2,
    sourceWorkspaceId: WORKSPACE_ID,
    sourceType: "WORKSPACE",
    sourceProjectId: null,
    sourceAccuracy: "EXACT",
    timeAccuracy: "EXACT",
  };
}

function createV2RecurringMetadata(epochId = V2_EPOCH_ID) {
  return {
    version: 2 as const,
    epochId,
    mode: "recurring" as const,
    createdAt: "2026-06-01T08:00:00.000Z",
    ruleEffectiveFrom: "2026-06-01T08:00:00.000Z",
    timezone: "UTC",
    expr: "0 9 * * *",
    endsMode: "after" as const,
    targetReleaseCount: 10,
    epochReleaseCount: 5,
    anchorAt: "2026-06-01T08:00:00.000Z",
  };
}

async function useRealOccurrenceIndex() {
  const actual = await vi.importActual<
    typeof import("@/helpers/task-schedule-occurrence-index")
  >("@/helpers/task-schedule-occurrence-index");
  createTaskSchedulePlannedOccurrencesMock.mockImplementation(
    actual.createTaskSchedulePlannedOccurrences,
  );
  replaceTaskSchedulePlannedOccurrencesMock.mockImplementation(
    actual.replaceTaskSchedulePlannedOccurrences,
  );
  retireTaskScheduleFutureOccurrencesMock.mockImplementation(
    actual.retireTaskScheduleFutureOccurrences,
  );
  return actual;
}

function installLedgerTransaction(
  ledger: ReturnType<typeof createOccurrenceLedger>,
) {
  prismaTransactionMock.mockImplementation(async (callback) =>
    callback({
      task: { update: taskUpdateMock },
      taskScheduleQuarantine: { findUnique: quarantineFindUniqueMock },
      taskScheduleOccurrence: ledger.client,
    }),
  );
}

function mockQueuedV2Task(nextRunAt: Date, epochId = V2_EPOCH_ID) {
  requireTaskScheduleWriteAccessMock.mockResolvedValue({
    id: TASK_ID,
    status: TaskStatus.QUEUED,
    assigneeId: "coworker-1",
    workspaceId: WORKSPACE_ID,
    organizationId: null,
    projectId: null,
    nextRunAt,
    metadata: JSON.stringify(createV2RecurringMetadata(epochId)),
  });
}

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
    memberFindFirstMock.mockResolvedValue({ id: "member_123" });
    hasAssignedOrganizationSeatMock.mockResolvedValue(true);
    requireTaskScheduleWriteAccessMock.mockResolvedValue({
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

  it("allows task scheduling outside the Calendar beta", async () => {
    memberFindFirstMock.mockResolvedValue(null);

    const response = await createApp().request(
      `http://localhost/${TASK_ID}/schedule`,
      {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          mode: "once",
          runAt: "2099-01-01T09:00:00.000Z",
        }),
      },
    );

    expect(response.status).toBe(200);
    expect(requireTaskScheduleWriteAccessMock).toHaveBeenCalled();
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

  it("schedules for a collaborating coworker acting with user context", async () => {
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

    expect(response.status).toBe(200);
    expect(requireTaskScheduleWriteAccessMock).toHaveBeenCalled();
    expect(hasAssignedOrganizationSeatMock).toHaveBeenCalledWith(
      "user_123",
      "org_123",
      expect.anything(),
    );
    expect(taskUpdateMock).toHaveBeenCalled();
  });

  it("schedules for a standalone coworker key without user-scoped gates", async () => {
    const app = createApp({
      actor: "coworker",
      coworkerId: "cow_123",
      vendorId: "01960001-0001-7001-8001-000000000001",
    });

    const response = await app.request(`http://localhost/${TASK_ID}/schedule`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        mode: "once",
        runAt: "2099-01-01T09:00:00.000Z",
      }),
    });

    expect(response.status).toBe(200);
    expect(requireTaskScheduleWriteAccessMock).toHaveBeenCalled();
    expect(hasAssignedOrganizationSeatMock).not.toHaveBeenCalled();
    expect(taskUpdateMock).toHaveBeenCalled();
  });

  it("persists the legacy request as metadata version 1", async () => {
    requireTaskScheduleWriteAccessMock.mockResolvedValue({
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
        body: JSON.stringify({
          mode: "once",
          runAt: "2099-09-24T09:00:00.000Z",
        }),
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

  it("keeps an existing Calendar v2 epoch instead of rewriting version 1", async () => {
    const epochId = "123e4567-e89b-42d3-a456-426614174000";
    const nextRunAt = new Date("2026-06-02T09:00:00.000Z");
    requireTaskScheduleWriteAccessMock.mockResolvedValue({
      id: TASK_ID,
      status: TaskStatus.QUEUED,
      assigneeId: "coworker-1",
      workspaceId: WORKSPACE_ID,
      organizationId: null,
      projectId: null,
      nextRunAt,
      metadata: JSON.stringify(createV2RecurringMetadata(epochId)),
    });

    const response = await createApp().request(
      `http://localhost/${TASK_ID}/schedule`,
      {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          mode: "recurring",
          timezone: "UTC",
          expr: "0 9 * * *",
          endsMode: "after",
          occurrences: 5,
        }),
      },
    );

    expect(response.status).toBe(200);
    const saved = JSON.parse(taskUpdateMock.mock.calls[0]?.[0].data.metadata);
    expect(saved).toMatchObject({
      version: 2,
      epochId,
      endsMode: "after",
      targetReleaseCount: 10,
      epochReleaseCount: 5,
    });
    expect(taskUpdateMock.mock.calls[0]?.[0].data.nextRunAt).toEqual(nextRunAt);
    expect(replaceTaskSchedulePlannedOccurrencesMock).toHaveBeenCalledOnce();
    expect(retireTaskScheduleFutureOccurrencesMock).not.toHaveBeenCalled();
    expect(createTaskSchedulePlannedOccurrencesMock).not.toHaveBeenCalled();
  });

  it("starts a new v2 epoch when a Calendar schedule rule changes", async () => {
    const epochId = V2_EPOCH_ID;
    requireTaskScheduleWriteAccessMock.mockResolvedValue({
      id: TASK_ID,
      status: TaskStatus.QUEUED,
      assigneeId: "coworker-1",
      workspaceId: WORKSPACE_ID,
      organizationId: null,
      projectId: null,
      nextRunAt: new Date("2026-06-02T09:00:00.000Z"),
      metadata: JSON.stringify(createV2RecurringMetadata(epochId)),
    });

    const response = await createApp().request(
      `http://localhost/${TASK_ID}/schedule`,
      {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          mode: "recurring",
          timezone: "UTC",
          expr: "0 10 * * *",
          endsMode: "after",
          occurrences: 5,
        }),
      },
    );

    expect(response.status).toBe(200);
    const saved = JSON.parse(taskUpdateMock.mock.calls[0]?.[0].data.metadata);
    expect(saved).toMatchObject({
      version: 2,
      mode: "recurring",
      expr: "0 10 * * *",
      epochReleaseCount: 0,
      targetReleaseCount: 5,
    });
    expect(saved.epochId).not.toBe(epochId);
    expect(retireTaskScheduleFutureOccurrencesMock).toHaveBeenCalledWith(
      expect.any(Object),
      TASK_ID,
      expect.any(Date),
    );
    expect(createTaskSchedulePlannedOccurrencesMock).toHaveBeenCalledWith(
      expect.any(Object),
      expect.objectContaining({
        schedule: expect.objectContaining({
          version: 2,
          mode: "recurring",
          expr: "0 10 * * *",
          epochId: saved.epochId,
        }),
      }),
      expect.any(Date),
    );
    expect(
      retireTaskScheduleFutureOccurrencesMock.mock.invocationCallOrder[0],
    ).toBeLessThan(
      createTaskSchedulePlannedOccurrencesMock.mock.invocationCallOrder[0],
    );
    expect(replaceTaskSchedulePlannedOccurrencesMock).not.toHaveBeenCalled();
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

  it("increments the schedule revision under the Calendar and Task locks", async () => {
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
    expect(lockCalendarScopeMock).toHaveBeenCalled();
    expect(lockTaskRowsMock).toHaveBeenCalledWith(expect.any(Object), [
      TASK_ID,
    ]);
    expect(taskUpdateMock).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          scheduleRevision: { increment: 1 },
        }),
      }),
    );
  });

  it("keeps accepting the legacy bare schedule body", async () => {
    const response = await createApp().request(
      `http://localhost/${TASK_ID}/schedule`,
      {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          mode: "recurring",
          expr: "0 9 * * *",
          timezone: "UTC",
        }),
      },
    );

    expect(response.status).toBe(200);
    const update = taskUpdateMock.mock.calls[0]?.[0];
    expect(JSON.parse(update.data.metadata)).toMatchObject({
      version: 1,
      mode: "recurring",
      expr: "0 9 * * *",
    });
    expect(update.data.scheduleRevision).toEqual({ increment: 1 });
  });

  it("rejects the Calendar series envelope instead of ignoring its preconditions", async () => {
    const response = await createApp().request(
      `http://localhost/${TASK_ID}/schedule`,
      {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          operationId: "123e4567-e89b-42d3-a456-426614174000",
          expectedScheduleRevision: 4,
          discardFutureExceptions: true,
          schedule: {
            mode: "recurring",
            expr: "0 9 * * *",
            timezone: "UTC",
          },
        }),
      },
    );

    expect(response.status).toBe(422);
    expect(taskUpdateMock).not.toHaveBeenCalled();
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

  it("keeps human-assigned tasks READY when scheduled", async () => {
    requireTaskScheduleWriteAccessMock.mockResolvedValue({
      id: TASK_ID,
      status: TaskStatus.READY,
      assigneeId: null,
      assigneeSokoBotId: null,
      assigneeUserId: "user_123",
      ownerId: "user_123",
      workspaceId: WORKSPACE_ID,
      organizationId: "org_123",
      projectId: null,
    });

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
    expect(taskUpdateMock).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          nextRunAt: expect.any(Date),
        }),
      }),
    );
    expect(taskUpdateMock.mock.calls[0]?.[0].data.status).toBeUndefined();
  });

  it("sets agent-assigned tasks to QUEUED when scheduled (SOK-1033)", async () => {
    requireTaskScheduleWriteAccessMock.mockResolvedValue({
      id: TASK_ID,
      status: TaskStatus.READY,
      assigneeId: "coworker-1",
      assigneeSokoBotId: null,
      assigneeUserId: null,
      ownerId: "user_123",
      workspaceId: WORKSPACE_ID,
      organizationId: "org_123",
      projectId: null,
    });

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
    expect(taskUpdateMock.mock.calls[0]?.[0].data.status).toBe(
      TaskStatus.QUEUED,
    );
  });

  it("rejects scheduling an unset task (SOK-868)", async () => {
    requireTaskScheduleWriteAccessMock.mockResolvedValue({
      id: TASK_ID,
      status: TaskStatus.READY,
      assigneeId: null,
      assigneeSokoBotId: null,
      assigneeUserId: null,
      ownerId: "user_123",
      workspaceId: WORKSPACE_ID,
      organizationId: "org_123",
      projectId: null,
    });

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

    expect(response.status).toBe(422);
    expect(taskUpdateMock).not.toHaveBeenCalled();
  });

  it("retires a moved PLANNED row when the legacy PUT changes the v2 rule", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(RULE_NOW);
    try {
      await useRealOccurrenceIndex();
      const ledger = createOccurrenceLedger([createMovedV2Occurrence()]);
      installLedgerTransaction(ledger);
      mockQueuedV2Task(new Date("2026-06-04T15:00:00.000Z"));

      const response = await createApp().request(
        `http://localhost/${TASK_ID}/schedule`,
        {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            mode: "recurring",
            timezone: "UTC",
            expr: "0 10 * * *",
            endsMode: "after",
            occurrences: 5,
          }),
        },
      );

      expect(response.status).toBe(200);
      const saved = JSON.parse(taskUpdateMock.mock.calls[0]?.[0].data.metadata);
      const nextRunAt = taskUpdateMock.mock.calls[0]?.[0].data.nextRunAt;
      expect(saved.epochId).not.toBe(V2_EPOCH_ID);
      expect(nextRunAt).toEqual(new Date("2026-06-01T10:00:00.000Z"));
      expect(
        ledger.rows.find((row) => row.id === MOVED_OCCURRENCE_ID)?.state,
      ).toBe(TaskScheduleOccurrenceState.CANCELED);
      expect(
        ledger.rows.filter(
          (row) =>
            row.epochId === V2_EPOCH_ID &&
            row.state === TaskScheduleOccurrenceState.PLANNED,
        ),
      ).toEqual([]);

      const nextReleaseable = ledger.rows
        .filter(
          (row) =>
            row.epochId === saved.epochId &&
            row.state === TaskScheduleOccurrenceState.PLANNED,
        )
        .toSorted(
          (left, right) =>
            left.effectiveScheduledAt.getTime() -
              right.effectiveScheduledAt.getTime() ||
            left.id.localeCompare(right.id),
        )[0];
      expect(nextReleaseable).toMatchObject({
        epochId: saved.epochId,
        effectiveScheduledAt: nextRunAt,
      });
      expect(nextReleaseable?.id).not.toBe(MOVED_OCCURRENCE_ID);
    } finally {
      vi.useRealTimers();
    }
  });

  it("does not retire a moved PLANNED row when the legacy PUT repeats the same v2 rule", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(RULE_NOW);
    try {
      await useRealOccurrenceIndex();
      const movedNextRunAt = new Date("2026-06-04T15:00:00.000Z");
      const ledger = createOccurrenceLedger([createMovedV2Occurrence()]);
      installLedgerTransaction(ledger);
      mockQueuedV2Task(movedNextRunAt);

      const response = await createApp().request(
        `http://localhost/${TASK_ID}/schedule`,
        {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            mode: "recurring",
            timezone: "UTC",
            expr: "0 9 * * *",
            endsMode: "after",
            occurrences: 5,
          }),
        },
      );

      expect(response.status).toBe(200);
      const saved = JSON.parse(taskUpdateMock.mock.calls[0]?.[0].data.metadata);
      expect(saved.epochId).toBe(V2_EPOCH_ID);
      expect(taskUpdateMock.mock.calls[0]?.[0].data.nextRunAt).toEqual(
        movedNextRunAt,
      );
      expect(
        ledger.rows.find((row) => row.id === MOVED_OCCURRENCE_ID),
      ).toMatchObject({
        state: TaskScheduleOccurrenceState.PLANNED,
        epochId: V2_EPOCH_ID,
        effectiveScheduledAt: movedNextRunAt,
      });
      expect(retireTaskScheduleFutureOccurrencesMock).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });
});
