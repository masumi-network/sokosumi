import { ScheduleType } from "@sokosumi/database";
import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  countJobsMock,
  createAgentJobForUserMock,
  findDueMock,
  getByIdMock,
  mapJobWithStatusMock,
  publishJobStatusDataMock,
  releaseLockMock,
  setActiveMock,
  setNextRunMock,
  syncLockAcquireMock,
  computeNextRunMock,
} = vi.hoisted(() => ({
  countJobsMock: vi.fn(),
  createAgentJobForUserMock: vi.fn(),
  findDueMock: vi.fn(),
  getByIdMock: vi.fn(),
  mapJobWithStatusMock: vi.fn(),
  publishJobStatusDataMock: vi.fn(),
  releaseLockMock: vi.fn(),
  setActiveMock: vi.fn(),
  setNextRunMock: vi.fn(),
  syncLockAcquireMock: vi.fn(),
  computeNextRunMock: vi.fn(),
}));

vi.mock("@sokosumi/database/repositories", () => ({
  jobScheduleRepository: {
    countJobs: countJobsMock,
    findDue: findDueMock,
    getById: getByIdMock,
    setActive: setActiveMock,
    setNextRun: setNextRunMock,
  },
}));

vi.mock("@sokosumi/database/helpers", () => ({
  mapJobWithStatus: mapJobWithStatusMock,
}));

vi.mock("@/helpers/cron", () => ({
  computeNextRun: computeNextRunMock,
}));

vi.mock("@/helpers/job", () => ({
  createAgentJobForUser: createAgentJobForUserMock,
}));

vi.mock("@/lib/ably/publish", () => ({
  publishJobStatusData: publishJobStatusDataMock,
}));

vi.mock("@/services/sync-lock.service", () => ({
  syncLockService: {
    acquireLock: syncLockAcquireMock,
    releaseLock: releaseLockMock,
  },
}));

vi.mock("@/lib/db/prisma", () => ({
  default: {},
}));

async function getJobScheduleSyncService() {
  const module = await import("./job-schedule-sync.service");
  return module.jobScheduleSyncService;
}

function createExecutionOptions() {
  return {
    abortSignal: new AbortController().signal,
    deadlineMs: Date.now() + 60_000,
    shouldContinue: () => true,
  };
}

function createSchedule(overrides: Record<string, unknown> = {}) {
  return {
    id: "schedule_1",
    createdAt: new Date("2026-02-25T10:00:00.000Z"),
    updatedAt: new Date("2026-02-25T10:00:00.000Z"),
    userId: "user_1",
    organizationId: "org_1",
    agentId: "agent_1",
    scheduleType: ScheduleType.ONE_TIME,
    cron: null,
    oneTimeAtUtc: new Date("2026-02-25T10:00:00.000Z"),
    timezone: "UTC",
    endOnUtc: null,
    endAfterOccurrences: null,
    inputSchema: JSON.stringify([
      {
        id: "prompt",
        type: "string",
        name: "prompt",
      },
    ]),
    input: JSON.stringify({ prompt: "hello" }),
    maxAcceptedCents: BigInt(100),
    isActive: true,
    nextRunAt: new Date("2026-02-25T10:00:00.000Z"),
    pauseReason: null,
    ...overrides,
  };
}

