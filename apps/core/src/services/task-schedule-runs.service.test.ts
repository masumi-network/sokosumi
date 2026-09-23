import { randomUUID } from "node:crypto";

import {
  TaskScheduleEndsMode,
  TaskScheduleOccurrenceState,
  TaskScheduleState,
  TaskStatus,
} from "@sokosumi/database";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { notifyTaskHumanAssignee } from "@/helpers/task-notifications";
import {
  COWORKER_ID,
  MEMBER_ID,
  ORG_WORKSPACE_ID,
  OWNER_ID,
  PROJECT_ID,
  resetTaskScheduleTestDb,
  runsOf,
  SOKO_BOT_ID,
  seedRun,
  seedTask,
  seedTaskSchedule,
  seedTaskUpdate,
  taskScheduleTestDb,
  taskScheduleTestPrisma,
} from "@/test-fixtures/task-schedule";

vi.mock("@/lib/db/prisma", async () => ({
  default: (await import("@/test-fixtures/task-schedule"))
    .taskScheduleTestPrisma,
}));
vi.mock("@/lib/ably/publish", () => ({ publishTaskEventData: vi.fn() }));
vi.mock("@/helpers/task-notifications", () => ({
  notifyTaskHumanAssignee: vi.fn(),
}));

const { TASK_SCHEDULE_RELEASE_BATCH_SIZE, taskScheduleReleaseService } =
  await import("./task-schedule-runs.service");

const NOW = new Date("2030-01-07T09:30:00.000Z");
const MONDAY_9 = new Date("2030-01-07T09:00:00.000Z");
const NEXT_MONDAY_9 = new Date("2030-01-14T09:00:00.000Z");

function release() {
  return taskScheduleReleaseService.releaseDueSchedules({
    abortSignal: new AbortController().signal,
    deadlineMs: Number.POSITIVE_INFINITY,
    shouldContinue: () => true,
  });
}

