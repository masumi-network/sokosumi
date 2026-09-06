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
  lockCalendarScopeMock,
  lockTaskRowsMock,
  prismaMock,
  quarantineFindUniqueMock,
  releasedOccurrenceCountMock,
  replaceTaskSchedulePlannedOccurrencesMock,
  requireAssignedOrganizationSeatMock,
  requireTaskCollaborationMock,
  serializableTransactionMock,
  taskUpdateMock,
  userFindUniqueMock,
} = vi.hoisted(() => {
  const userFindUniqueMock = vi.fn();
  return {
    lockCalendarScopeMock: vi.fn(),
    lockTaskRowsMock: vi.fn(),
    prismaMock: { user: { findUnique: userFindUniqueMock } },
    quarantineFindUniqueMock: vi.fn(),
    releasedOccurrenceCountMock: vi.fn(),
    replaceTaskSchedulePlannedOccurrencesMock: vi.fn(),
    requireAssignedOrganizationSeatMock: vi.fn(),
    requireTaskCollaborationMock: vi.fn(),
    serializableTransactionMock: vi.fn(),
    taskUpdateMock: vi.fn(),
    userFindUniqueMock,
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
  replaceTaskSchedulePlannedOccurrences:
    replaceTaskSchedulePlannedOccurrencesMock,
}));
vi.mock("@/lib/db/transaction", () => ({
  serializableTransaction: serializableTransactionMock,
}));
vi.mock("@/lib/db/prisma", () => ({ default: prismaMock }));

const WORKSPACE_ID = "11111111-1111-7111-8111-111111111111";
const TASK_ID = "tsk_123";
const NEXT_RUN_AT = new Date("2099-09-24T09:00:00.000Z");

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
    releasedOccurrenceCountMock.mockResolvedValue(2);
    requireAssignedOrganizationSeatMock.mockResolvedValue(undefined);
    serializableTransactionMock.mockImplementation(async (callback) =>
      callback({
        task: { update: taskUpdateMock },
        taskScheduleOccurrence: { count: releasedOccurrenceCountMock },
        taskScheduleQuarantine: { findUnique: quarantineFindUniqueMock },
      }),
    );
    taskUpdateMock.mockImplementation(async ({ data }) =>
      createTaskResult(data.metadata, data.nextRunAt ?? NEXT_RUN_AT),
    );
    userFindUniqueMock.mockResolvedValue({
      email: "ada@nmkr.io",
      emailVerified: true,
    });
  });

  it("atomically converts a finite v1 rule before applying the Calendar edit", async () => {
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
    });

    const response = await createApp().request(
      `http://localhost/${TASK_ID}/calendar-schedule`,
      {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          mode: "recurring",
          timezone: "UTC",
          expr: "0 9 * * *",
          endsMode: "after",
          occurrences: 3,
        }),
      },
    );

    expect(response.status).toBe(200);
    expect(serializableTransactionMock).toHaveBeenCalledOnce();
    expect(lockCalendarScopeMock).toHaveBeenCalledWith(
      expect.any(Object),
      WORKSPACE_ID,
      [null],
    );
    expect(releasedOccurrenceCountMock).toHaveBeenCalledWith({
      where: {
        seriesTaskId: TASK_ID,
        state: "RELEASED",
        scheduleVersion: 1,
        ruleSnapshot: {
          path: ["scheduledAt"],
          equals: "2026-06-01T08:00:00.000Z",
        },
      },
    });
    expect(taskUpdateMock).toHaveBeenCalledTimes(2);
    const converted = JSON.parse(taskUpdateMock.mock.calls[0][0].data.metadata);
    const saved = JSON.parse(taskUpdateMock.mock.calls[1][0].data.metadata);
    expect(converted).toMatchObject({
      version: 2,
      epochId: expect.stringMatching(
        /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
      ),
      expr: "0 9 * * *",
      targetReleaseCount: 5,
      epochReleaseCount: 2,
    });
    expect(saved.epochId).toBe(converted.epochId);
    expect(saved.targetReleaseCount - saved.epochReleaseCount).toBe(3);
    expect(replaceTaskSchedulePlannedOccurrencesMock).toHaveBeenCalledWith(
      expect.any(Object),
      expect.objectContaining({
        id: TASK_ID,
        schedule: expect.objectContaining({
          version: 2,
          epochId: converted.epochId,
        }),
      }),
    );
  });

  it("keeps the epoch of an unchanged v2 rule", async () => {
    const epochId = "123e4567-e89b-42d3-a456-426614174000";
    const metadata = JSON.stringify({
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
    });

    const response = await createApp().request(
      `http://localhost/${TASK_ID}/calendar-schedule`,
      {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          mode: "recurring",
          timezone: "UTC",
          expr: "0 9 * * *",
          endsMode: "never",
        }),
      },
    );

    expect(response.status).toBe(200);
    expect(taskUpdateMock).toHaveBeenCalledOnce();
    expect(
      JSON.parse(taskUpdateMock.mock.calls[0][0].data.metadata).epochId,
    ).toBe(epochId);
    expect(releasedOccurrenceCountMock).not.toHaveBeenCalled();
  });

  it("rejects a non-NMKR user before updating a Calendar schedule", async () => {
    userFindUniqueMock.mockResolvedValue({
      email: "ada@example.com",
      emailVerified: true,
    });
    requireTaskCollaborationMock.mockResolvedValue({
      id: TASK_ID,
      status: TaskStatus.QUEUED,
      assigneeId: "coworker-1",
      assigneeSokoBotId: null,
      workspaceId: WORKSPACE_ID,
      organizationId: null,
      projectId: null,
      metadata: JSON.stringify({
        version: 2,
        epochId: "123e4567-e89b-42d3-a456-426614174004",
        mode: "recurring",
        createdAt: "2026-06-01T08:00:00.000Z",
        ruleEffectiveFrom: "2026-06-01T08:00:00.000Z",
        timezone: "UTC",
        expr: "0 9 * * *",
        endsMode: "never",
        epochReleaseCount: 0,
        anchorAt: "2026-06-01T09:00:00.000Z",
      }),
      nextRunAt: NEXT_RUN_AT,
    });

    const response = await createApp().request(
      `http://localhost/${TASK_ID}/calendar-schedule`,
      {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          mode: "recurring",
          timezone: "UTC",
          expr: "0 9 * * *",
          endsMode: "never",
        }),
      },
    );

    expect(response.status).toBe(403);
    expect(requireTaskCollaborationMock).not.toHaveBeenCalled();
  });

  it("rejects an unverified NMKR user before updating a Calendar schedule", async () => {
    userFindUniqueMock.mockResolvedValue({
      email: "ada@nmkr.io",
      emailVerified: false,
    });

    const response = await createApp().request(
      `http://localhost/${TASK_ID}/calendar-schedule`,
      {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          mode: "recurring",
          timezone: "UTC",
          expr: "0 9 * * *",
          endsMode: "never",
        }),
      },
    );

    expect(response.status).toBe(403);
    expect(requireTaskCollaborationMock).not.toHaveBeenCalled();
  });
});