describe("jobScheduleSyncService.executeDueSchedules", () => {
  beforeEach(() => {
    vi.clearAllMocks();

    findDueMock.mockResolvedValue([]);
    getByIdMock.mockResolvedValue({ isActive: true });
    countJobsMock.mockResolvedValue(1);
    setActiveMock.mockResolvedValue(undefined);
    setNextRunMock.mockResolvedValue(undefined);
    syncLockAcquireMock.mockResolvedValue({
      key: "job-schedule-schedule_1",
      ownerToken: "owner-token",
    });
    releaseLockMock.mockResolvedValue(true);
    computeNextRunMock.mockReturnValue(new Date("2026-02-25T11:00:00.000Z"));
    createAgentJobForUserMock.mockResolvedValue({
      id: "job_1",
      agentId: "agent_1",
      userId: "user_1",
    });
    mapJobWithStatusMock.mockReturnValue({
      status: "processing",
      jobStatusSettled: false,
    });
    publishJobStatusDataMock.mockResolvedValue(undefined);
  });

  it("runs one-time schedules, disables next run, and publishes realtime status", async () => {
    findDueMock.mockResolvedValue([createSchedule()]);

    const jobScheduleSyncService = await getJobScheduleSyncService();
    const result = await jobScheduleSyncService.executeDueSchedules(
      createExecutionOptions(),
    );

    expect(result.dueFound).toBe(1);
    expect(result.processed).toBe(1);
    expect(result.skippedLocked).toBe(0);
    expect(createAgentJobForUserMock).toHaveBeenCalledWith({
      owner: {
        userId: "user_1",
        organizationId: "org_1",
      },
      agentInput: {
        agentId: "agent_1",
        inputData: { prompt: "hello" },
        inputSchema: {
          input_data: [
            {
              id: "prompt",
              type: "string",
              name: "prompt",
            },
          ],
        },
        maxAcceptedCents: BigInt(100),
      },
      scheduleContext: {
        jobScheduleId: "schedule_1",
      },
    });
    expect(setNextRunMock).toHaveBeenCalledWith("schedule_1", null, {});
    expect(publishJobStatusDataMock).toHaveBeenCalledWith({
      agentId: "agent_1",
      userId: "user_1",
      jobId: "job_1",
      jobStatus: "processing",
      jobStatusSettled: false,
    });
    expect(releaseLockMock).toHaveBeenCalledWith(
      "job-schedule-schedule_1",
      "owner-token",
    );
  }, 10_000);

  it("computes and stores the next run for cron schedules", async () => {
    findDueMock.mockResolvedValue([
      createSchedule({
        scheduleType: ScheduleType.CRON,
        cron: "0 * * * *",
        oneTimeAtUtc: null,
      }),
    ]);

    const jobScheduleSyncService = await getJobScheduleSyncService();
    await jobScheduleSyncService.executeDueSchedules(createExecutionOptions());

    expect(computeNextRunMock).toHaveBeenCalledWith(
      expect.objectContaining({
        cron: "0 * * * *",
        timezone: "UTC",
      }),
    );
    expect(setNextRunMock).toHaveBeenCalledWith(
      "schedule_1",
      new Date("2026-02-25T11:00:00.000Z"),
      {},
    );
  });

  it("disables cron schedules when endAfterOccurrences is reached", async () => {
    findDueMock.mockResolvedValue([
      createSchedule({
        scheduleType: ScheduleType.CRON,
        cron: "0 * * * *",
        oneTimeAtUtc: null,
        endAfterOccurrences: 1,
      }),
    ]);
    countJobsMock.mockResolvedValue(1);

    const jobScheduleSyncService = await getJobScheduleSyncService();
    await jobScheduleSyncService.executeDueSchedules(createExecutionOptions());

    expect(setNextRunMock).toHaveBeenCalledWith("schedule_1", null, {});
  });

  it("pauses invalid cron schedules with explicit pause reason", async () => {
    findDueMock.mockResolvedValue([
      createSchedule({
        scheduleType: ScheduleType.CRON,
        cron: null,
      }),
    ]);

    const jobScheduleSyncService = await getJobScheduleSyncService();
    await jobScheduleSyncService.executeDueSchedules(createExecutionOptions());

    expect(createAgentJobForUserMock).not.toHaveBeenCalled();
    expect(setActiveMock).toHaveBeenCalledWith(
      {
        id: "schedule_1",
        isActive: false,
        pauseReason: "INVALID_CRON_CONFIG",
      },
      {},
    );
  });

  it("skips schedules already locked by another runner", async () => {
    findDueMock.mockResolvedValue([createSchedule()]);
    syncLockAcquireMock.mockRejectedValue(new Error("LOCK_IS_LOCKED"));

    const jobScheduleSyncService = await getJobScheduleSyncService();
    const result = await jobScheduleSyncService.executeDueSchedules(
      createExecutionOptions(),
    );

    expect(result.dueFound).toBe(1);
    expect(result.processed).toBe(0);
    expect(result.skippedLocked).toBe(1);
    expect(createAgentJobForUserMock).not.toHaveBeenCalled();
    expect(releaseLockMock).not.toHaveBeenCalled();
  });

  it("pauses a schedule when job creation fails", async () => {
    findDueMock.mockResolvedValue([createSchedule()]);
    createAgentJobForUserMock.mockRejectedValue(new Error("boom"));
    getByIdMock.mockResolvedValue({ isActive: false });

    const jobScheduleSyncService = await getJobScheduleSyncService();
    const result = await jobScheduleSyncService.executeDueSchedules(
      createExecutionOptions(),
    );

    expect(result.paused).toBe(1);
    expect(result.skippedLocked).toBe(0);
    expect(setActiveMock).toHaveBeenCalledWith(
      {
        id: "schedule_1",
        isActive: false,
        pauseReason: "boom",
      },
      {},
    );
    expect(publishJobStatusDataMock).not.toHaveBeenCalled();
    expect(releaseLockMock).toHaveBeenCalledWith(
      "job-schedule-schedule_1",
      "owner-token",
    );
  });

  it("does not pause a schedule when realtime publish fails", async () => {
    findDueMock.mockResolvedValue([createSchedule()]);
    publishJobStatusDataMock.mockRejectedValue(new Error("ably-down"));
    getByIdMock.mockResolvedValue({ isActive: true });

    const jobScheduleSyncService = await getJobScheduleSyncService();
    const result = await jobScheduleSyncService.executeDueSchedules(
      createExecutionOptions(),
    );

    expect(result.processed).toBe(1);
    expect(result.paused).toBe(0);
    expect(result.skippedLocked).toBe(0);
    expect(setActiveMock).not.toHaveBeenCalledWith(
      expect.objectContaining({
        id: "schedule_1",
        isActive: false,
      }),
      {},
    );
    expect(setNextRunMock).toHaveBeenCalledWith("schedule_1", null, {});
    expect(releaseLockMock).toHaveBeenCalledWith(
      "job-schedule-schedule_1",
      "owner-token",
    );
  });
});
