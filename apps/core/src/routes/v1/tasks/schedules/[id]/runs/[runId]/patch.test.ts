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
  SOKO_BOT_AUTH,
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

import mount from "./patch";

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

const NOW = new Date("2030-01-01T08:00:00.000Z");
const JAN_7 = new Date("2030-01-07T09:00:00.000Z");
const JAN_8 = new Date("2030-01-08T00:00:00.000Z");
const JAN_14 = new Date("2030-01-14T09:00:00.000Z");
const JAN_2 = new Date("2030-01-02T09:00:00.000Z");
const JAN_15 = new Date("2030-01-15T09:00:00.000Z");
const DEC_30 = new Date("2029-12-30T09:00:00.000Z");
/** The projection horizon is 90 days after NOW. */
const BEYOND_HORIZON = new Date("2030-04-08T09:00:00.000Z");

function send(
  schedule: Pick<TaskSchedule, "id">,
  runId: string,
  body: Record<string, unknown>,
  app = createTaskScheduleTestApp(mount),
) {
  return app.request(
    `http://localhost/schedules/${schedule.id}/runs/${runId}`,
    jsonRequest("PATCH", { expectedRevision: 0, ...body }),
  );
}

function storedSchedule(id: string) {
  return taskScheduleTestDb.schedules.find((schedule) => schedule.id === id);
}

