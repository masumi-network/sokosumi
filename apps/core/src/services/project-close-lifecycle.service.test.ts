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
  socialPostUpdateManyMock,
  taskScheduleRunCountMock,
  taskScheduleRunUpdateManyMock,
} = vi.hoisted(() => ({
  lockCalendarScopeMock: vi.fn(),
  prismaMock: {
    project: { findFirst: vi.fn() },
    taskScheduleRun: { count: vi.fn() },
  },
  projectCloseOperationCreateMock: vi.fn(),
  projectCloseOperationFindUniqueMock: vi.fn(),
  projectCloseOperationUpdateMock: vi.fn(),
  projectEventCreateMock: vi.fn(),
  projectEventFindUniqueMock: vi.fn(),
  projectFindFirstMock: vi.fn(),
  projectUpdateMock: vi.fn(),
  serializableTransactionMock: vi.fn(),
  socialPostUpdateManyMock: vi.fn(),
  taskScheduleRunCountMock: vi.fn(),
  taskScheduleRunUpdateManyMock: vi.fn(),
}));

const retireSocialConnectionsMock = vi.hoisted(() => vi.fn());
vi.mock("@/services/project-social-connections.service", () => ({
  retireProjectSocialConnectionsForClose: retireSocialConnectionsMock,
}));

