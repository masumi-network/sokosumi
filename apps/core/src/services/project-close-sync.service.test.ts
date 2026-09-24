import {
  Prisma,
  ProjectCloseOperationState,
  TaskScheduleState,
  TaskStatus,
} from "@sokosumi/database";
import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  deliverCalendarInvalidationsNowMock,
  lockCalendarScopeMock,
  notifyProjectCloseTransitionMock,
  notifyTaskHumanAssigneeMock,
  publishTaskEventDataMock,
  retryMissingProjectCloseNotificationsMock,
  prismaMock,
  projectCloseOperationFindFirstMock,
  projectCloseOperationFindManyMock,
  projectCloseOperationUpdateManyMock,
  projectEventCreateMock,
  projectUpdateMock,
  taskCreateMock,
  taskScheduleFindFirstMock,
  taskScheduleFindUniqueOrThrowMock,
  taskScheduleUpdateManyMock,
  taskScheduleRunDeleteManyMock,
  taskScheduleRunFindFirstMock,
  taskScheduleRunFindManyMock,
  taskScheduleRunUpdateManyMock,
  transactionMock,
  txProjectCloseOperationFindFirstMock,
  txProjectCloseOperationUpdateManyMock,
} = vi.hoisted(() => ({
  deliverCalendarInvalidationsNowMock: vi.fn(),
  lockCalendarScopeMock: vi.fn(),
  notifyProjectCloseTransitionMock: vi.fn(),
  notifyTaskHumanAssigneeMock: vi.fn(),
  publishTaskEventDataMock: vi.fn(),
  retryMissingProjectCloseNotificationsMock: vi.fn(),
  prismaMock: {
    $transaction: vi.fn(),
    projectCloseOperation: {
      findFirst: vi.fn(),
      findMany: vi.fn(),
      updateMany: vi.fn(),
    },
  },
  projectCloseOperationFindFirstMock: vi.fn(),
  projectCloseOperationFindManyMock: vi.fn(),
  projectCloseOperationUpdateManyMock: vi.fn(),
  projectEventCreateMock: vi.fn(),
  projectUpdateMock: vi.fn(),
  taskCreateMock: vi.fn(),
  taskScheduleFindFirstMock: vi.fn(),
  taskScheduleFindUniqueOrThrowMock: vi.fn(),
  taskScheduleUpdateManyMock: vi.fn(),
  taskScheduleRunDeleteManyMock: vi.fn(),
  taskScheduleRunFindFirstMock: vi.fn(),
  taskScheduleRunFindManyMock: vi.fn(),
  taskScheduleRunUpdateManyMock: vi.fn(),
  transactionMock: vi.fn(),
  txProjectCloseOperationFindFirstMock: vi.fn(),
  txProjectCloseOperationUpdateManyMock: vi.fn(),
}));

const { getPendingSocialRevocationMock, revokeSocialForCloseMock } = vi.hoisted(
  () => ({
    getPendingSocialRevocationMock: vi.fn(),
    revokeSocialForCloseMock: vi.fn(),
  }),
);
vi.mock("@/services/project-social-connections.service", () => ({
  getPendingProjectSocialRevocation: getPendingSocialRevocationMock,
  revokeProjectSocialConnectionForClose: revokeSocialForCloseMock,
}));

vi.mock("@/helpers/calendar-locks", () => ({
  lockCalendarScope: lockCalendarScopeMock,
}));
vi.mock("@/helpers/calendar-invalidation", () => ({
  deliverCalendarInvalidationsNow: deliverCalendarInvalidationsNowMock,
}));
vi.mock("@/helpers/project-close-notifications", () => ({
  notifyProjectCloseTransition: notifyProjectCloseTransitionMock,
  retryMissingProjectCloseNotifications:
    retryMissingProjectCloseNotificationsMock,
}));
vi.mock("@/helpers/task-notifications", () => ({
  notifyTaskHumanAssignee: notifyTaskHumanAssigneeMock,
}));
vi.mock("@/lib/ably/publish", () => ({
  publishTaskEventData: publishTaskEventDataMock,
}));
vi.mock("@/lib/db/prisma", () => ({ default: prismaMock }));