describe("PATCH /tasks/schedules/{id}/runs/{runId}", () => {
  beforeEach(() => {
    resetTaskScheduleTestDb();
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(NOW);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("refuses a Run change while the schedule's project is closing", async () => {
    const schedule = seedTaskSchedule({
      projectId: PROJECT_ID,
      nextRunAt: JAN_7,
    });
    taskScheduleTestDb.projects.set(PROJECT_ID, {
      workspaceId: schedule.workspaceId,
      closingAt: new Date("2026-09-01T00:00:00.000Z"),
    });
    const run = seedRun(schedule, JAN_7);

    const response = await send(schedule, run.id, { action: "skip" });

    expect(response.status).toBe(409);
    expect(runsOf(schedule.id).find((row) => row.id === run.id)?.state).toBe(
      "PLANNED",
    );
    expect(storedSchedule(schedule.id)?.revision).toBe(0);
  });

  it("skips a planned Run and wakes the schedule at the next one", async () => {
    const schedule = seedTaskSchedule({ nextRunAt: JAN_7 });
    const run = seedRun(schedule, JAN_7);
    seedRun(schedule, JAN_14);

    const response = await send(schedule, run.id, { action: "skip" });

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      data: {
        revision: 1,
        run: {
          id: run.id,
          state: "SKIPPED",
          effectiveScheduledAt: JAN_7.toISOString(),
          actorUserId: OWNER_ID,
          actorCoworkerId: null,
        },
      },
    });
    expect(storedSchedule(schedule.id)).toMatchObject({
      revision: 1,
      nextRunAt: JAN_14,
    });
    expect(runsOf(schedule.id).find((row) => row.id === run.id)?.state).toBe(
      "SKIPPED",
    );
  });

  it("moves a planned Run and keeps the rule's time", async () => {
    const schedule = seedTaskSchedule({ nextRunAt: JAN_7 });
    const run = seedRun(schedule, JAN_7);
    seedRun(schedule, JAN_14);

    const response = await send(schedule, run.id, {
      action: "move",
      scheduledAt: JAN_15.toISOString(),
    });

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      data: {
        revision: 1,
        run: {
          state: "PLANNED",
          originalScheduledAt: JAN_7.toISOString(),
          effectiveScheduledAt: JAN_15.toISOString(),
        },
      },
    });
    expect(storedSchedule(schedule.id)?.nextRunAt).toEqual(JAN_14);
  });

  it("wakes the schedule at a Run moved earlier", async () => {
    const schedule = seedTaskSchedule({ nextRunAt: JAN_7 });
    const run = seedRun(schedule, JAN_7);

    await send(schedule, run.id, {
      action: "move",
      scheduledAt: JAN_2.toISOString(),
    });

    expect(storedSchedule(schedule.id)?.nextRunAt).toEqual(JAN_2);
  });

  it("restores a skipped Run at the rule's time", async () => {
    const schedule = seedTaskSchedule({ nextRunAt: JAN_14 });
    const run = seedRun(schedule, JAN_7, { state: "SKIPPED" });
    seedRun(schedule, JAN_14);

    const response = await send(schedule, run.id, {
      action: "restore",
    });

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      data: {
        run: {
          state: "PLANNED",
          effectiveScheduledAt: JAN_7.toISOString(),
        },
      },
    });
    expect(storedSchedule(schedule.id)?.nextRunAt).toEqual(JAN_7);
  });

  it("restores a moved Run to the rule's time", async () => {
    const schedule = seedTaskSchedule({ nextRunAt: JAN_7 });
    const run = seedRun(schedule, JAN_7, {
      effectiveScheduledAt: JAN_15,
    });
    seedRun(schedule, JAN_14);

    const response = await send(schedule, run.id, {
      action: "restore",
    });

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      data: {
        run: {
          state: "PLANNED",
          effectiveScheduledAt: JAN_7.toISOString(),
        },
      },
    });
    expect(storedSchedule(schedule.id)?.nextRunAt).toEqual(JAN_7);
  });

  describe("access", () => {
    function seedPlanned(overrides: Partial<TaskSchedule> = {}) {
      const schedule = seedTaskSchedule({
        nextRunAt: JAN_7,
        ...overrides,
      });
      return { schedule, run: seedRun(schedule, JAN_7) };
    }

    it("hides a private schedule from other members", async () => {
      const { schedule, run } = seedPlanned({ visibility: "PRIVATE" });

      const response = await send(
        schedule,
        run.id,
        { action: "skip" },
        createTaskScheduleTestApp(mount, userAuth(MEMBER_ID)),
      );

      expect(response.status).toBe(404);
      expect(runsOf(schedule.id)).toEqual([run]);
    });

    it("lets only the owner change a workspace-visible schedule", async () => {
      const { schedule, run } = seedPlanned();

      const response = await send(
        schedule,
        run.id,
        { action: "skip" },
        createTaskScheduleTestApp(mount, userAuth(MEMBER_ID)),
      );

      expect(response.status).toBe(403);
      expect(runsOf(schedule.id)).toEqual([run]);
    });

    it("refuses an unseated member of a paid organization", async () => {
      const { schedule, run } = seedPlanned();
      taskScheduleTestDb.seatAssigned = false;

      const response = await send(schedule, run.id, { action: "skip" });

      expect(response.status).toBe(403);
      expect(runsOf(schedule.id)).toEqual([run]);
    });

    it("lets a granted Coworker change a schedule it created and records it", async () => {
      const { schedule, run } = seedPlanned({
        creatorUserId: null,
        creatorCoworkerId: COWORKER_ID,
      });

      const response = await send(
        schedule,
        run.id,
        { action: "skip" },
        createTaskScheduleTestApp(mount, COWORKER_AUTH),
      );

      expect(response.status).toBe(200);
      expect(await response.json()).toMatchObject({
        data: {
          run: {
            state: "SKIPPED",
            actorUserId: null,
            actorCoworkerId: COWORKER_ID,
          },
        },
      });
    });

    it("refuses a Coworker without a workspace grant", async () => {
      const { schedule, run } = seedPlanned({
        creatorUserId: null,
        creatorCoworkerId: COWORKER_ID,
      });
      taskScheduleTestDb.vendorGrantStatus = null;

      const response = await send(
        schedule,
        run.id,
        { action: "skip" },
        createTaskScheduleTestApp(mount, COWORKER_AUTH),
      );

      expect(response.status).toBe(403);
      expect(await response.json()).toMatchObject({ kind: "grant_required" });
      expect(runsOf(schedule.id)).toEqual([run]);
    });

    it("refuses a Coworker on a schedule outside its vendor family", async () => {
      const { schedule, run } = seedPlanned();

      const response = await send(
        schedule,
        run.id,
        { action: "skip" },
        createTaskScheduleTestApp(mount, COWORKER_AUTH),
      );

      expect(response.status).toBe(403);
      expect(runsOf(schedule.id)).toEqual([run]);
    });

    it("refuses Soko Bot actors", async () => {
      const { schedule, run } = seedPlanned();

      const response = await send(
        schedule,
        run.id,
        { action: "skip" },
        createTaskScheduleTestApp(mount, SOKO_BOT_AUTH),
      );

      expect(response.status).toBe(403);
    });
  });

  describe("with an end rule", () => {
    const JAN_21 = new Date("2030-01-21T09:00:00.000Z");
    const JAN_28 = new Date("2030-01-28T09:00:00.000Z");

    function plannedTimes(scheduleId: string) {
      return runsOf(scheduleId)
        .filter((row) => row.state === "PLANNED")
        .map((row) => row.effectiveScheduledAt);
    }

    function seedAfterThree() {
      const schedule = seedTaskSchedule({
        nextRunAt: JAN_7,
        endsMode: "AFTER",
        targetRunCount: 3,
      });
      seedRun(schedule, JAN_7);
      seedRun(schedule, JAN_14);
      const last = seedRun(schedule, JAN_21);
      return { schedule, last };
    }

    it("plans one more Run when one of N is skipped", async () => {
      const { schedule, last } = seedAfterThree();

      await send(schedule, last.id, { action: "skip" });

      expect(plannedTimes(schedule.id)).toEqual([JAN_7, JAN_14, JAN_28]);
    });

    it("drops that extra Run again on restore", async () => {
      const { schedule, last } = seedAfterThree();
      await send(schedule, last.id, { action: "skip" });

      const response = await send(schedule, last.id, {
        action: "restore",
        expectedRevision: 1,
      });

      expect(response.status).toBe(200);
      expect(plannedTimes(schedule.id)).toEqual([JAN_7, JAN_14, JAN_21]);
    });

    it("keeps a schedule whose last Run is skipped due at that time", async () => {
      const schedule = seedTaskSchedule({
        nextRunAt: JAN_7,
        endsMode: "ON",
        endsOn: JAN_8,
      });
      const last = seedRun(schedule, JAN_7);

      await send(schedule, last.id, { action: "skip" });

      expect(storedSchedule(schedule.id)).toMatchObject({
        state: "ACTIVE",
        nextRunAt: JAN_7,
      });
    });
  });

  describe("refuses", () => {
    function expectUnchanged(schedule: TaskSchedule) {
      expect(storedSchedule(schedule.id)).toMatchObject({
        revision: schedule.revision,
        nextRunAt: schedule.nextRunAt,
      });
    }

    it.each([
      ["skip", {}],
      ["move", { scheduledAt: JAN_15.toISOString() }],
    ])("to %s a Run that already created its Task", async (action, extra) => {
      const schedule = seedTaskSchedule({
        nextRunAt: JAN_14,
        releasedCount: 1,
      });
      const run = seedRun(schedule, JAN_7, {
        state: "RELEASED",
        releasedTaskId: "task_released",
      });

      const response = await send(schedule, run.id, {
        action,
        ...extra,
      });

      expect(response.status).toBe(409);
      expect(await response.json()).toMatchObject({
        kind: "schedule_run_state_conflict",
      });
      expect(runsOf(schedule.id)).toEqual([run]);
      expectUnchanged(schedule);
    });

    it("to skip a Run whose time has passed", async () => {
      const schedule = seedTaskSchedule({ nextRunAt: DEC_30 });
      const run = seedRun(schedule, DEC_30);

      const response = await send(schedule, run.id, { action: "skip" });

      expect(response.status).toBe(409);
      expect(await response.json()).toMatchObject({
        kind: "schedule_run_state_conflict",
      });
      expect(runsOf(schedule.id)).toEqual([run]);
    });

    it("to skip a Run that is already skipped", async () => {
      const schedule = seedTaskSchedule({ nextRunAt: JAN_14 });
      const run = seedRun(schedule, JAN_7, { state: "SKIPPED" });

      const response = await send(schedule, run.id, { action: "skip" });

      expect(response.status).toBe(409);
      expect(await response.json()).toMatchObject({
        kind: "schedule_run_state_conflict",
      });
    });

    it("to restore a Run that was neither skipped nor moved", async () => {
      const schedule = seedTaskSchedule({ nextRunAt: JAN_7 });
      const run = seedRun(schedule, JAN_7);

      const response = await send(schedule, run.id, {
        action: "restore",
      });

      expect(response.status).toBe(409);
      expect(await response.json()).toMatchObject({
        kind: "schedule_run_state_conflict",
      });
      expectUnchanged(schedule);
    });

    it("to restore a moved Run a rule edit canceled", async () => {
      const schedule = seedTaskSchedule({ nextRunAt: JAN_14 });
      const run = seedRun(schedule, JAN_7, {
        state: "CANCELED",
        effectiveScheduledAt: JAN_15,
      });

      const response = await send(schedule, run.id, {
        action: "restore",
      });

      expect(response.status).toBe(409);
      expect(await response.json()).toMatchObject({
        kind: "schedule_run_state_conflict",
      });
      expect(runsOf(schedule.id)).toEqual([run]);
    });

    it("to move a Run into the past", async () => {
      const schedule = seedTaskSchedule({ nextRunAt: JAN_7 });
      const run = seedRun(schedule, JAN_7);

      const response = await send(schedule, run.id, {
        action: "move",
        scheduledAt: DEC_30.toISOString(),
      });

      expect(response.status).toBe(422);
      expect(await response.json()).toMatchObject({
        kind: "schedule_run_target_invalid",
      });
      expect(runsOf(schedule.id)).toEqual([run]);
    });

    it("to move a Run past the projection horizon", async () => {
      const schedule = seedTaskSchedule({ nextRunAt: JAN_7 });
      const run = seedRun(schedule, JAN_7);

      const response = await send(schedule, run.id, {
        action: "move",
        scheduledAt: BEYOND_HORIZON.toISOString(),
      });

      expect(response.status).toBe(422);
      expect(await response.json()).toMatchObject({
        kind: "schedule_run_target_invalid",
      });
      expect(runsOf(schedule.id)).toEqual([run]);
    });

    it("to skip a Run past the projection horizon", async () => {
      const schedule = seedTaskSchedule({ nextRunAt: BEYOND_HORIZON });
      const run = seedRun(schedule, BEYOND_HORIZON);

      const response = await send(schedule, run.id, { action: "skip" });

      expect(response.status).toBe(422);
      expect(await response.json()).toMatchObject({
        kind: "schedule_run_target_invalid",
      });
    });

    it("to restore a moved Run whose rule time has passed", async () => {
      const schedule = seedTaskSchedule({ nextRunAt: JAN_7 });
      const run = seedRun(schedule, DEC_30, {
        effectiveScheduledAt: JAN_7,
      });

      const response = await send(schedule, run.id, {
        action: "restore",
      });

      expect(response.status).toBe(422);
      expect(await response.json()).toMatchObject({
        kind: "schedule_run_target_invalid",
      });
      expect(runsOf(schedule.id)).toEqual([run]);
    });

    it("a stale revision", async () => {
      const schedule = seedTaskSchedule({
        nextRunAt: JAN_7,
        revision: 2,
      });
      const run = seedRun(schedule, JAN_7);

      const response = await send(schedule, run.id, {
        action: "skip",
        expectedRevision: 1,
      });

      expect(response.status).toBe(409);
      expect(await response.json()).toMatchObject({
        kind: "schedule_revision_conflict",
      });
      expect(runsOf(schedule.id)).toEqual([run]);
      expectUnchanged(schedule);
    });

    it.each(["PAUSED", "ENDED"] as const)(
      "a Run of a %s schedule",
      async (state) => {
        const schedule = seedTaskSchedule({ state, nextRunAt: null });
        const run = seedRun(schedule, JAN_7, {
          state: "SKIPPED",
        });

        const response = await send(schedule, run.id, {
          action: "restore",
        });

        expect(response.status).toBe(409);
        expect(await response.json()).toMatchObject({
          kind: "schedule_state_conflict",
        });
        expect(runsOf(schedule.id)).toEqual([run]);
      },
    );

    it("a change racing a release of the same schedule", async () => {
      const schedule = seedTaskSchedule({ nextRunAt: JAN_7 });
      const run = seedRun(schedule, JAN_14);
      // A release commits between this request's read and its write.
      vi.mocked(
        taskScheduleTestPrisma.taskScheduleRun.findFirst,
      ).mockImplementationOnce(async () => {
        taskScheduleTestDb.schedules = taskScheduleTestDb.schedules.map(
          (row) => ({ ...row, releasedCount: row.releasedCount + 1 }),
        );
        return run;
      });

      const response = await send(schedule, run.id, { action: "skip" });

      expect(response.status).toBe(409);
      expect(runsOf(schedule.id)).toEqual([run]);
    });

    it("a Run a release took between the read and the write", async () => {
      const schedule = seedTaskSchedule({ nextRunAt: JAN_7 });
      const run = seedRun(schedule, JAN_14);
      vi.mocked(
        taskScheduleTestPrisma.taskScheduleRun.findFirst,
      ).mockImplementationOnce(async () => {
        taskScheduleTestDb.runs = taskScheduleTestDb.runs.map((row) =>
          row.id === run.id
            ? { ...row, state: "RELEASED", releasedTaskId: "task_released" }
            : row,
        );
        return run;
      });

      const response = await send(schedule, run.id, { action: "skip" });

      expect(response.status).toBe(409);
      expect(await response.json()).toMatchObject({
        kind: "schedule_run_state_conflict",
      });
      expect(storedSchedule(schedule.id)?.revision).toBe(0);
    });

    it("a Run of another schedule", async () => {
      const schedule = seedTaskSchedule({ nextRunAt: JAN_7 });
      const other = seedTaskSchedule();
      const run = seedRun(other, JAN_7);

      const response = await send(schedule, run.id, { action: "skip" });

      expect(response.status).toBe(404);
      expect(runsOf(other.id)).toEqual([run]);
    });
  });
});