const { archiveProjectSokoBotsMock, publishMentionStatusesMock } = vi.hoisted(
  () => ({
    archiveProjectSokoBotsMock: vi.fn(),
    publishMentionStatusesMock: vi.fn(),
  }),
);
vi.mock("@/services/project-soko-bots-close.service", () => ({
  archiveProjectSokoBotsForClose: archiveProjectSokoBotsMock,
}));
vi.mock("@/helpers/chat-room-mention-status", () => ({
  publishChatRoomMentionStatuses: publishMentionStatusesMock,
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
  getProjectCloseStatus,
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
  attempts: 3,
  leaseToken: null,
  leasedAt: null,
  nextAttemptAt: null,
  failureSummary: {
    scheduleId: "schedule_123",
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
    socialPost: {
      updateMany: socialPostUpdateManyMock,
    },
    taskScheduleRun: {
      count: taskScheduleRunCountMock,
      updateMany: taskScheduleRunUpdateManyMock,
    },
  };
}

function recoverableProject(
  closeOperation: Omit<typeof operation, "failureSummary"> & {
    failureSummary: unknown;
  } = operation,
) {
  projectFindFirstMock.mockResolvedValue({
    id: PROJECT_ID,
    projectRevision: 5,
    closingAt: CUTOFF,
    closedAt: null,
    closeOperation,
  });
  projectEventFindUniqueMock.mockResolvedValue(null);
  projectUpdateMock.mockResolvedValue({ projectRevision: 6 });
  projectCloseOperationUpdateMock.mockResolvedValue({
    ...closeOperation,
    state: ProjectCloseOperationState.CLOSING,
    attempts: 0,
    failureSummary: null,
  });
}

describe("project close lifecycle", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    lockCalendarScopeMock.mockResolvedValue(true);
    archiveProjectSokoBotsMock.mockResolvedValue([]);
    publishMentionStatusesMock.mockResolvedValue(undefined);
    taskScheduleRunCountMock.mockResolvedValue(0);
    projectCloseOperationFindUniqueMock.mockResolvedValue(null);
    prismaMock.taskScheduleRun.count = taskScheduleRunCountMock;
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

    const created = projectCloseOperationCreateMock.mock.calls[0][0].data;
    expect(socialPostUpdateManyMock).toHaveBeenCalledWith({
      where: { projectId: PROJECT_ID, status: "SCHEDULED" },
      data: {
        status: "CANCELED",
        canceledAt: created.cutoffAt,
        revision: { increment: 1 },
      },
    });
    expect(retireSocialConnectionsMock).toHaveBeenCalledWith(
      expect.anything(),
      PROJECT_ID,
      scope.actorUserId,
    );
    expect(socialPostUpdateManyMock.mock.invocationCallOrder[0]).toBeLessThan(
      retireSocialConnectionsMock.mock.invocationCallOrder[0],
    );
    expect(
      retireSocialConnectionsMock.mock.invocationCallOrder[0],
    ).toBeLessThan(projectCloseOperationCreateMock.mock.invocationCallOrder[0]);
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

  it("archives the Project's Soko Bots in the close and republishes their mentions after it", async () => {
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
    archiveProjectSokoBotsMock.mockResolvedValue(["mention-message-1"]);
    let committed = false;
    serializableTransactionMock.mockImplementation(async (callback) => {
      const result = await callback(transactionClient());
      committed = true;
      return result;
    });
    publishMentionStatusesMock.mockImplementation(async () => {
      expect(committed).toBe(true);
    });

    await requestProjectClose(scope, {
      operationId: CLOSE_ID,
      expectedProjectRevision: 4,
    });

    expect(archiveProjectSokoBotsMock).toHaveBeenCalledWith(
      expect.anything(),
      PROJECT_ID,
    );
    expect(archiveProjectSokoBotsMock.mock.invocationCallOrder[0]).toBeLessThan(
      projectCloseOperationCreateMock.mock.invocationCallOrder[0],
    );
    expect(publishMentionStatusesMock).toHaveBeenCalledWith([
      "mention-message-1",
    ]);
  });

  it("archives nothing when a close is replayed", async () => {
    projectFindFirstMock.mockResolvedValue({
      id: PROJECT_ID,
      projectRevision: 8,
      closingAt: CUTOFF,
      closedAt: null,
      closeOperation: operation,
    });

    await requestProjectClose(scope, {
      operationId: CLOSE_ID,
      expectedProjectRevision: 8,
      reason: "Campaign completed",
    });

    expect(archiveProjectSokoBotsMock).not.toHaveBeenCalled();
    expect(publishMentionStatusesMock).not.toHaveBeenCalled();
  });

  it("counts the owed Runs of Active Task Schedules and names the failure", async () => {
    projectFindFirstMock.mockResolvedValue({
      projectRevision: 6,
      closeOperation: operation,
    });
    taskScheduleRunCountMock.mockResolvedValue(3);

    const status = await getProjectCloseStatus(scope);

    expect(status).toMatchObject({
      owedOccurrenceCount: 3,
      failure: {
        scheduleId: "schedule_123",
        message: "Scheduled work could not be closed",
      },
    });
    expect(taskScheduleRunCountMock).toHaveBeenCalledWith({
      where: {
        sourceProjectId: PROJECT_ID,
        state: "PLANNED",
        effectiveScheduledAt: { lt: CUTOFF },
        schedule: { state: "ACTIVE" },
      },
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
    expect(socialPostUpdateManyMock).not.toHaveBeenCalled();
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
    recoverableProject();

    const status = await retryProjectClose(scope, {
      operationId: RECOVERY_ID,
      expectedProjectRevision: 5,
      reason: "Dependency recovered",
    });

    expect(status).toMatchObject({
      state: "CLOSING",
      failure: null,
      projectRevision: 6,
    });
    expect(taskScheduleRunUpdateManyMock).not.toHaveBeenCalled();
    expect(projectCloseOperationUpdateMock).toHaveBeenCalledWith({
      where: { id: CLOSE_ID },
      data: expect.objectContaining({
        state: ProjectCloseOperationState.CLOSING,
        attempts: 0,
        leaseToken: null,
      }),
    });
    expect(projectEventCreateMock).toHaveBeenCalledWith({
      data: expect.objectContaining({
        eventKey: `project-close:recovery:${RECOVERY_ID}`,
        kind: "RETRY_REQUESTED",
        reason: "Dependency recovered",
      }),
    });
  });

  it("cancels a failed Task Schedule's owed Runs, leaving its End to the close", async () => {
    recoverableProject();

    const status = await cancelProjectCloseOwedWork(scope, {
      operationId: RECOVERY_ID,
      expectedProjectRevision: 5,
      reason: "Do not run the owed Runs",
    });

    expect(status.state).toBe("CLOSING");
    expect(taskScheduleRunUpdateManyMock).toHaveBeenCalledWith({
      where: {
        scheduleId: "schedule_123",
        state: "PLANNED",
        effectiveScheduledAt: { lt: CUTOFF },
      },
      data: { state: "CANCELED" },
    });
    expect(projectEventCreateMock).toHaveBeenCalledWith({
      data: expect.objectContaining({
        eventKey: `project-close:recovery:${RECOVERY_ID}`,
        kind: "SERIES_RESOLVED",
        payload: { action: "cancel-owed", recoveryOperationId: RECOVERY_ID },
      }),
    });
  });

  it.each([
    ["no failure summary", null],
    [
      "a failure outside a schedule",
      { scheduleId: null, message: "Scheduled work could not be closed" },
    ],
  ])("refuses to cancel owed work with %s", async (_name, failureSummary) => {
    recoverableProject({ ...operation, failureSummary });

    await expect(
      cancelProjectCloseOwedWork(scope, {
        operationId: RECOVERY_ID,
        expectedProjectRevision: 5,
        reason: "Do not run the owed Runs",
      }),
    ).rejects.toMatchObject({
      status: 409,
      message: "Project close has no failed Task Schedule to cancel",
    });
    expect(taskScheduleRunUpdateManyMock).not.toHaveBeenCalled();
    expect(projectCloseOperationUpdateMock).not.toHaveBeenCalled();
  });

  it("rejects reusing a retry key for canceling owed work", async () => {
    recoverableProject();
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
    expect(taskScheduleRunUpdateManyMock).not.toHaveBeenCalled();
  });
});
