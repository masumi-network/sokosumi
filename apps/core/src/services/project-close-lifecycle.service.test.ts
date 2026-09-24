import { ProjectCloseOperationState } from "@sokosumi/database";
import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  lockCalendarScopeMock,
  prismaMock,
  projectCloseOperationCreateMock,
  projectCloseOperationFindUniqueMock,
  projectCloseOperationUpdateMock,
  projectEventCreateMock,
  projectEventFindUniqueMock,
  projectFindFirstMock,
  projectUpdateMock,
  serializableTransactionMock,
  taskScheduleOccurrenceCountMock,
  taskScheduleOccurrenceDeleteManyMock,
  taskScheduleOccurrenceUpdateManyMock,
  taskScheduleQuarantineDeleteManyMock,
  taskFindFirstMock,
  taskUpdateManyMock,
} = vi.hoisted(() => ({
  lockCalendarScopeMock: vi.fn(),
  prismaMock: {
    project: { findFirst: vi.fn() },
    taskScheduleOccurrence: { count: vi.fn() },
  },
  projectCloseOperationCreateMock: vi.fn(),
  projectCloseOperationFindUniqueMock: vi.fn(),
  projectCloseOperationUpdateMock: vi.fn(),
  projectEventCreateMock: vi.fn(),
  projectEventFindUniqueMock: vi.fn(),
  projectFindFirstMock: vi.fn(),
  projectUpdateMock: vi.fn(),
  serializableTransactionMock: vi.fn(),
  taskScheduleOccurrenceCountMock: vi.fn(),
  taskScheduleOccurrenceDeleteManyMock: vi.fn(),
  taskScheduleOccurrenceUpdateManyMock: vi.fn(),
  taskScheduleQuarantineDeleteManyMock: vi.fn(),
  taskFindFirstMock: vi.fn(),
  taskUpdateManyMock: vi.fn(),
}));

const retireSocialConnectionsMock = vi.hoisted(() => vi.fn());
vi.mock("@/services/project-social-connections.service", () => ({
  retireProjectSocialConnectionsForClose: retireSocialConnectionsMock,
}));

vi.mock("@/helpers/calendar-locks", () => ({
  lockCalendarScope: lockCalendarScopeMock,
}));
vi.mock("@/lib/db/prisma", () => ({ default: prismaMock }));
vi.mock("@/lib/db/transaction", () => ({
  serializableTransaction: serializableTransactionMock,
}));

import {
  cancelProjectCloseOwedWork,
  requestProjectClose,
  retryProjectClose,
} from "@/services/project-close-lifecycle.service";

const WORKSPACE_ID = "11111111-1111-7111-8111-111111111111";
const PROJECT_ID = "22222222-2222-7222-8222-222222222222";
const CLOSE_ID = "33333333-3333-7333-8333-333333333333";
const RECOVERY_ID = "44444444-4444-7444-8444-444444444444";
const CUTOFF = new Date("2026-09-14T10:00:00.000Z");

const operation = {
  id: CLOSE_ID,
  projectId: PROJECT_ID,
  state: ProjectCloseOperationState.CLOSE_FAILED,
  cutoffAt: CUTOFF,
  actorUserId: "user_123",
  reason: "Campaign completed",
  seriesCursor: null,
  attempts: 3,
  leaseToken: null,
  leasedAt: null,
  nextAttemptAt: null,
  failureSummary: {
    seriesTaskId: "task_123",
    message: "Scheduled work could not be closed",
  },
  completedAt: null,
  createdAt: CUTOFF,
  updatedAt: CUTOFF,
};

const scope = {
  projectId: PROJECT_ID,
  workspaceId: WORKSPACE_ID,
  actorUserId: "user_123",
};

function transactionClient() {
  return {
    project: {
      findFirst: projectFindFirstMock,
      update: projectUpdateMock,
    },
    projectCloseOperation: {
      create: projectCloseOperationCreateMock,
      findUnique: projectCloseOperationFindUniqueMock,
      update: projectCloseOperationUpdateMock,
    },
    projectEvent: {
      create: projectEventCreateMock,
      findUnique: projectEventFindUniqueMock,
    },
    task: {
      findFirst: taskFindFirstMock,
      updateMany: taskUpdateManyMock,
    },
    taskScheduleOccurrence: {
      count: taskScheduleOccurrenceCountMock,
      deleteMany: taskScheduleOccurrenceDeleteManyMock,
      updateMany: taskScheduleOccurrenceUpdateManyMock,
    },
    taskScheduleQuarantine: {
      deleteMany: taskScheduleQuarantineDeleteManyMock,
    },
  };
}

