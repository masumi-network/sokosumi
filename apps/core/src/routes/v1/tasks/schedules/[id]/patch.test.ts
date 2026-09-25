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

import mountPatchTaskSchedule from "./patch";

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

function patch(
  id: string,
  body: unknown,
  app = createTaskScheduleTestApp(mountPatchTaskSchedule),
) {
  return app.request(
    `http://localhost/schedules/${id}`,
    jsonRequest("PATCH", body),
  );
}

function stored(id: string) {
  return taskScheduleTestDb.schedules.find((schedule) => schedule.id === id);
}

describe("PATCH /tasks/schedules/{id}", () => {
  beforeEach(() => {
    resetTaskScheduleTestDb();
  });

  describe("Runs", () => {
    const RELEASED_AT = new Date("2029-12-31T09:00:00.000Z");

    beforeEach(() => {
      vi.useFakeTimers({ toFake: ["Date"] });
      vi.setSystemTime(new Date("2030-01-01T00:00:00.000Z"));
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    /** A weekly schedule that already created one Task and plans the next. */
    function seedRunningSchedule(
      overrides: Parameters<typeof seedTaskSchedule>[0] = {},
    ) {
      const schedule = seedTaskSchedule({
        releasedCount: 1,
        nextRunAt: new Date("2030-01-07T09:00:00.000Z"),
        ...overrides,
      });
      taskScheduleTestDb.tasks.push({
        id: "task_released",
        scheduleId: schedule.id,
        name: schedule.name,
        events: [],
      });
      const released = seedRun(schedule, RELEASED_AT, {
        state: "RELEASED",
        releasedTaskId: "task_released",
      });
      seedRun(schedule, new Date("2030-01-07T09:00:00.000Z"));
      seedRun(schedule, new Date("2030-01-14T09:00:00.000Z"));
      return { schedule, released };
    }

    it("replans a new rule and leaves released Runs and their Tasks untouched", async () => {
      const { schedule, released } = seedRunningSchedule();
      const tasksBefore = structuredClone(taskScheduleTestDb.tasks);

      const response = await patch(schedule.id, {
        expectedRevision: 0,
        name: "Friday report",
        rule: { expr: "0 7 * * 5", timezone: "UTC", endsMode: "NEVER" },
      });

      expect(response.status).toBe(200);
      const row = stored(schedule.id);
      expect(row?.epochId).not.toBe(schedule.epochId);
      expect(row?.nextRunAt).toEqual(new Date("2030-01-04T07:00:00.000Z"));
      const [first, ...planned] = runsOf(schedule.id);
      expect(first).toEqual(released);
      expect(planned.length).toBeGreaterThan(0);
      for (const run of planned) {
        expect(run).toMatchObject({
          state: "PLANNED",
          epochId: row?.epochId,
        });
        expect(run.effectiveScheduledAt.getUTCDay()).toBe(5);
      }
      expect(planned[0]?.effectiveScheduledAt).toEqual(
        new Date("2030-01-04T07:00:00.000Z"),
      );
      expect(taskScheduleTestDb.tasks).toEqual(tasksBefore);
      expect(taskScheduleTestPrisma.task.update).not.toHaveBeenCalled();
      expect(taskScheduleTestPrisma.task.updateMany).not.toHaveBeenCalled();
    });

    it("cancels the old rule's upcoming skipped and moved Runs and keeps them", async () => {
      const { schedule } = seedRunningSchedule();
      const skipped = seedRun(schedule, new Date("2030-01-21T09:00:00.000Z"), {
        state: "SKIPPED",
        actorUserId: OWNER_ID,
      });
      const moved = seedRun(schedule, new Date("2030-01-28T09:00:00.000Z"), {
        effectiveScheduledAt: new Date("2030-01-29T09:00:00.000Z"),
      });

      await patch(schedule.id, {
        expectedRevision: 0,
        rule: { expr: "0 7 * * 5", timezone: "UTC", endsMode: "NEVER" },
      });

      const rows = runsOf(schedule.id);
      expect(rows.find((row) => row.id === skipped.id)?.state).toBe("CANCELED");
      expect(rows.find((row) => row.id === moved.id)?.state).toBe("CANCELED");
      expect(
        rows.filter(
          (row) => row.state === "PLANNED" && row.epochId === schedule.epochId,
        ),
      ).toEqual([]);
    });

    it("keeps a Run already owed under the old rule", async () => {
      const { schedule } = seedRunningSchedule();
      const owed = seedRun(schedule, new Date("2029-12-31T23:00:00.000Z"));

      await patch(schedule.id, {
        expectedRevision: 0,
        rule: { expr: "0 7 * * 5", timezone: "UTC", endsMode: "NEVER" },
      });

      expect(runsOf(schedule.id)).toContainEqual(owed);
      expect(stored(schedule.id)?.nextRunAt).toEqual(owed.effectiveScheduledAt);
    });

    it("counts an owed Run against a new end after N", async () => {
      const { schedule } = seedRunningSchedule();
      seedRun(schedule, new Date("2029-12-31T23:00:00.000Z"));

      await patch(schedule.id, {
        expectedRevision: 0,
        rule: {
          expr: "0 7 * * 5",
          timezone: "UTC",
          endsMode: "AFTER",
          targetRunCount: 3,
        },
      });

      // 1 released + 1 owed leaves room for one more under the new rule.
      expect(
        runsOf(schedule.id)
          .filter((row) => row.effectiveScheduledAt > new Date())
          .map((row) => row.effectiveScheduledAt),
      ).toEqual([new Date("2030-01-04T07:00:00.000Z")]);
    });

    it("drops a Paused schedule's planned Runs until it resumes", async () => {
      const { schedule, released } = seedRunningSchedule({
        state: "PAUSED",
        nextRunAt: null,
      });

      await patch(schedule.id, {
        expectedRevision: 0,
        rule: { expr: "0 7 * * 5", timezone: "UTC", endsMode: "NEVER" },
      });

      expect(runsOf(schedule.id)).toEqual([released]);
      expect(stored(schedule.id)?.nextRunAt).toBeNull();
    });

    it("moves an owed Run when the rule and project change together", async () => {
      const { schedule } = seedRunningSchedule();
      const owed = seedRun(schedule, new Date("2029-12-31T23:00:00.000Z"));

      await patch(schedule.id, {
        expectedRevision: 0,
        projectId: PROJECT_ID,
        rule: { expr: "0 7 * * 5", timezone: "UTC", endsMode: "NEVER" },
      });

      expect(
        runsOf(schedule.id).find((row) => row.id === owed.id),
      ).toMatchObject({
        state: "PLANNED",
        sourceType: "PROJECT",
        sourceProjectId: PROJECT_ID,
      });
    });

    it("moves the planned Runs to the blueprint's new project", async () => {
      const { schedule, released } = seedRunningSchedule();

      await patch(schedule.id, {
        expectedRevision: 0,
        projectId: PROJECT_ID,
      });

      const [first, ...planned] = runsOf(schedule.id);
      expect(first).toEqual(released);
      expect(planned.map((row) => row.effectiveScheduledAt)).toEqual([
        new Date("2030-01-07T09:00:00.000Z"),
        new Date("2030-01-14T09:00:00.000Z"),
      ]);
      for (const run of planned) {
        expect(run).toMatchObject({
          sourceType: "PROJECT",
          sourceProjectId: PROJECT_ID,
        });
      }
    });

    it("keeps the plan when only the blueprint text changes", async () => {
      const { schedule } = seedRunningSchedule();
      const before = runsOf(schedule.id);

      await patch(schedule.id, { expectedRevision: 0, name: "Renamed" });

      expect(runsOf(schedule.id)).toEqual(before);
    });
  });

  it("changes the blueprint and advances the revision", async () => {
    const schedule = seedTaskSchedule({ revision: 2 });

    const response = await patch(schedule.id, {
      expectedRevision: 2,
      name: "Monthly report",
      description: "Summarise the month",
      projectId: PROJECT_ID,
    });

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      data: {
        name: "Monthly report",
        description: "Summarise the month",
        projectId: PROJECT_ID,
        revision: 3,
      },
    });
  });

  it("replaces the rule from now on, leaving already released counts", async () => {
    const schedule = seedTaskSchedule({ releasedCount: 3 });
    const before = Date.now();

    const response = await patch(schedule.id, {
      expectedRevision: 0,
      rule: { expr: "0 7 * * 5", timezone: "Europe/Berlin", endsMode: "NEVER" },
    });

    expect(response.status).toBe(200);
    const row = stored(schedule.id);
    expect(row).toMatchObject({
      expr: "0 7 * * 5",
      timezone: "Europe/Berlin",
      releasedCount: 3,
    });
    expect(row?.ruleEffectiveFrom.getTime()).toBeGreaterThanOrEqual(before);
    expect(row?.nextRunAt?.getTime()).toBeGreaterThan(before);
    expect(row?.nextRunAt?.getUTCDay()).toBe(5);
  });

  it("keeps a paused schedule without a next Run", async () => {
    const schedule = seedTaskSchedule({
      state: "PAUSED",
      nextRunAt: null,
    });

    await patch(schedule.id, {
      expectedRevision: 0,
      rule: { expr: "0 7 * * 5", timezone: "UTC", endsMode: "NEVER" },
    });

    expect(stored(schedule.id)?.nextRunAt).toBeNull();
  });

  it("rejects a member assignee without changing the schedule", async () => {
    const schedule = seedTaskSchedule({ assigneeId: COWORKER_ID });

    const response = await patch(schedule.id, {
      expectedRevision: 0,
      assigneeUserId: MEMBER_ID,
    });

    expect(response.status).toBe(400);
    expect(stored(schedule.id)).toMatchObject({
      assigneeId: COWORKER_ID,
      assigneeUserId: null,
    });
  });

  it("allows a legacy member schedule to clear its assignee", async () => {
    const schedule = seedTaskSchedule({ assigneeUserId: MEMBER_ID });

    const response = await patch(schedule.id, {
      expectedRevision: 0,
      assigneeUserId: null,
    });

    expect(response.status).toBe(200);
    expect(stored(schedule.id)?.assigneeUserId).toBeNull();
  });

  it("rejects a stale revision without writing", async () => {
    const schedule = seedTaskSchedule({ revision: 4 });

    const response = await patch(schedule.id, {
      expectedRevision: 3,
      name: "Monthly report",
    });

    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({
      kind: "schedule_revision_conflict",
    });
    expect(stored(schedule.id)).toMatchObject({
      name: "Weekly report",
      revision: 4,
    });
  });

  it.each(["timezone", "endsMode"])(
    "requires %s in a replacement rule instead of resetting it",
    async (field) => {
      const schedule = seedTaskSchedule({ timezone: "Europe/Berlin" });
      const rule: Record<string, unknown> = {
        expr: "0 7 * * 5",
        timezone: "Europe/Berlin",
        endsMode: "NEVER",
      };
      delete rule[field];

      const response = await patch(schedule.id, {
        expectedRevision: 0,
        rule,
      });

      expect(response.status).toBe(422);
      expect(stored(schedule.id)?.timezone).toBe("Europe/Berlin");
    },
  );

  it("rejects an invalid rule", async () => {
    const schedule = seedTaskSchedule();

    const response = await patch(schedule.id, {
      expectedRevision: 0,
      rule: { expr: "0 9 * * 1", timezone: "Mars/Olympus", endsMode: "NEVER" },
    });

    expect(response.status).toBe(400);
  });

  it("rejects a Run count already reached", async () => {
    const schedule = seedTaskSchedule({ releasedCount: 5 });

    const response = await patch(schedule.id, {
      expectedRevision: 0,
      rule: {
        expr: "0 9 * * 1",
        timezone: "UTC",
        endsMode: "AFTER",
        targetRunCount: 5,
      },
    });

    expect(response.status).toBe(422);
  });

  it("rejects a project outside the workspace", async () => {
    const schedule = seedTaskSchedule();

    const response = await patch(schedule.id, {
      expectedRevision: 0,
      projectId: "01960001-0001-7001-8001-0000000000bb",
    });

    expect(response.status).toBe(404);
  });

  it("refuses a project that is closed", async () => {
    const schedule = seedTaskSchedule();
    taskScheduleTestDb.projects.set(PROJECT_ID, {
      workspaceId: schedule.workspaceId,
      closedAt: new Date("2026-09-01T00:00:00.000Z"),
    });

    const response = await patch(schedule.id, {
      expectedRevision: 0,
      projectId: PROJECT_ID,
    });

    expect(response.status).toBe(409);
    expect(stored(schedule.id)?.projectId).toBeNull();
  });

  it("refuses edits to a schedule in a closing project", async () => {
    const schedule = seedTaskSchedule({ projectId: PROJECT_ID });
    taskScheduleTestDb.projects.set(PROJECT_ID, {
      workspaceId: schedule.workspaceId,
      closingAt: new Date("2026-09-01T00:00:00.000Z"),
    });

    const response = await patch(schedule.id, {
      expectedRevision: 0,
      projectId: null,
    });

    expect(response.status).toBe(409);
    expect(stored(schedule.id)?.projectId).toBe(PROJECT_ID);
  });

  it("refuses edits to an Ended schedule", async () => {
    const schedule = seedTaskSchedule({ state: "ENDED" });

    const response = await patch(schedule.id, {
      expectedRevision: 0,
      name: "Monthly report",
    });

    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({
      kind: "schedule_state_conflict",
    });
  });

  it("lets only the owner edit a workspace-visible schedule", async () => {
    const schedule = seedTaskSchedule();

    const response = await patch(
      schedule.id,
      { expectedRevision: 0, name: "Mine now" },
      createTaskScheduleTestApp(mountPatchTaskSchedule, userAuth(MEMBER_ID)),
    );

    expect(response.status).toBe(403);
    expect(stored(schedule.id)?.name).toBe("Weekly report");
  });

  it("hides another member's private schedule", async () => {
    const schedule = seedTaskSchedule({ visibility: "PRIVATE" });

    const response = await patch(
      schedule.id,
      { expectedRevision: 0, name: "Mine now" },
      createTaskScheduleTestApp(mountPatchTaskSchedule, userAuth(MEMBER_ID)),
    );

    expect(response.status).toBe(404);
  });

  describe("Coworker", () => {
    function coworkerPatch(id: string, body: unknown) {
      return patch(
        id,
        body,
        createTaskScheduleTestApp(mountPatchTaskSchedule, COWORKER_AUTH),
      );
    }

    it("edits a schedule it created", async () => {
      const schedule = seedTaskSchedule({
        creatorUserId: null,
        creatorCoworkerId: COWORKER_ID,
      });

      const response = await coworkerPatch(schedule.id, {
        expectedRevision: 0,
        name: "Renamed by vendor",
      });

      expect(response.status).toBe(200);
    });

    it("does not edit another member's schedule it is assigned to", async () => {
      const schedule = seedTaskSchedule({
        ownerId: MEMBER_ID,
        creatorUserId: MEMBER_ID,
        assigneeId: COWORKER_ID,
      });

      const response = await coworkerPatch(schedule.id, {
        expectedRevision: 0,
        name: "Renamed by vendor",
      });

      expect(response.status).toBe(403);
    });

    it("does not edit a schedule outside its vendor family", async () => {
      const schedule = seedTaskSchedule();

      const response = await coworkerPatch(schedule.id, {
        expectedRevision: 0,
        name: "Renamed by vendor",
      });

      expect(response.status).toBe(403);
    });
  });
});
