import type { TaskSchedule } from "@sokosumi/database";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  COWORKER_AUTH,
  COWORKER_ID,
  MEMBER_ID,
  OWNER_ID,
  PROJECT_ID,
  resetTaskScheduleTestDb,
  runsOf,
  seedRun,
  seedTaskSchedule,
  taskScheduleTestDb,
  taskScheduleTestPrisma,
  userAuth,
} from "@/test-fixtures/task-schedule";
import {
  createTaskScheduleTestApp,
  jsonRequest,
} from "@/test-fixtures/task-schedule-app";

import mount from "./post";

vi.mock("@/middleware/auth", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/middleware/auth")>()),
  authMiddleware: (await import("@/test-fixtures/auth-middleware"))
    .stubAuthMiddleware,
}));
vi.mock("@/lib/db/prisma", async () => ({
  default: (await import("@/test-fixtures/task-schedule"))
    .taskScheduleTestPrisma,
}));
vi.mock("@sokosumi/database/helpers", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@sokosumi/database/helpers")>()),
  hasAssignedOrganizationSeat: async () =>
    (await import("@/test-fixtures/task-schedule")).taskScheduleTestDb
      .seatAssigned,
}));
vi.mock("@/helpers/vendor-grants", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/helpers/vendor-grants")>()),
  requestWorkspaceGrantCommitted: (
    await import("@/test-fixtures/task-schedule")
  ).requestPendingWorkspaceGrant,
}));
vi.mock("@/lib/ably/publish", () => ({ publishTaskEventData: vi.fn() }));
vi.mock("@/helpers/task-notifications", () => ({
  notifyTaskHumanAssignee: vi.fn(),
}));

const NOW = new Date("2030-01-01T08:00:00.000Z");
const JAN_7 = new Date("2030-01-07T09:00:00.000Z");

function send(
  schedule: Pick<TaskSchedule, "id">,
  body: Record<string, unknown> = { expectedRevision: 0 },
  app = createTaskScheduleTestApp(mount),
) {
  return app.request(
    `http://localhost/schedules/${schedule.id}/runs`,
    jsonRequest("POST", body),
  );
}

function storedSchedule(id: string) {
  return taskScheduleTestDb.schedules.find((schedule) => schedule.id === id);
}

