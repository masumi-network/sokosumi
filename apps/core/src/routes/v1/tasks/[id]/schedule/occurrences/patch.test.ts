import {
  CalendarSourceAccuracy,
  CalendarSourceType,
  CalendarTimeAccuracy,
  TaskScheduleOccurrenceState,
  TaskStatus,
} from "@sokosumi/database";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { errorHandler } from "@/helpers/error-handler";
import { createTaskScheduleRequestFingerprint } from "@/helpers/task-schedule-operation";
import { OpenAPIHonoWithAuth } from "@/lib/hono";
import type { AuthenticationContext } from "@/middleware/auth";

import mountPatchTaskScheduleOccurrence from "./patch";

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
  findNextReleaseableOccurrenceMock,
  occurrenceFindFirstMock,
  occurrenceFindUniqueOrThrowMock,
  occurrenceUpdateMock,
  taskEventCreateMock,
  taskEventFindUniqueMock,
  taskUpdateMock,
} = vi.hoisted(() => ({
  serializableTransactionMock: vi.fn(),
  memberFindFirstMock: vi.fn(),
  requireTaskCollaborationMock: vi.fn(),
  lockCalendarScopeMock: vi.fn(),
  lockTaskRowsMock: vi.fn(),
  findNextReleaseableOccurrenceMock: vi.fn(),
  occurrenceFindFirstMock: vi.fn(),
  occurrenceFindUniqueOrThrowMock: vi.fn(),
  occurrenceUpdateMock: vi.fn(),
  taskEventCreateMock: vi.fn(),
  taskEventFindUniqueMock: vi.fn(),
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
  CALENDAR_OCCURRENCE_HORIZON_MS: 90 * 24 * 60 * 60 * 1000,
  findNextReleaseableOccurrence: findNextReleaseableOccurrenceMock,
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
const OCCURRENCE_ID = "33333333-3333-7333-8333-333333333331";
const OPERATION_ID = "123e4567-e89b-42d3-a456-426614174777";
const SCHEDULE_REVISION = 4;
const NOW = new Date("2026-06-10T00:00:00.000Z");
const TARGET = new Date("2026-06-12T09:00:00.000Z");
const ORIGINAL = new Date("2026-06-11T09:00:00.000Z");
const EPOCH_ID = "44444444-4444-7444-8444-444444444444";

const recurringMetadata = {
  version: 2 as const,
  epochId: EPOCH_ID,
  mode: "recurring" as const,
  createdAt: "2026-06-01T08:00:00.000Z",
  ruleEffectiveFrom: "2026-06-01T08:00:00.000Z",
  timezone: "Europe/Berlin",
  expr: "0 9 * * *",
  endsMode: "never" as const,
  epochReleaseCount: 0,
  anchorAt: "2026-06-01T09:00:00.000Z",
};

const onceMetadataV2 = {
  version: 2 as const,
  epochId: EPOCH_ID,
  mode: "once" as const,
  createdAt: "2026-06-01T08:00:00.000Z",
  ruleEffectiveFrom: "2026-06-01T08:00:00.000Z",
  timezone: "UTC",
  sourceRunAt: ORIGINAL.toISOString(),
  effectiveRunAt: ORIGINAL.toISOString(),
};

const onceMetadataV1 = {
  version: 1 as const,
  mode: "once" as const,
  scheduledAt: ORIGINAL.toISOString(),
  runAt: ORIGINAL.toISOString(),
};

function createRow(overrides: Record<string, unknown> = {}) {
  return {
    id: OCCURRENCE_ID,
    state: TaskScheduleOccurrenceState.PLANNED,
    scheduleVersion: 2,
    epochId: EPOCH_ID,
    originalScheduledAt: ORIGINAL,
    effectiveScheduledAt: ORIGINAL,
    timezone: "Europe/Berlin",
    sourceWorkspaceId: WORKSPACE_ID,
    sourceType: CalendarSourceType.WORKSPACE,
    sourceProjectId: null,
    sourceAccuracy: CalendarSourceAccuracy.EXACT,
    timeAccuracy: CalendarTimeAccuracy.EXACT,
    releasedTaskId: null,
    releasedTask: null,
    ...overrides,
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
    c.set("requestId", "req_schedule_occurrence_patch_test");
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
  mountPatchTaskScheduleOccurrence(app);
  return app;
}

function request(body: Record<string, unknown>): [string, RequestInit] {
  return [
    `http://localhost/${TASK_ID}/schedule/occurrences/${OCCURRENCE_ID}`,
    {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    },
  ];
}

function body(overrides: Record<string, unknown> = {}) {
  return {
    operationId: OPERATION_ID,
    expectedScheduleRevision: SCHEDULE_REVISION,
    scheduledAt: TARGET.toISOString(),
    ...overrides,
  };
}

function installTransaction() {
  const tx = {
    taskScheduleOccurrence: {
      findFirst: occurrenceFindFirstMock,
      findUniqueOrThrow: occurrenceFindUniqueOrThrowMock,
      update: occurrenceUpdateMock,
    },
    taskEvent: {
      findUnique: taskEventFindUniqueMock,
      create: taskEventCreateMock,
    },
    task: { update: taskUpdateMock },
  };
  serializableTransactionMock.mockImplementation((callback) => callback(tx));
  return tx;
}

describe("PATCH /tasks/{id}/schedule/occurrences/{occurrenceId}", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    installTransaction();
    memberFindFirstMock.mockResolvedValue({ id: "member_1" });
    lockCalendarScopeMock.mockResolvedValue(true);
    lockTaskRowsMock.mockResolvedValue(true);
    requireTaskCollaborationMock.mockResolvedValue({
      id: TASK_ID,
      status: TaskStatus.QUEUED,
      workspaceId: WORKSPACE_ID,
      projectId: null,
      scheduleRevision: SCHEDULE_REVISION,
      metadata: JSON.stringify(recurringMetadata),
      nextRunAt: ORIGINAL,
    });
    taskEventFindUniqueMock.mockResolvedValue(null);
    occurrenceFindFirstMock.mockResolvedValue(createRow());
    occurrenceUpdateMock.mockResolvedValue(
      createRow({ effectiveScheduledAt: TARGET }),
    );
    occurrenceFindUniqueOrThrowMock.mockResolvedValue(
      createRow({ effectiveScheduledAt: TARGET }),
    );
    taskUpdateMock.mockResolvedValue({
      id: TASK_ID,
      scheduleRevision: SCHEDULE_REVISION + 1,
    });
    taskEventCreateMock.mockResolvedValue({ id: "event_1" });
    findNextReleaseableOccurrenceMock.mockResolvedValue({
      id: OCCURRENCE_ID,
      epochId: EPOCH_ID,
      originalScheduledAt: ORIGINAL,
      effectiveScheduledAt: TARGET,
    });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("moves the occurrence, advances the revision, and audits the change", async () => {
    const response = await createApp().request(...request(body()));
    expect(response.status).toBe(200);

    const json = (await response.json()) as {
      data: {
        scheduleRevision: number;
        occurrence: {
          effectiveScheduledAt: string;
          originalScheduledAt: string;
        };
      };
    };
    expect(json.data.scheduleRevision).toBe(SCHEDULE_REVISION + 1);
    expect(json.data.occurrence.effectiveScheduledAt).toBe(
      TARGET.toISOString(),
    );
    expect(json.data.occurrence.originalScheduledAt).toBe(
      "2026-06-11T09:00:00.000Z",
    );

    expect(occurrenceUpdateMock).toHaveBeenCalledWith({
      where: { id: OCCURRENCE_ID },
      data: { effectiveScheduledAt: TARGET },
      include: {
        releasedTask: {
          select: { id: true, name: true, status: true, archivedAt: true },
        },
      },
    });
    expect(taskUpdateMock).toHaveBeenCalledWith({
      where: { id: TASK_ID },
      data: {
        nextRunAt: TARGET,
        scheduleRevision: { increment: 1 },
      },
    });
    expect(taskEventCreateMock).toHaveBeenCalledWith({
      data: expect.objectContaining({
        taskId: TASK_ID,
        scheduleKind: "OCCURRENCE_RESCHEDULED",
        scheduleOperationId: OPERATION_ID,
      }),
      select: { id: true },
    });
  });

  it("moves a version 2 one-time schedule and updates its effective wake time", async () => {
    requireTaskCollaborationMock.mockResolvedValue({
      id: TASK_ID,
      status: TaskStatus.QUEUED,
      workspaceId: WORKSPACE_ID,
      projectId: null,
      scheduleRevision: SCHEDULE_REVISION,
      metadata: JSON.stringify(onceMetadataV2),
      nextRunAt: ORIGINAL,
    });
    occurrenceFindFirstMock.mockResolvedValue(
      createRow({ ruleSnapshot: onceMetadataV2 }),
    );

    const response = await createApp().request(...request(body()));

    expect(response.status).toBe(200);
    const updatedMetadata = {
      ...onceMetadataV2,
      effectiveRunAt: TARGET.toISOString(),
    };
    expect(occurrenceUpdateMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: OCCURRENCE_ID },
        data: {
          effectiveScheduledAt: TARGET,
          ruleSnapshot: updatedMetadata,
        },
      }),
    );
    expect(taskUpdateMock).toHaveBeenCalledWith({
      where: { id: TASK_ID },
      data: {
        metadata: expect.any(String),
        nextRunAt: TARGET,
        scheduleRevision: { increment: 1 },
      },
    });
    expect(
      JSON.parse(taskUpdateMock.mock.calls.at(-1)?.[0].data.metadata),
    ).toEqual(updatedMetadata);
  });

  it("upgrades a moved version 1 one-time schedule to version 2 atomically", async () => {
    requireTaskCollaborationMock.mockResolvedValue({
      id: TASK_ID,
      status: TaskStatus.QUEUED,
      workspaceId: WORKSPACE_ID,
      projectId: null,
      scheduleRevision: SCHEDULE_REVISION,
      metadata: JSON.stringify(onceMetadataV1),
      nextRunAt: ORIGINAL,
    });
    occurrenceFindFirstMock.mockResolvedValue(
      createRow({
        scheduleVersion: 1,
        epochId: null,
        timezone: null,
        ruleSnapshot: onceMetadataV1,
      }),
    );

    const response = await createApp().request(...request(body()));

    expect(response.status).toBe(200);
    const occurrenceUpdate = occurrenceUpdateMock.mock.calls.at(-1)?.[0];
    const taskUpdate = taskUpdateMock.mock.calls.at(-1)?.[0];
    const upgradedMetadata = JSON.parse(taskUpdate.data.metadata) as {
      version: number;
      epochId: string;
      mode: string;
      sourceRunAt: string;
      effectiveRunAt: string;
    };
    expect(upgradedMetadata).toMatchObject({
      version: 2,
      mode: "once",
      sourceRunAt: ORIGINAL.toISOString(),
      effectiveRunAt: TARGET.toISOString(),
    });
    expect(upgradedMetadata.epochId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
    );
    expect(occurrenceUpdate.data).toEqual({
      effectiveScheduledAt: TARGET,
      scheduleVersion: 2,
      epochId: upgradedMetadata.epochId,
      timezone: "UTC",
      ruleSnapshot: upgradedMetadata,
    });
    expect(taskUpdate).toEqual({
      where: { id: TASK_ID },
      data: {
        metadata: JSON.stringify(upgradedMetadata),
        nextRunAt: TARGET,
        scheduleRevision: { increment: 1 },
      },
    });
  });

  it("reports a stale schedule revision as a stable conflict", async () => {
    const response = await createApp().request(
      ...request(body({ expectedScheduleRevision: SCHEDULE_REVISION - 1 })),
    );
    expect(response.status).toBe(409);
    const json = (await response.json()) as { kind?: string };
    expect(json.kind).toBe("schedule_revision_conflict");
    expect(occurrenceUpdateMock).not.toHaveBeenCalled();
  });

  it("rejects an occurrence that is not a future unreleased planned row", async () => {
    occurrenceFindFirstMock.mockResolvedValue(
      createRow({ state: TaskScheduleOccurrenceState.RELEASED }),
    );

    const response = await createApp().request(...request(body()));
    expect(response.status).toBe(409);
    const json = (await response.json()) as { kind?: string };
    expect(json.kind).toBe("schedule_occurrence_not_reschedulable");
    expect(occurrenceUpdateMock).not.toHaveBeenCalled();
  });

  it("rejects a target that is not strictly future or outside the horizon", async () => {
    const past = await createApp().request(
      ...request(body({ scheduledAt: NOW.toISOString() })),
    );
    expect(past.status).toBe(422);
    expect(((await past.json()) as { kind?: string }).kind).toBe(
      "schedule_occurrence_target_invalid",
    );

    const beyond = await createApp().request(
      ...request(
        body({
          scheduledAt: new Date(
            NOW.getTime() + 91 * 24 * 60 * 60 * 1000,
          ).toISOString(),
        }),
      ),
    );
    expect(beyond.status).toBe(422);
    expect(occurrenceUpdateMock).not.toHaveBeenCalled();
  });

  it("rejects moving an occurrence from a legacy recurring schedule", async () => {
    requireTaskCollaborationMock.mockResolvedValue({
      id: TASK_ID,
      status: TaskStatus.QUEUED,
      workspaceId: WORKSPACE_ID,
      projectId: null,
      scheduleRevision: SCHEDULE_REVISION,
      metadata: JSON.stringify({
        version: 1,
        mode: "recurring",
        scheduledAt: "2026-06-01T09:00:00.000Z",
        expr: "0 9 * * *",
        timezone: "UTC",
        endsMode: "never",
      }),
      nextRunAt: ORIGINAL,
    });

    const response = await createApp().request(...request(body()));

    expect(response.status).toBe(409);
    expect(((await response.json()) as { kind?: string }).kind).toBe(
      "schedule_occurrence_not_reschedulable",
    );
    expect(occurrenceUpdateMock).not.toHaveBeenCalled();
  });

  it("replays an exact operation after its target is no longer valid", async () => {
    taskEventFindUniqueMock.mockResolvedValue({
      schedulePayload: {
        requestFingerprint: createTaskScheduleRequestFingerprint({
          action: "reschedule_occurrence",
          taskId: TASK_ID,
          occurrenceId: OCCURRENCE_ID,
          scheduledAt: NOW.toISOString(),
        }),
      },
    });

    const response = await createApp().request(
      ...request(body({ scheduledAt: NOW.toISOString() })),
    );
    expect(response.status).toBe(200);
    expect(occurrenceUpdateMock).not.toHaveBeenCalled();
    expect(taskUpdateMock).not.toHaveBeenCalled();
    expect(taskEventCreateMock).not.toHaveBeenCalled();
  });

  it("rejects reusing an operation identity for different semantics", async () => {
    taskEventFindUniqueMock.mockResolvedValue({
      schedulePayload: { requestFingerprint: "different" },
    });

    const response = await createApp().request(...request(body()));
    expect(response.status).toBe(409);
    const json = (await response.json()) as { kind?: string };
    expect(json.kind).toBe("idempotency_conflict");
    expect(occurrenceUpdateMock).not.toHaveBeenCalled();
  });

  it("returns unchanged when the target equals the current effective time", async () => {
    occurrenceFindFirstMock.mockResolvedValue(
      createRow({ effectiveScheduledAt: TARGET }),
    );

    const response = await createApp().request(...request(body()));
    expect(response.status).toBe(200);
    expect(occurrenceUpdateMock).not.toHaveBeenCalled();
    expect(taskUpdateMock).not.toHaveBeenCalled();
  });
});