describe("project close lifecycle", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    lockCalendarScopeMock.mockResolvedValue(true);
    taskScheduleOccurrenceCountMock.mockResolvedValue(0);
    projectCloseOperationFindUniqueMock.mockResolvedValue(null);
    taskFindFirstMock.mockResolvedValue({ status: "QUEUED" });
    prismaMock.taskScheduleOccurrence.count = taskScheduleOccurrenceCountMock;
    prismaMock.project.findFirst = projectFindFirstMock;
    serializableTransactionMock.mockImplementation(async (callback) =>
      callback(transactionClient()),
    );
  });

  it("freezes one cutoff and creates an idempotent close operation", async () => {
    projectFindFirstMock.mockResolvedValue({
      id: PROJECT_ID,
      projectRevision: 4,
      closingAt: null,
      closedAt: null,
      closeOperation: null,
    });
    projectUpdateMock.mockResolvedValue({ projectRevision: 5 });
    projectCloseOperationCreateMock.mockImplementation(async ({ data }) => ({
      ...operation,
      ...data,
      state: ProjectCloseOperationState.CLOSING,
      attempts: 0,
      failureSummary: null,
    }));

    const status = await requestProjectClose(scope, {
      operationId: CLOSE_ID,
      expectedProjectRevision: 4,
      reason: " Campaign completed ",
    });

    expect(retireSocialConnectionsMock).toHaveBeenCalledWith(
      expect.anything(),
      PROJECT_ID,
      scope.actorUserId,
    );
    expect(
      retireSocialConnectionsMock.mock.invocationCallOrder[0],
    ).toBeLessThan(projectCloseOperationCreateMock.mock.invocationCallOrder[0]);
    const created = projectCloseOperationCreateMock.mock.calls[0][0].data;
    expect(projectUpdateMock).toHaveBeenCalledWith({
      where: { id: PROJECT_ID },
      data: {
        closingAt: created.cutoffAt,
        projectRevision: { increment: 1 },
      },
      select: { projectRevision: true },
    });
    expect(status).toMatchObject({
      id: CLOSE_ID,
      state: "CLOSING",
      cutoffAt: created.cutoffAt.toISOString(),
      projectRevision: 5,
    });
  });

  it("replays the original close before checking a stale revision", async () => {
    projectFindFirstMock.mockResolvedValue({
      id: PROJECT_ID,
      projectRevision: 8,
      closingAt: CUTOFF,
      closedAt: null,
      closeOperation: operation,
    });

    const status = await requestProjectClose(scope, {
      operationId: CLOSE_ID,
      expectedProjectRevision: 0,
      reason: "Campaign completed",
    });

    expect(status.projectRevision).toBe(8);
    expect(projectUpdateMock).not.toHaveBeenCalled();
    expect(projectCloseOperationCreateMock).not.toHaveBeenCalled();
  });

  it("rejects reuse of the close key with a changed reason", async () => {
    projectFindFirstMock.mockResolvedValue({
      id: PROJECT_ID,
      projectRevision: 8,
      closingAt: CUTOFF,
      closedAt: null,
      closeOperation: operation,
    });

    await expect(
      requestProjectClose(scope, {
        operationId: CLOSE_ID,
        expectedProjectRevision: 8,
        reason: "Different reason",
      }),
    ).rejects.toMatchObject({ status: 409 });
  });

  it("rejects a close key already used by another Project", async () => {
    projectFindFirstMock.mockResolvedValue({
      id: PROJECT_ID,
      projectRevision: 4,
      closingAt: null,
      closedAt: null,
      closeOperation: null,
    });
    projectCloseOperationFindUniqueMock.mockResolvedValue({ id: CLOSE_ID });

    await expect(
      requestProjectClose(scope, {
        operationId: CLOSE_ID,
        expectedProjectRevision: 4,
        reason: "Campaign completed",
      }),
    ).rejects.toMatchObject({ status: 409 });
    expect(projectUpdateMock).not.toHaveBeenCalled();
    expect(projectCloseOperationCreateMock).not.toHaveBeenCalled();
  });

  it("requeues a failed close with a separate retry key and reason", async () => {
    projectFindFirstMock.mockResolvedValue({
      id: PROJECT_ID,
      projectRevision: 5,
      closingAt: CUTOFF,
      closedAt: null,
      closeOperation: operation,
    });
    projectEventFindUniqueMock.mockResolvedValue(null);
    projectUpdateMock.mockResolvedValue({ projectRevision: 6 });
    projectCloseOperationUpdateMock.mockResolvedValue({
      ...operation,
      state: ProjectCloseOperationState.CLOSING,
      attempts: 0,
      failureSummary: null,
    });

    const status = await retryProjectClose(scope, {
      operationId: RECOVERY_ID,
      expectedProjectRevision: 5,
      reason: "Dependency recovered",
    });

    expect(status.state).toBe("CLOSING");
    expect(projectEventCreateMock).toHaveBeenCalledWith({
      data: expect.objectContaining({
        eventKey: `project-close:recovery:${RECOVERY_ID}`,
        kind: "RETRY_REQUESTED",
        reason: "Dependency recovered",
      }),
    });
  });

  it("cancels only the failed series' owed/future work and resumes", async () => {
    projectFindFirstMock.mockResolvedValue({
      id: PROJECT_ID,
      projectRevision: 5,
      closingAt: CUTOFF,
      closedAt: null,
      closeOperation: operation,
    });
    projectEventFindUniqueMock.mockResolvedValue(null);
    projectUpdateMock.mockResolvedValue({ projectRevision: 6 });
    projectCloseOperationUpdateMock.mockResolvedValue({
      ...operation,
      state: ProjectCloseOperationState.CLOSING,
      seriesCursor: "task_123",
      attempts: 0,
      failureSummary: null,
    });

    await cancelProjectCloseOwedWork(scope, {
      operationId: RECOVERY_ID,
      expectedProjectRevision: 5,
      reason: "Do not run the failed occurrence",
    });

    expect(taskScheduleOccurrenceUpdateManyMock).toHaveBeenCalledWith({
      where: {
        seriesTaskId: "task_123",
        sourceProjectId: PROJECT_ID,
        scheduleVersion: 2,
        OR: [
          { state: "PLANNED", effectiveScheduledAt: { lt: CUTOFF } },
          {
            state: { in: ["PLANNED", "SKIPPED"] },
            effectiveScheduledAt: { gte: CUTOFF },
          },
        ],
      },
      data: { state: "CANCELED" },
    });
    expect(taskScheduleQuarantineDeleteManyMock).toHaveBeenCalledWith({
      where: { taskId: "task_123" },
    });
    expect(taskUpdateManyMock).toHaveBeenCalledWith({
      where: expect.objectContaining({ id: "task_123", projectId: PROJECT_ID }),
      data: expect.objectContaining({ status: "DRAFT", metadata: null }),
    });
  });

  it("rejects reusing a retry key for canceling owed work", async () => {
    projectFindFirstMock.mockResolvedValue({
      id: PROJECT_ID,
      projectRevision: 5,
      closingAt: CUTOFF,
      closedAt: null,
      closeOperation: operation,
    });
    projectEventFindUniqueMock.mockResolvedValue({
      closeOperationId: CLOSE_ID,
      reason: "Dependency recovered",
      payload: { action: "retry", recoveryOperationId: RECOVERY_ID },
    });

    await expect(
      cancelProjectCloseOwedWork(scope, {
        operationId: RECOVERY_ID,
        expectedProjectRevision: 5,
        reason: "Dependency recovered",
      }),
    ).rejects.toMatchObject({ status: 409 });
    expect(taskScheduleOccurrenceUpdateManyMock).not.toHaveBeenCalled();
  });

  it("preserves a terminal Task status while canceling its malformed schedule", async () => {
    projectFindFirstMock.mockResolvedValue({
      id: PROJECT_ID,
      projectRevision: 5,
      closingAt: CUTOFF,
      closedAt: null,
      closeOperation: operation,
    });
    projectEventFindUniqueMock.mockResolvedValue(null);
    projectUpdateMock.mockResolvedValue({ projectRevision: 6 });
    projectCloseOperationUpdateMock.mockResolvedValue({
      ...operation,
      state: ProjectCloseOperationState.CLOSING,
      attempts: 0,
      failureSummary: null,
    });
    taskFindFirstMock.mockResolvedValue({ status: "COMPLETED" });

    await cancelProjectCloseOwedWork(scope, {
      operationId: RECOVERY_ID,
      expectedProjectRevision: 5,
      reason: "Discard the malformed schedule only",
    });

    expect(taskUpdateManyMock).toHaveBeenCalledWith({
      where: { id: "task_123", projectId: PROJECT_ID },
      data: {
        metadata: null,
        nextRunAt: null,
        scheduleRevision: { increment: 1 },
      },
    });
  });
});