describe("taskScheduleReleaseService.releaseDueSchedules", () => {
  beforeEach(() => {
    resetTaskScheduleTestDb();
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(NOW);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("creates a Ready Task from the blueprint at a due Run", async () => {
    const schedule = seedTaskSchedule({
      name: "Weekly report",
      description: "Summarise the week",
      nextRunAt: MONDAY_9,
    });
    const run = seedRun(schedule, MONDAY_9);

    await release();

    expect(taskScheduleTestDb.tasks).toHaveLength(1);
    const task = taskScheduleTestDb.tasks[0];
    expect(task).toMatchObject({
      scheduleId: schedule.id,
      status: TaskStatus.READY,
      name: "Weekly report",
      description: "Summarise the week",
      ownerId: OWNER_ID,
      workspaceId: schedule.workspaceId,
      organizationId: schedule.organizationId,
      projectId: null,
      visibility: schedule.visibility,
      creatorUserId: OWNER_ID,
      creatorCoworkerId: null,
      creatorSokoBotId: null,
    });
    expect(task?.events).toEqual([
      expect.objectContaining({ status: TaskStatus.READY, userId: OWNER_ID }),
    ]);
    expect(runsOf(schedule.id).find((row) => row.id === run.id)).toMatchObject({
      state: TaskScheduleOccurrenceState.RELEASED,
      releasedTaskId: task?.id,
    });
    expect(taskScheduleTestDb.schedules[0]).toMatchObject({
      state: TaskScheduleState.ACTIVE,
      releasedCount: 1,
      nextRunAt: NEXT_MONDAY_9,
    });
  });

  it.each([
    ["Coworker", { assigneeId: COWORKER_ID }],
    ["Soko Bot", { assigneeSokoBotId: SOKO_BOT_ID }],
    ["person", { assigneeUserId: MEMBER_ID }],
  ])("copies a %s assignee onto the Task", async (_kind, assignee) => {
    const schedule = seedTaskSchedule({
      nextRunAt: MONDAY_9,
      ...assignee,
    });
    seedRun(schedule, MONDAY_9);

    await release();

    expect(taskScheduleTestDb.tasks[0]).toMatchObject({
      assigneeId: null,
      assigneeSokoBotId: null,
      assigneeUserId: null,
      ...assignee,
    });
  });

  it("tells a person assignee about the new Task", async () => {
    const schedule = seedTaskSchedule({
      nextRunAt: MONDAY_9,
      assigneeUserId: MEMBER_ID,
    });
    seedRun(schedule, MONDAY_9);

    await release();

    expect(notifyTaskHumanAssignee).toHaveBeenCalledWith(
      taskScheduleTestDb.tasks[0]?.id,
      MEMBER_ID,
    );
  });

  it("makes the schedule's Coworker creator the Task's creator", async () => {
    const schedule = seedTaskSchedule({
      nextRunAt: MONDAY_9,
      creatorUserId: null,
      creatorCoworkerId: COWORKER_ID,
    });
    seedRun(schedule, MONDAY_9);

    await release();

    const task = taskScheduleTestDb.tasks[0];
    expect(task).toMatchObject({
      ownerId: OWNER_ID,
      creatorUserId: null,
      creatorCoworkerId: COWORKER_ID,
    });
    expect(task?.events[0]).toMatchObject({
      userId: null,
      coworkerId: COWORKER_ID,
    });
  });

  it("lands the Task in the blueprint's project", async () => {
    const schedule = seedTaskSchedule({
      nextRunAt: MONDAY_9,
      projectId: PROJECT_ID,
    });
    seedRun(schedule, MONDAY_9);

    await release();

    expect(taskScheduleTestDb.tasks[0]?.projectId).toBe(PROJECT_ID);
  });

  it("creates a new Task while the previous one is still open", async () => {
    const schedule = seedTaskSchedule({
      nextRunAt: MONDAY_9,
      releasedCount: 1,
    });
    taskScheduleTestDb.tasks.push({
      id: "task_previous",
      scheduleId: schedule.id,
      status: TaskStatus.READY,
      events: [],
    });
    seedRun(schedule, MONDAY_9);

    await release();

    expect(
      taskScheduleTestDb.tasks.filter(
        (task) => task.scheduleId === schedule.id,
      ),
    ).toHaveLength(2);
    expect(taskScheduleTestDb.schedules[0]?.releasedCount).toBe(2);
  });

  it("releases every overdue Run, oldest first", async () => {
    const previousMonday = new Date("2029-12-31T09:00:00.000Z");
    const schedule = seedTaskSchedule({ nextRunAt: previousMonday });
    seedRun(schedule, MONDAY_9);
    seedRun(schedule, previousMonday);

    await release();

    expect(taskScheduleTestDb.tasks).toHaveLength(2);
    expect(
      runsOf(schedule.id)
        .slice(0, 3)
        .map((row) => [row.effectiveScheduledAt, row.state]),
    ).toEqual([
      [previousMonday, TaskScheduleOccurrenceState.RELEASED],
      [MONDAY_9, TaskScheduleOccurrenceState.RELEASED],
      [NEXT_MONDAY_9, TaskScheduleOccurrenceState.PLANNED],
    ]);
    expect(taskScheduleTestDb.schedules[0]?.releasedCount).toBe(2);
  });

  it("keeps planning Runs across the calendar horizon", async () => {
    const schedule = seedTaskSchedule({ nextRunAt: MONDAY_9 });
    seedRun(schedule, MONDAY_9);

    await release();

    const planned = runsOf(schedule.id).filter(
      (row) => row.state === TaskScheduleOccurrenceState.PLANNED,
    );
    // Every Monday from Jan 14 to Apr 1: the 90-day horizon ends Apr 7.
    expect(planned).toHaveLength(12);
    expect(planned[0]?.effectiveScheduledAt).toEqual(NEXT_MONDAY_9);
    expect(planned.at(-1)?.effectiveScheduledAt).toEqual(
      new Date("2030-04-01T09:00:00.000Z"),
    );
  });

  it("writes only the Runs the plan is missing", async () => {
    // Every insert runs the calendar invalidation trigger, even one a
    // conflict skips, so a release must not resend the whole plan.
    const schedule = seedTaskSchedule({ nextRunAt: MONDAY_9 });
    for (
      let at = MONDAY_9;
      at <= new Date("2030-03-25T09:00:00.000Z");
      at = new Date(at.getTime() + 7 * 24 * 60 * 60 * 1000)
    ) {
      seedRun(schedule, at);
    }

    await release();

    expect(
      vi
        .mocked(taskScheduleTestPrisma.taskScheduleOccurrence.createMany)
        .mock.calls.flatMap(([args]) =>
          args.data.map((row) => row.effectiveScheduledAt),
        ),
    ).toEqual([new Date("2030-04-01T09:00:00.000Z")]);
  });

  it("Ends a schedule after its last of N Runs", async () => {
    const schedule = seedTaskSchedule({
      nextRunAt: MONDAY_9,
      endsMode: TaskScheduleEndsMode.AFTER,
      targetRunCount: 2,
      releasedCount: 1,
    });
    seedRun(schedule, MONDAY_9);

    await release();

    expect(taskScheduleTestDb.tasks).toHaveLength(1);
    expect(taskScheduleTestDb.schedules[0]).toMatchObject({
      state: TaskScheduleState.ENDED,
      releasedCount: 2,
      nextRunAt: null,
    });
    expect(runsOf(schedule.id).map((row) => row.state)).toEqual([
      TaskScheduleOccurrenceState.RELEASED,
    ]);
  });

  it("Ends a schedule whose next Run falls after its end date", async () => {
    const schedule = seedTaskSchedule({
      nextRunAt: MONDAY_9,
      endsMode: TaskScheduleEndsMode.ON,
      endsOn: new Date("2030-01-10T00:00:00.000Z"),
    });
    seedRun(schedule, MONDAY_9);

    await release();

    expect(taskScheduleTestDb.tasks).toHaveLength(1);
    expect(taskScheduleTestDb.schedules[0]).toMatchObject({
      state: TaskScheduleState.ENDED,
      nextRunAt: null,
    });
  });

  it.each([TaskScheduleState.PAUSED, TaskScheduleState.ENDED])(
    "never fires a %s schedule",
    async (state) => {
      const schedule = seedTaskSchedule({ state, nextRunAt: MONDAY_9 });
      seedRun(schedule, MONDAY_9);

      await release();

      expect(taskScheduleTestDb.tasks).toHaveLength(0);
      expect(runsOf(schedule.id)[0]?.state).toBe(
        TaskScheduleOccurrenceState.PLANNED,
      );
    },
  );

  it.each([
    ["closing", { closingAt: new Date("2030-01-01T00:00:00.000Z") }],
    ["closed", { closedAt: new Date("2030-01-01T00:00:00.000Z") }],
  ])("skips a schedule whose project is %s", async (_label, closing) => {
    taskScheduleTestDb.projects.set(PROJECT_ID, {
      workspaceId: ORG_WORKSPACE_ID,
      ...closing,
    });
    const schedule = seedTaskSchedule({
      nextRunAt: MONDAY_9,
      projectId: PROJECT_ID,
    });
    seedRun(schedule, MONDAY_9);

    await release();

    expect(taskScheduleTestDb.tasks).toHaveLength(0);
  });

  it("does not create a second Task when the release is retried", async () => {
    const schedule = seedTaskSchedule({ nextRunAt: MONDAY_9 });
    seedRun(schedule, MONDAY_9);

    await release();
    await release();

    expect(taskScheduleTestDb.tasks).toHaveLength(1);
    expect(taskScheduleTestDb.schedules[0]?.releasedCount).toBe(1);
  });

  it("does not create a Task for a Run another release took meanwhile", async () => {
    const schedule = seedTaskSchedule({ nextRunAt: MONDAY_9 });
    const run = seedRun(schedule, MONDAY_9);
    // The other release claims the Run between this release's read and write.
    vi.mocked(taskScheduleTestPrisma.task.create).mockImplementationOnce(
      async () => {
        taskScheduleTestDb.runs = taskScheduleTestDb.runs.map((row) =>
          row.id === run.id
            ? {
                ...row,
                state: TaskScheduleOccurrenceState.RELEASED,
                releasedTaskId: "task_other_run",
              }
            : row,
        );
        taskScheduleTestDb.tasks.push({ id: "task_lost", events: [] });
        return { id: "task_lost", ownerId: OWNER_ID, assigneeUserId: null };
      },
    );

    await release();

    expect(taskScheduleTestDb.tasks).toHaveLength(0);
    expect(taskScheduleTestDb.schedules[0]?.releasedCount).toBe(0);
  });

  it("still releases a Run owed from before a rule edit", async () => {
    const schedule = seedTaskSchedule({ nextRunAt: MONDAY_9 });
    seedRun(schedule, MONDAY_9, { epochId: randomUUID() });

    await release();

    expect(taskScheduleTestDb.tasks).toHaveLength(1);
    expect(taskScheduleTestDb.schedules[0]).toMatchObject({
      releasedCount: 1,
      nextRunAt: NEXT_MONDAY_9,
    });
  });

  it("releases a moved Run at its new time, not the rule's", async () => {
    const TUESDAY_9 = new Date("2030-01-08T09:00:00.000Z");
    const schedule = seedTaskSchedule({ nextRunAt: TUESDAY_9 });
    const moved = seedRun(schedule, MONDAY_9, {
      effectiveScheduledAt: TUESDAY_9,
    });

    await release();
    expect(taskScheduleTestDb.tasks).toHaveLength(0);

    vi.setSystemTime(new Date("2030-01-08T09:30:00.000Z"));
    await release();

    expect(taskScheduleTestDb.tasks).toHaveLength(1);
    expect(
      runsOf(schedule.id).find((row) => row.id === moved.id),
    ).toMatchObject({
      state: TaskScheduleOccurrenceState.RELEASED,
      releasedTaskId: taskScheduleTestDb.tasks[0]?.id,
    });
  });

  it("never releases a skipped Run and moves on to the next one", async () => {
    const schedule = seedTaskSchedule({ nextRunAt: MONDAY_9 });
    const skipped = seedRun(schedule, MONDAY_9, {
      state: TaskScheduleOccurrenceState.SKIPPED,
    });

    await release();

    expect(taskScheduleTestDb.tasks).toHaveLength(0);
    expect(
      runsOf(schedule.id).find((row) => row.id === skipped.id)?.state,
    ).toBe(TaskScheduleOccurrenceState.SKIPPED);
    expect(taskScheduleTestDb.schedules[0]).toMatchObject({
      state: TaskScheduleState.ACTIVE,
      releasedCount: 0,
      nextRunAt: NEXT_MONDAY_9,
    });
  });

  it("Ends a schedule whose last Run was skipped", async () => {
    const schedule = seedTaskSchedule({
      nextRunAt: MONDAY_9,
      endsMode: TaskScheduleEndsMode.ON,
      endsOn: new Date("2030-01-08T00:00:00.000Z"),
    });
    seedRun(schedule, MONDAY_9, {
      state: TaskScheduleOccurrenceState.SKIPPED,
    });

    await release();

    expect(taskScheduleTestDb.tasks).toHaveLength(0);
    expect(taskScheduleTestDb.schedules[0]).toMatchObject({
      state: TaskScheduleState.ENDED,
      nextRunAt: null,
    });
  });

  it("rolls back when the schedule is edited during the release", async () => {
    const schedule = seedTaskSchedule({ nextRunAt: MONDAY_9 });
    seedRun(schedule, MONDAY_9);
    // A blueprint edit commits between this release's read and its write.
    vi.mocked(taskScheduleTestPrisma.task.create).mockImplementationOnce(
      async () => {
        taskScheduleTestDb.schedules = taskScheduleTestDb.schedules.map(
          (row) => ({ ...row, name: "Renamed", revision: row.revision + 1 }),
        );
        taskScheduleTestDb.tasks.push({ id: "task_stale", events: [] });
        return { id: "task_stale", ownerId: OWNER_ID, assigneeUserId: null };
      },
    );

    await release();

    expect(taskScheduleTestDb.tasks).toHaveLength(0);
    expect(runsOf(schedule.id)[0]?.state).toBe(
      TaskScheduleOccurrenceState.PLANNED,
    );
  });

  it("finishes a stopped backlog without passing its end after N", async () => {
    const schedule = seedTaskSchedule({
      nextRunAt: new Date("2029-12-17T09:00:00.000Z"),
      endsMode: TaskScheduleEndsMode.AFTER,
      targetRunCount: 3,
    });
    seedRun(schedule, new Date("2029-12-17T09:00:00.000Z"));
    seedRun(schedule, new Date("2029-12-24T09:00:00.000Z"));
    seedRun(schedule, new Date("2029-12-31T09:00:00.000Z"));

    // The first run runs out of budget after one Task.
    await taskScheduleReleaseService.releaseDueSchedules({
      abortSignal: new AbortController().signal,
      deadlineMs: Number.POSITIVE_INFINITY,
      shouldContinue: () => taskScheduleTestDb.tasks.length < 1,
    });
    expect(
      runsOf(schedule.id).filter(
        (row) => row.state === TaskScheduleOccurrenceState.PLANNED,
      ),
    ).toHaveLength(2);

    await release();

    expect(taskScheduleTestDb.tasks).toHaveLength(3);
    expect(taskScheduleTestDb.schedules[0]).toMatchObject({
      state: TaskScheduleState.ENDED,
      releasedCount: 3,
    });
  });

  it("releases a long backlog over several transactions in one run", async () => {
    const schedule = seedTaskSchedule({
      nextRunAt: new Date("2030-01-07T07:00:00.000Z"),
    });
    for (let minute = 0; minute < 60; minute += 1) {
      seedRun(schedule, new Date(Date.UTC(2030, 0, 7, 7, minute)));
    }

    await release();

    expect(taskScheduleTestDb.tasks).toHaveLength(60);
    expect(taskScheduleTestPrisma.$transaction).toHaveBeenCalledTimes(2);
    expect(taskScheduleTestDb.schedules[0]).toMatchObject({
      releasedCount: 60,
      nextRunAt: NEXT_MONDAY_9,
    });
  });

  it("keeps releasing other schedules when one fails", async () => {
    const broken = seedTaskSchedule({ nextRunAt: MONDAY_9 });
    const healthy = seedTaskSchedule({ nextRunAt: MONDAY_9 });
    seedRun(broken, MONDAY_9);
    seedRun(healthy, MONDAY_9);
    const create = taskScheduleTestPrisma.task.create.getMockImplementation();
    vi.mocked(taskScheduleTestPrisma.task.create).mockImplementation(
      async (args) => {
        if (args.data.scheduleId === broken.id) {
          throw new Error("foreign key violation");
        }
        return create?.(args) as ReturnType<NonNullable<typeof create>>;
      },
    );

    const result = await release();

    expect(result).toMatchObject({ released: 1, failed: 1 });
    expect(taskScheduleTestDb.tasks.map((task) => task.scheduleId)).toEqual([
      healthy.id,
    ]);
  });

  it("releases a schedule behind a full page of failures", async () => {
    const healthy = seedTaskSchedule({
      createdAt: new Date("2020-01-01T00:00:00.000Z"),
      nextRunAt: MONDAY_9,
    });
    seedRun(healthy, MONDAY_9);
    const brokenIds = new Set<string>();
    for (let index = 0; index < TASK_SCHEDULE_RELEASE_BATCH_SIZE; index += 1) {
      const broken = seedTaskSchedule({
        createdAt: new Date(Date.UTC(2026, 8, 2, 0, 0, index)),
        nextRunAt: MONDAY_9,
      });
      seedRun(broken, MONDAY_9);
      brokenIds.add(broken.id);
    }
    const create = taskScheduleTestPrisma.task.create.getMockImplementation();
    vi.mocked(taskScheduleTestPrisma.task.create).mockImplementation(
      async (args) => {
        if (brokenIds.has(args.data.scheduleId ?? "")) {
          throw new Error("foreign key violation");
        }
        return create?.(args) as ReturnType<NonNullable<typeof create>>;
      },
    );

    const result = await release();

    expect(result).toMatchObject({
      released: 1,
      failed: TASK_SCHEDULE_RELEASE_BATCH_SIZE,
    });
    expect(taskScheduleTestDb.tasks.map((task) => task.scheduleId)).toEqual([
      healthy.id,
    ]);
  });
});

describe("taskScheduleReleaseService.releaseDueRunAts", () => {
  function releaseRunAts() {
    return taskScheduleReleaseService.releaseDueRunAts({
      abortSignal: new AbortController().signal,
      deadlineMs: Number.POSITIVE_INFINITY,
      shouldContinue: () => true,
    });
  }

  beforeEach(() => {
    resetTaskScheduleTestDb();
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(NOW);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("moves a Queued Task to Ready once its Run at has passed", async () => {
    const task = seedTask({ status: TaskStatus.QUEUED, runAt: MONDAY_9 });

    const result = await releaseRunAts();

    expect(result).toMatchObject({ released: 1, failed: 0 });
    expect(taskScheduleTestDb.tasks[0]).toMatchObject({
      id: task.id,
      status: TaskStatus.READY,
      runAt: null,
    });
    expect(taskScheduleTestDb.tasks[0]?.events).toEqual([
      expect.objectContaining({
        taskId: task.id,
        status: TaskStatus.READY,
        userId: OWNER_ID,
      }),
    ]);
    expect(taskScheduleTestDb.runs).toHaveLength(0);
  });

  it("leaves a Task whose Run at is still ahead in Queued", async () => {
    seedTask({ status: TaskStatus.QUEUED, runAt: NEXT_MONDAY_9 });

    await releaseRunAts();

    expect(taskScheduleTestDb.tasks[0]).toMatchObject({
      status: TaskStatus.QUEUED,
      runAt: NEXT_MONDAY_9,
      events: [],
    });
  });

  it("does nothing when the release is retried", async () => {
    seedTask({ status: TaskStatus.QUEUED, runAt: MONDAY_9 });

    await releaseRunAts();
    const retry = await releaseRunAts();

    expect(retry).toMatchObject({ released: 0 });
    expect(taskScheduleTestDb.tasks[0]?.events).toHaveLength(1);
  });

  it("skips archived Tasks and Tasks that left Queued", async () => {
    seedTask({
      status: TaskStatus.QUEUED,
      runAt: MONDAY_9,
      archivedAt: MONDAY_9,
    });
    seedTask({ status: TaskStatus.DRAFT, runAt: MONDAY_9 });

    const result = await releaseRunAts();

    expect(result).toMatchObject({ released: 0 });
    expect(taskScheduleTestDb.tasks.map((task) => task.events)).toEqual([
      [],
      [],
    ]);
  });

  it("does not write a Ready event when the Task changed meanwhile", async () => {
    const task = seedTask({ status: TaskStatus.QUEUED, runAt: MONDAY_9 });
    // Someone moves the Run at between the scan and the claim.
    vi.mocked(taskScheduleTestPrisma.task.findMany).mockImplementationOnce(
      async () => {
        const rows = [{ ...task }];
        seedTaskUpdate(task.id, { runAt: NEXT_MONDAY_9 });
        return rows;
      },
    );

    const result = await releaseRunAts();

    expect(result).toMatchObject({ released: 0 });
    expect(taskScheduleTestDb.tasks[0]).toMatchObject({
      status: TaskStatus.QUEUED,
      runAt: NEXT_MONDAY_9,
      events: [],
    });
  });
});