import { projectCloseSyncService } from "@/services/project-close-sync.service";

const WORKSPACE_ID = "11111111-1111-7111-8111-111111111111";
const PROJECT_ID = "22222222-2222-7222-8222-222222222222";
const CLOSE_ID = "33333333-3333-7333-8333-333333333333";
const CUTOFF = new Date("2026-09-14T10:00:00.000Z");

const operation = {
  id: CLOSE_ID,
  projectId: PROJECT_ID,
  cutoffAt: CUTOFF,
  project: { workspaceId: WORKSPACE_ID },
};

const schedule = {
  id: "schedule_123",
  ownerId: "user_123",
  organizationId: null,
  workspaceId: WORKSPACE_ID,
  projectId: PROJECT_ID,
  name: "Daily standup notes",
  description: null,
  visibility: "PUBLIC",
  assigneeId: null,
  assigneeSokoBotId: null,
  assigneeUserId: "user_456",
  creatorUserId: "user_123",
  creatorCoworkerId: null,
  creatorSokoBotId: null,
  state: TaskScheduleState.ACTIVE,
  releasedCount: 5,
  revision: 3,
};
const scheduleCandidate = { id: schedule.id, ownerId: schedule.ownerId };

function txClient() {
  return {
    project: { update: projectUpdateMock },
    projectCloseOperation: {
      findFirst: txProjectCloseOperationFindFirstMock,
      updateMany: txProjectCloseOperationUpdateManyMock,
    },
    projectEvent: { create: projectEventCreateMock },
    task: { create: taskCreateMock },
    taskSchedule: {
      findFirst: taskScheduleFindFirstMock,
      findUniqueOrThrow: taskScheduleFindUniqueOrThrowMock,
      updateMany: taskScheduleUpdateManyMock,
    },
    taskScheduleRun: {
      deleteMany: taskScheduleRunDeleteManyMock,
      findFirst: taskScheduleRunFindFirstMock,
      findMany: taskScheduleRunFindManyMock,
      updateMany: taskScheduleRunUpdateManyMock,
    },
  };
}

function options() {
  return {
    abortSignal: new AbortController().signal,
    deadlineMs: Date.now() + 60_000,
    shouldContinue: () => true,
  };
}

function eventKinds(): string[] {
  return projectEventCreateMock.mock.calls.map(([call]) => call.data.kind);
}