describe("POST /tasks/schedules/{id}/runs", () => {
  beforeEach(() => {
    resetTaskScheduleTestDb();
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(NOW);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("runs an Active schedule now and leaves the rule's Runs alone", async () => {
    const schedule = seedTaskSchedule({ nextRunAt: JAN_7 });
    const planned = seedRun(schedule, JAN_7);

    const response = await send(schedule);

    expect(response.status).toBe(201);
    const task = taskScheduleTestDb.tasks.at(-1);
    expect(task).toMatchObject({
      scheduleId: schedule.id,
      name: schedule.name,
      creatorUserId: schedule.creatorUserId,
      status: "READY",
    });
    expect(await response.json()).toMatchObject({
      data: {
        revision: 1,
        run: {
          state: "RELEASED",
          manual: true,
          originalScheduledAt: NOW.toISOString(),
          effectiveScheduledAt: NOW.toISOString(),
          releasedTaskId: task?.id,
          actorUserId: OWNER_ID,
          actorCoworkerId: null,
        },
      },
    });
    expect(storedSchedule(schedule.id)).toMatchObject({
      revision: 1,
      releasedCount: 0,
      nextRunAt: JAN_7,
    });
    expect(
      runsOf(schedule.id).find((row) => row.id === planned.id),
    ).toMatchObject({ state: "PLANNED", effectiveScheduledAt: JAN_7 });
  });

  it("runs a Paused schedule now and keeps it Paused", async () => {
    const schedule = seedTaskSchedule({ state: "PAUSED", nextRunAt: null });

    const response = await send(schedule);

    expect(response.status).toBe(201);
    expect(taskScheduleTestDb.tasks).toHaveLength(1);
    expect(storedSchedule(schedule.id)).toMatchObject({
      state: "PAUSED",
      nextRunAt: null,
      revision: 1,
    });
  });

  it("does not count toward an end-after-N rule", async () => {
    const schedule = seedTaskSchedule({
      endsMode: "AFTER",
      targetRunCount: 1,
      nextRunAt: JAN_7,
    });
    const planned = seedRun(schedule, JAN_7);

    const response = await send(schedule);

    expect(response.status).toBe(201);
    expect(storedSchedule(schedule.id)).toMatchObject({
      state: "ACTIVE",
      releasedCount: 0,
      nextRunAt: JAN_7,
    });
    expect(
      runsOf(schedule.id).find((row) => row.id === planned.id)?.state,
    ).toBe("PLANNED");
  });

  it("refuses an Ended schedule", async () => {
    const schedule = seedTaskSchedule({ state: "ENDED", nextRunAt: null });

    const response = await send(schedule);

    expect(response.status).toBe(409);
    expect(taskScheduleTestDb.tasks).toHaveLength(0);
    expect(runsOf(schedule.id)).toEqual([]);
  });

  it("creates one Task when the same revision is sent twice", async () => {
    const schedule = seedTaskSchedule();
    const app = createTaskScheduleTestApp(mount);

    const first = await send(schedule, { expectedRevision: 0 }, app);
    const second = await send(schedule, { expectedRevision: 0 }, app);

    expect(first.status).toBe(201);
    expect(second.status).toBe(409);
    expect(taskScheduleTestDb.tasks).toHaveLength(1);
    expect(storedSchedule(schedule.id)?.revision).toBe(1);
  });

  it("answers a revision conflict when the schedule changes mid-request", async () => {
    const schedule = seedTaskSchedule();
    vi.mocked(
      taskScheduleTestPrisma.taskSchedule.updateMany,
    ).mockResolvedValueOnce({ count: 0 });

    const response = await send(schedule);

    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({
      kind: "schedule_revision_conflict",
    });
    expect(taskScheduleTestDb.tasks).toHaveLength(0);
  });

  it("answers a conflict when the Run's time is already taken", async () => {
    const schedule = seedTaskSchedule();
    vi.mocked(
      taskScheduleTestPrisma.taskScheduleRun.create,
    ).mockRejectedValueOnce(
      Object.assign(new Error("Unique constraint failed"), { code: "P2002" }),
    );

    const response = await send(schedule);

    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({
      kind: "concurrency_conflict",
    });
  });

  it("refuses while the schedule's project is closing", async () => {
    const schedule = seedTaskSchedule({ projectId: PROJECT_ID });
    taskScheduleTestDb.projects.set(PROJECT_ID, {
      workspaceId: schedule.workspaceId,
      closingAt: new Date("2029-12-31T00:00:00.000Z"),
    });

    const response = await send(schedule);

    expect(response.status).toBe(409);
    expect(taskScheduleTestDb.tasks).toHaveLength(0);
  });

  it("lets only the owner run a workspace-visible schedule", async () => {
    const schedule = seedTaskSchedule();

    const response = await send(
      schedule,
      { expectedRevision: 0 },
      createTaskScheduleTestApp(mount, userAuth(MEMBER_ID)),
    );

    expect(response.status).toBe(403);
    expect(taskScheduleTestDb.tasks).toHaveLength(0);
  });

  it("lets a granted Coworker run a schedule it created and records it", async () => {
    const schedule = seedTaskSchedule({
      creatorUserId: null,
      creatorCoworkerId: COWORKER_ID,
    });

    const response = await send(
      schedule,
      { expectedRevision: 0 },
      createTaskScheduleTestApp(mount, COWORKER_AUTH),
    );

    expect(response.status).toBe(201);
    expect(await response.json()).toMatchObject({
      data: {
        run: {
          manual: true,
          actorUserId: null,
          actorCoworkerId: COWORKER_ID,
        },
      },
    });
    expect(taskScheduleTestDb.tasks.at(-1)).toMatchObject({
      creatorUserId: null,
      creatorCoworkerId: COWORKER_ID,
    });
  });
});