describe("project close sync", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getPendingSocialRevocationMock.mockReset().mockResolvedValue(null);
    revokeSocialForCloseMock.mockReset().mockResolvedValue(undefined);
    prismaMock.$transaction = transactionMock;
    prismaMock.projectCloseOperation.findFirst =
      projectCloseOperationFindFirstMock;
    prismaMock.projectCloseOperation.findMany =
      projectCloseOperationFindManyMock;
    prismaMock.projectCloseOperation.updateMany =
      projectCloseOperationUpdateManyMock;
    transactionMock.mockImplementation(async (callback) =>
      callback(txClient()),
    );
    projectCloseOperationFindManyMock.mockResolvedValue([{ id: CLOSE_ID }]);
    projectCloseOperationUpdateManyMock.mockResolvedValue({ count: 1 });
    txProjectCloseOperationUpdateManyMock.mockResolvedValue({ count: 1 });
    txProjectCloseOperationFindFirstMock.mockResolvedValue(operation);
    lockCalendarScopeMock.mockResolvedValue(true);
    projectEventCreateMock.mockResolvedValue({ id: "project_event_123" });
    projectUpdateMock.mockResolvedValue({});
    taskScheduleFindFirstMock.mockResolvedValue(null);
    taskScheduleFindUniqueOrThrowMock.mockResolvedValue(schedule);
    taskScheduleUpdateManyMock.mockResolvedValue({ count: 1 });
    taskScheduleRunFindManyMock.mockResolvedValue([]);
    taskScheduleRunFindFirstMock.mockResolvedValue(null);
    taskScheduleRunUpdateManyMock.mockResolvedValue({ count: 1 });
    taskScheduleRunDeleteManyMock.mockResolvedValue({ count: 0 });
  });

  it("finalizes the close once no Task Schedule is left", async () => {
    const result = await projectCloseSyncService.syncProjectCloses(options());

    expect(result).toEqual({
      claimed: 1,
      processedSchedules: 0,
      closed: 1,
      failed: 0,
    });
    expect(taskScheduleFindFirstMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          projectId: PROJECT_ID,
          state: { not: TaskScheduleState.ENDED },
        },
      }),
    );
    // Later Runs sourced from the project leave the plan into the history.
    expect(taskScheduleRunUpdateManyMock).toHaveBeenCalledWith({
      where: {
        sourceProjectId: PROJECT_ID,
        state: { in: ["PLANNED", "SKIPPED"] },
        effectiveScheduledAt: { gte: CUTOFF },
      },
      data: { state: "CANCELED" },
    });
    expect(projectUpdateMock).toHaveBeenCalledWith({
      where: { id: PROJECT_ID },
      data: { closedAt: expect.any(Date), projectRevision: { increment: 1 } },
    });
    expect(txProjectCloseOperationUpdateManyMock).toHaveBeenCalledWith({
      where: {
        id: CLOSE_ID,
        state: ProjectCloseOperationState.CLOSING,
        leaseToken: expect.any(String),
      },
      data: expect.objectContaining({
        state: ProjectCloseOperationState.CLOSED,
        completedAt: expect.any(Date),
        leaseToken: null,
        failureSummary: Prisma.DbNull,
      }),
    });
    expect(eventKinds()).toEqual(["CLOSE_FINALIZED"]);
    expect(notifyProjectCloseTransitionMock).toHaveBeenCalledWith(
      "project_event_123",
    );
    expect(deliverCalendarInvalidationsNowMock).toHaveBeenCalledWith(
      WORKSPACE_ID,
    );
  });

  it("stops without closing when the lease is lost", async () => {
    txProjectCloseOperationFindFirstMock.mockResolvedValue(null);

    const result = await projectCloseSyncService.syncProjectCloses(options());

    expect(result).toMatchObject({ claimed: 1, closed: 0, failed: 0 });
    expect(projectUpdateMock).not.toHaveBeenCalled();
    expect(notifyProjectCloseTransitionMock).not.toHaveBeenCalled();
  });

  it("backs off transient failures and names the failed schedule after exhaustion", async () => {
    taskScheduleFindFirstMock.mockResolvedValue(scheduleCandidate);
    taskScheduleFindUniqueOrThrowMock.mockRejectedValue(new Error("boom"));
    projectCloseOperationFindFirstMock.mockResolvedValue({
      attempts: 2,
      projectId: PROJECT_ID,
    });

    const result = await projectCloseSyncService.syncProjectCloses(options());

    expect(result).toMatchObject({ closed: 0, failed: 1 });
    expect(projectUpdateMock).not.toHaveBeenCalled();
    expect(txProjectCloseOperationUpdateManyMock).toHaveBeenCalledWith({
      where: {
        id: CLOSE_ID,
        state: ProjectCloseOperationState.CLOSING,
        leaseToken: expect.any(String),
      },
      data: expect.objectContaining({
        state: ProjectCloseOperationState.CLOSE_FAILED,
        attempts: 3,
        nextAttemptAt: null,
        failureSummary: {
          scheduleId: schedule.id,
          message: "Scheduled work could not be closed",
        },
      }),
    });
    expect(notifyProjectCloseTransitionMock).toHaveBeenCalledWith(
      "project_event_123",
    );
  });

  it("retries a failed batch later without notifying", async () => {
    taskScheduleFindFirstMock.mockResolvedValue(scheduleCandidate);
    taskScheduleFindUniqueOrThrowMock.mockRejectedValue(new Error("boom"));
    projectCloseOperationFindFirstMock.mockResolvedValue({
      attempts: 0,
      projectId: PROJECT_ID,
    });

    const result = await projectCloseSyncService.syncProjectCloses(options());

    expect(result).toMatchObject({ closed: 0, failed: 0 });
    expect(txProjectCloseOperationUpdateManyMock).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          state: ProjectCloseOperationState.CLOSING,
          attempts: 1,
          nextAttemptAt: expect.any(Date),
        }),
      }),
    );
    expect(notifyProjectCloseTransitionMock).not.toHaveBeenCalled();
  });

  it("names no schedule when the failure is outside one", async () => {
    projectUpdateMock.mockRejectedValue(new Error("boom"));
    projectCloseOperationFindFirstMock.mockResolvedValue({
      attempts: 2,
      projectId: PROJECT_ID,
    });

    const result = await projectCloseSyncService.syncProjectCloses(options());

    expect(result).toMatchObject({ closed: 0, failed: 1 });
    expect(projectEventCreateMock).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          kind: "BATCH_FAILED",
          payload: {
            attempts: 3,
            failed: true,
            scheduleId: null,
            message: "Project work could not be closed",
          },
        }),
      }),
    );
  });

  it("waits for social authorization revocation before closing the project", async () => {
    const pending = { connectedAccountId: "ca_project" };
    taskScheduleFindFirstMock.mockResolvedValue(null);
    getPendingSocialRevocationMock.mockResolvedValueOnce(pending);
    let finishRevocation: (() => void) | undefined;
    revokeSocialForCloseMock.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          finishRevocation = resolve;
        }),
    );

    const sync = projectCloseSyncService.syncProjectCloses(options());
    await vi.waitFor(() =>
      expect(revokeSocialForCloseMock).toHaveBeenCalledWith(pending),
    );

    expect(projectUpdateMock).not.toHaveBeenCalled();
    expect(notifyProjectCloseTransitionMock).not.toHaveBeenCalled();
    finishRevocation?.();
    const result = await sync;

    expect(result).toMatchObject({ closed: 1, failed: 0 });
    expect(projectUpdateMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: PROJECT_ID },
        data: expect.objectContaining({ closedAt: expect.any(Date) }),
      }),
    );
    expect(notifyProjectCloseTransitionMock).toHaveBeenCalledWith(
      "project_event_123",
    );
  });

  it("keeps a failed social revocation retryable without closing the project", async () => {
    const pending = { connectedAccountId: "ca_project" };
    taskScheduleFindFirstMock.mockResolvedValue(null);
    projectCloseOperationFindFirstMock.mockResolvedValue({
      attempts: 0,
      projectId: PROJECT_ID,
    });
    getPendingSocialRevocationMock.mockResolvedValueOnce(pending);
    revokeSocialForCloseMock.mockRejectedValueOnce(
      new Error("Provider unavailable"),
    );

    const result = await projectCloseSyncService.syncProjectCloses(options());

    expect(result).toMatchObject({ closed: 0, failed: 0 });
    expect(projectUpdateMock).not.toHaveBeenCalled();
    expect(notifyProjectCloseTransitionMock).not.toHaveBeenCalled();
    expect(txProjectCloseOperationUpdateManyMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          id: CLOSE_ID,
          leaseToken: expect.any(String),
        }),
        data: expect.objectContaining({
          state: ProjectCloseOperationState.CLOSING,
          attempts: 1,
          leaseToken: null,
          leasedAt: null,
          nextAttemptAt: expect.any(Date),
          failureSummary: {
            scheduleId: null,
            message: "Project work could not be closed",
          },
        }),
      }),
    );
    expect(projectEventCreateMock).not.toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ kind: "CLOSE_FINALIZED" }),
      }),
    );

    getPendingSocialRevocationMock.mockResolvedValueOnce(pending);
    const retry = await projectCloseSyncService.syncProjectCloses(options());

    expect(revokeSocialForCloseMock).toHaveBeenCalledTimes(2);
    expect(retry.closed).toBe(1);
  });

  it("bounds social revocation batches to ten and resumes before closing", async () => {
    taskScheduleFindFirstMock.mockResolvedValue(null);
    for (let index = 0; index < 11; index += 1) {
      getPendingSocialRevocationMock.mockResolvedValueOnce({
        connectedAccountId: `ca_${index}`,
      });
    }

    const first = await projectCloseSyncService.syncProjectCloses(options());

    expect(first.closed).toBe(0);
    expect(revokeSocialForCloseMock).toHaveBeenCalledTimes(10);
    expect(projectUpdateMock).not.toHaveBeenCalled();
    expect(projectCloseOperationUpdateManyMock).toHaveBeenCalledWith({
      where: {
        id: CLOSE_ID,
        state: ProjectCloseOperationState.CLOSING,
        leaseToken: expect.any(String),
      },
      data: {
        leaseToken: null,
        leasedAt: null,
        nextAttemptAt: expect.any(Date),
      },
    });

    const second = await projectCloseSyncService.syncProjectCloses(options());

    expect(revokeSocialForCloseMock).toHaveBeenCalledTimes(11);
    expect(revokeSocialForCloseMock).toHaveBeenLastCalledWith({
      connectedAccountId: "ca_10",
    });
    expect(second.closed).toBe(1);
  });

  it("releases claims it cannot start before the deadline", async () => {
    projectCloseOperationFindManyMock.mockResolvedValue([
      { id: CLOSE_ID },
      { id: "77777777-7777-7777-8777-777777777777" },
    ]);

    const result = await projectCloseSyncService.syncProjectCloses({
      ...options(),
      shouldContinue: () => false,
    });

    expect(result.claimed).toBe(2);
    const releaseCalls = projectCloseOperationUpdateManyMock.mock.calls.filter(
      ([call]) => call.data.leaseToken === null,
    );
    expect(releaseCalls).toHaveLength(2);
    expect(releaseCalls[0]?.[0]).toEqual(
      expect.objectContaining({
        where: expect.objectContaining({ leaseToken: expect.any(String) }),
        data: expect.objectContaining({ leaseToken: null, leasedAt: null }),
      }),
    );
    expect(transactionMock).not.toHaveBeenCalled();
  });

  it("does not bypass backoff when a candidate changes before claim", async () => {
    projectCloseOperationUpdateManyMock.mockResolvedValueOnce({ count: 0 });

    const result = await projectCloseSyncService.syncProjectCloses(options());

    expect(result.claimed).toBe(0);
    expect(projectCloseOperationUpdateManyMock).toHaveBeenCalledWith({
      where: {
        id: CLOSE_ID,
        state: ProjectCloseOperationState.CLOSING,
        AND: [
          {
            OR: [
              { nextAttemptAt: null },
              { nextAttemptAt: { lte: expect.any(Date) } },
            ],
          },
          {
            OR: [
              { leaseToken: null },
              { leasedAt: null },
              { leasedAt: { lte: expect.any(Date) } },
            ],
          },
        ],
      },
      data: { leaseToken: expect.any(String), leasedAt: expect.any(Date) },
    });
  });

  describe("Task Schedules", () => {
    const owedRun = (id: string) => ({ id });

    beforeEach(() => {
      taskCreateMock.mockImplementation(async () => ({
        id: `task_${taskCreateMock.mock.calls.length}`,
        ownerId: schedule.ownerId,
        assigneeUserId: schedule.assigneeUserId,
      }));
    });

    it("releases Runs owed before the cutoff, then Ends the schedule", async () => {
      taskScheduleFindFirstMock
        .mockResolvedValueOnce(scheduleCandidate)
        .mockResolvedValue(null);
      taskScheduleRunFindManyMock
        // Owed before the cutoff.
        .mockResolvedValueOnce([owedRun("run_1"), owedRun("run_2")])
        // Still planned when the schedule Ends: a plain Run and a skip.
        .mockResolvedValueOnce([
          {
            id: "run_later",
            state: "PLANNED",
            originalScheduledAt: new Date("2026-09-15T09:00:00.000Z"),
            effectiveScheduledAt: new Date("2026-09-15T09:00:00.000Z"),
          },
          {
            id: "run_skipped",
            state: "SKIPPED",
            originalScheduledAt: new Date("2099-09-16T09:00:00.000Z"),
            effectiveScheduledAt: new Date("2099-09-16T09:00:00.000Z"),
          },
        ])
        .mockResolvedValue([]);

      const result = await projectCloseSyncService.syncProjectCloses(options());

      expect(result).toMatchObject({ processedSchedules: 1, closed: 1 });
      expect(lockCalendarScopeMock).toHaveBeenCalledWith(
        expect.any(Object),
        WORKSPACE_ID,
        [PROJECT_ID],
        schedule.ownerId,
      );
      expect(taskScheduleRunFindManyMock).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            scheduleId: schedule.id,
            state: "PLANNED",
            effectiveScheduledAt: { lt: CUTOFF },
          },
          take: 25,
        }),
      );
      expect(taskCreateMock).toHaveBeenCalledTimes(2);
      expect(taskCreateMock).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            scheduleId: schedule.id,
            projectId: PROJECT_ID,
            assigneeUserId: "user_456",
            status: TaskStatus.READY,
          }),
        }),
      );
      expect(taskScheduleRunUpdateManyMock).toHaveBeenCalledWith({
        where: { id: "run_2", state: "PLANNED" },
        data: { state: "RELEASED", releasedTaskId: "task_2" },
      });
      // Later Runs leave the plan: plain ones go, the skip into the history.
      expect(taskScheduleRunDeleteManyMock).toHaveBeenCalledWith({
        where: { id: { in: ["run_later"] } },
      });
      expect(taskScheduleRunUpdateManyMock).toHaveBeenCalledWith({
        where: { id: { in: ["run_skipped"] } },
        data: { state: "CANCELED" },
      });
      expect(taskScheduleUpdateManyMock).toHaveBeenCalledWith({
        where: { id: schedule.id, revision: 3, releasedCount: 5 },
        data: {
          releasedCount: 7,
          state: TaskScheduleState.ENDED,
          nextRunAt: null,
          revision: { increment: 1 },
        },
      });
      expect(projectEventCreateMock).toHaveBeenCalledWith({
        data: {
          projectId: PROJECT_ID,
          closeOperationId: CLOSE_ID,
          eventKey: `project-close:schedule:${CLOSE_ID}:${schedule.id}`,
          kind: "SERIES_RESOLVED",
          payload: { scheduleId: schedule.id },
        },
      });
      expect(publishTaskEventDataMock).toHaveBeenCalledTimes(2);
      expect(notifyTaskHumanAssigneeMock).toHaveBeenCalledWith(
        "task_1",
        "user_456",
      );
      expect(projectUpdateMock).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ closedAt: expect.any(Date) }),
        }),
      );
    });

    it("keeps the schedule Active while an owed batch remains", async () => {
      taskScheduleFindFirstMock
        .mockResolvedValueOnce(scheduleCandidate)
        .mockResolvedValueOnce(scheduleCandidate)
        .mockResolvedValue(null);
      taskScheduleRunFindManyMock
        .mockResolvedValueOnce([owedRun("run_1")])
        .mockResolvedValueOnce([owedRun("run_2")])
        .mockResolvedValue([]);
      // The second batch still sees an owed Run after the first.
      taskScheduleRunFindFirstMock
        .mockResolvedValueOnce({
          effectiveScheduledAt: new Date("2026-09-14T09:30:00.000Z"),
        })
        .mockResolvedValue(null);
      taskScheduleFindUniqueOrThrowMock
        .mockResolvedValueOnce(schedule)
        .mockResolvedValueOnce({ ...schedule, releasedCount: 6 });

      const result = await projectCloseSyncService.syncProjectCloses(options());

      expect(result).toMatchObject({ processedSchedules: 2, closed: 1 });
      expect(taskScheduleUpdateManyMock).toHaveBeenCalledWith({
        where: { id: schedule.id, revision: 3, releasedCount: 5 },
        // The next owed Run, not the one this batch released.
        data: {
          releasedCount: 6,
          nextRunAt: new Date("2026-09-14T09:30:00.000Z"),
        },
      });
      expect(taskScheduleUpdateManyMock).toHaveBeenCalledWith({
        where: { id: schedule.id, revision: 3, releasedCount: 6 },
        data: {
          releasedCount: 7,
          state: TaskScheduleState.ENDED,
          nextRunAt: null,
          revision: { increment: 1 },
        },
      });
      expect(
        eventKinds().filter((kind) => kind === "SERIES_RESOLVED"),
      ).toHaveLength(1);
      // A processed batch resets the failure streak.
      expect(txProjectCloseOperationUpdateManyMock).toHaveBeenCalledWith(
        expect.objectContaining({
          data: {
            attempts: 0,
            failureSummary: Prisma.DbNull,
            leasedAt: expect.any(Date),
          },
        }),
      );
    });

    it("hands the close back when the batch limit runs out", async () => {
      taskScheduleFindFirstMock
        .mockResolvedValueOnce(scheduleCandidate)
        .mockResolvedValue(null);
      taskScheduleRunFindManyMock.mockResolvedValueOnce([owedRun("run_1")]);
      taskScheduleRunFindFirstMock.mockResolvedValue({
        effectiveScheduledAt: new Date("2026-09-14T09:30:00.000Z"),
      });

      const result = await projectCloseSyncService.syncProjectCloses({
        ...options(),
        shouldContinue: () => transactionMock.mock.calls.length < 1,
      });

      expect(result).toMatchObject({ processedSchedules: 1, closed: 0 });
      expect(projectUpdateMock).not.toHaveBeenCalled();
      expect(eventKinds()).not.toContain("SERIES_RESOLVED");
      expect(notifyProjectCloseTransitionMock).not.toHaveBeenCalled();
      expect(projectCloseOperationUpdateManyMock).toHaveBeenCalledWith({
        where: {
          id: CLOSE_ID,
          state: ProjectCloseOperationState.CLOSING,
          leaseToken: expect.any(String),
        },
        data: {
          leaseToken: null,
          leasedAt: null,
          nextAttemptAt: expect.any(Date),
        },
      });
    });

    it("Ends a Paused schedule without releasing its owed Runs", async () => {
      taskScheduleFindFirstMock
        .mockResolvedValueOnce(scheduleCandidate)
        .mockResolvedValue(null);
      taskScheduleFindUniqueOrThrowMock.mockResolvedValue({
        ...schedule,
        state: TaskScheduleState.PAUSED,
      });

      const result = await projectCloseSyncService.syncProjectCloses(options());

      expect(result.closed).toBe(1);
      expect(taskCreateMock).not.toHaveBeenCalled();
      expect(taskScheduleUpdateManyMock).toHaveBeenCalledWith({
        where: { id: schedule.id, revision: 3, releasedCount: 5 },
        data: {
          releasedCount: 5,
          state: TaskScheduleState.ENDED,
          nextRunAt: null,
          revision: { increment: 1 },
        },
      });
    });

    it("fails the batch, naming the schedule, when it changed under the close", async () => {
      taskScheduleFindFirstMock.mockResolvedValue(scheduleCandidate);
      taskScheduleUpdateManyMock.mockResolvedValue({ count: 0 });
      projectCloseOperationFindFirstMock.mockResolvedValue({
        attempts: 0,
        projectId: PROJECT_ID,
      });

      const result = await projectCloseSyncService.syncProjectCloses(options());

      expect(result).toMatchObject({ closed: 0, failed: 0 });
      expect(projectUpdateMock).not.toHaveBeenCalled();
      expect(projectEventCreateMock).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            kind: "BATCH_FAILED",
            payload: {
              attempts: 1,
              failed: false,
              scheduleId: schedule.id,
              message: "Scheduled work could not be closed",
            },
          }),
        }),
      );
    });
  });
});
