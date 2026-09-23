import type { TaskSchedule } from "@sokosumi/database";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  COWORKER_AUTH,
  COWORKER_ID,
  MEMBER_ID,
  OWNER_ID,
  occurrencesOf,
  resetTaskScheduleTestDb,
  SOKO_BOT_AUTH,
  seedOccurrence,
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
  occurrenceId: string,
  body: Record<string, unknown>,
  app = createTaskScheduleTestApp(mount),
) {
  return app.request(
    `http://localhost/schedules/${schedule.id}/occurrences/${occurrenceId}`,
    jsonRequest("PATCH", { expectedRevision: 0, ...body }),
  );
}

function storedSchedule(id: string) {
  return taskScheduleTestDb.schedules.find((schedule) => schedule.id === id);
}

describe("PATCH /tasks/schedules/{id}/occurrences/{occurrenceId}", () => {
  beforeEach(() => {
    resetTaskScheduleTestDb();
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(NOW);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("skips a planned Occurrence and wakes the schedule at the next one", async () => {
    const schedule = seedTaskSchedule({ nextOccurrenceAt: JAN_7 });
    const occurrence = seedOccurrence(schedule, JAN_7);
    seedOccurrence(schedule, JAN_14);

    const response = await send(schedule, occurrence.id, { action: "skip" });

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      data: {
        revision: 1,
        occurrence: {
          id: occurrence.id,
          state: "SKIPPED",
          effectiveScheduledAt: JAN_7.toISOString(),
          actorUserId: OWNER_ID,
          actorCoworkerId: null,
        },
      },
    });
    expect(storedSchedule(schedule.id)).toMatchObject({
      revision: 1,
      nextOccurrenceAt: JAN_14,
    });
    expect(
      occurrencesOf(schedule.id).find((row) => row.id === occurrence.id)?.state,
    ).toBe("SKIPPED");
  });

  it("moves a planned Occurrence and keeps the rule's time", async () => {
    const schedule = seedTaskSchedule({ nextOccurrenceAt: JAN_7 });
    const occurrence = seedOccurrence(schedule, JAN_7);
    seedOccurrence(schedule, JAN_14);

    const response = await send(schedule, occurrence.id, {
      action: "move",
      scheduledAt: JAN_15.toISOString(),
    });

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      data: {
        revision: 1,
        occurrence: {
          state: "PLANNED",
          originalScheduledAt: JAN_7.toISOString(),
          effectiveScheduledAt: JAN_15.toISOString(),
        },
      },
    });
    expect(storedSchedule(schedule.id)?.nextOccurrenceAt).toEqual(JAN_14);
  });

  it("wakes the schedule at an Occurrence moved earlier", async () => {
    const schedule = seedTaskSchedule({ nextOccurrenceAt: JAN_7 });
    const occurrence = seedOccurrence(schedule, JAN_7);

    await send(schedule, occurrence.id, {
      action: "move",
      scheduledAt: JAN_2.toISOString(),
    });

    expect(storedSchedule(schedule.id)?.nextOccurrenceAt).toEqual(JAN_2);
  });

  it("restores a skipped Occurrence at the rule's time", async () => {
    const schedule = seedTaskSchedule({ nextOccurrenceAt: JAN_14 });
    const occurrence = seedOccurrence(schedule, JAN_7, { state: "SKIPPED" });
    seedOccurrence(schedule, JAN_14);

    const response = await send(schedule, occurrence.id, {
      action: "restore",
    });

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      data: {
        occurrence: {
          state: "PLANNED",
          effectiveScheduledAt: JAN_7.toISOString(),
        },
      },
    });
    expect(storedSchedule(schedule.id)?.nextOccurrenceAt).toEqual(JAN_7);
  });

  it("restores a moved Occurrence to the rule's time", async () => {
    const schedule = seedTaskSchedule({ nextOccurrenceAt: JAN_7 });
    const occurrence = seedOccurrence(schedule, JAN_7, {
      effectiveScheduledAt: JAN_15,
    });
    seedOccurrence(schedule, JAN_14);

    const response = await send(schedule, occurrence.id, {
      action: "restore",
    });

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      data: {
        occurrence: {
          state: "PLANNED",
          effectiveScheduledAt: JAN_7.toISOString(),
        },
      },
    });
    expect(storedSchedule(schedule.id)?.nextOccurrenceAt).toEqual(JAN_7);
  });

  describe("access", () => {
    function seedPlanned(overrides: Partial<TaskSchedule> = {}) {
      const schedule = seedTaskSchedule({
        nextOccurrenceAt: JAN_7,
        ...overrides,
      });
      return { schedule, occurrence: seedOccurrence(schedule, JAN_7) };
    }

    it("hides a private schedule from other members", async () => {
      const { schedule, occurrence } = seedPlanned({ visibility: "PRIVATE" });

      const response = await send(
        schedule,
        occurrence.id,
        { action: "skip" },
        createTaskScheduleTestApp(mount, userAuth(MEMBER_ID)),
      );

      expect(response.status).toBe(404);
      expect(occurrencesOf(schedule.id)).toEqual([occurrence]);
    });

    it("lets only the owner change a workspace-visible schedule", async () => {
      const { schedule, occurrence } = seedPlanned();

      const response = await send(
        schedule,
        occurrence.id,
        { action: "skip" },
        createTaskScheduleTestApp(mount, userAuth(MEMBER_ID)),
      );

      expect(response.status).toBe(403);
      expect(occurrencesOf(schedule.id)).toEqual([occurrence]);
    });

    it("refuses an unseated member of a paid organization", async () => {
      const { schedule, occurrence } = seedPlanned();
      taskScheduleTestDb.seatAssigned = false;

      const response = await send(schedule, occurrence.id, { action: "skip" });

      expect(response.status).toBe(403);
      expect(occurrencesOf(schedule.id)).toEqual([occurrence]);
    });

    it("lets a granted Coworker change a schedule it created and records it", async () => {
      const { schedule, occurrence } = seedPlanned({
        creatorUserId: null,
        creatorCoworkerId: COWORKER_ID,
      });

      const response = await send(
        schedule,
        occurrence.id,
        { action: "skip" },
        createTaskScheduleTestApp(mount, COWORKER_AUTH),
      );

      expect(response.status).toBe(200);
      expect(await response.json()).toMatchObject({
        data: {
          occurrence: {
            state: "SKIPPED",
            actorUserId: null,
            actorCoworkerId: COWORKER_ID,
          },
        },
      });
    });

    it("refuses a Coworker without a workspace grant", async () => {
      const { schedule, occurrence } = seedPlanned({
        creatorUserId: null,
        creatorCoworkerId: COWORKER_ID,
      });
      taskScheduleTestDb.vendorGrantStatus = null;

      const response = await send(
        schedule,
        occurrence.id,
        { action: "skip" },
        createTaskScheduleTestApp(mount, COWORKER_AUTH),
      );

      expect(response.status).toBe(403);
      expect(await response.json()).toMatchObject({ kind: "grant_required" });
      expect(occurrencesOf(schedule.id)).toEqual([occurrence]);
    });

    it("refuses a Coworker on a schedule outside its vendor family", async () => {
      const { schedule, occurrence } = seedPlanned();

      const response = await send(
        schedule,
        occurrence.id,
        { action: "skip" },
        createTaskScheduleTestApp(mount, COWORKER_AUTH),
      );

      expect(response.status).toBe(403);
      expect(occurrencesOf(schedule.id)).toEqual([occurrence]);
    });

    it("refuses Soko Bot actors", async () => {
      const { schedule, occurrence } = seedPlanned();

      const response = await send(
        schedule,
        occurrence.id,
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
      return occurrencesOf(scheduleId)
        .filter((row) => row.state === "PLANNED")
        .map((row) => row.effectiveScheduledAt);
    }

    function seedAfterThree() {
      const schedule = seedTaskSchedule({
        nextOccurrenceAt: JAN_7,
        endsMode: "AFTER",
        targetOccurrenceCount: 3,
      });
      seedOccurrence(schedule, JAN_7);
      seedOccurrence(schedule, JAN_14);
      const last = seedOccurrence(schedule, JAN_21);
      return { schedule, last };
    }

    it("plans one more Occurrence when one of N is skipped", async () => {
      const { schedule, last } = seedAfterThree();

      await send(schedule, last.id, { action: "skip" });

      expect(plannedTimes(schedule.id)).toEqual([JAN_7, JAN_14, JAN_28]);
    });

    it("drops that extra Occurrence again on restore", async () => {
      const { schedule, last } = seedAfterThree();
      await send(schedule, last.id, { action: "skip" });

      const response = await send(schedule, last.id, {
        action: "restore",
        expectedRevision: 1,
      });

      expect(response.status).toBe(200);
      expect(plannedTimes(schedule.id)).toEqual([JAN_7, JAN_14, JAN_21]);
    });

    it("keeps a schedule whose last Occurrence is skipped due at that time", async () => {
      const schedule = seedTaskSchedule({
        nextOccurrenceAt: JAN_7,
        endsMode: "ON",
        endsOn: JAN_8,
      });
      const last = seedOccurrence(schedule, JAN_7);

      await send(schedule, last.id, { action: "skip" });

      expect(storedSchedule(schedule.id)).toMatchObject({
        state: "ACTIVE",
        nextOccurrenceAt: JAN_7,
      });
    });
  });

  describe("refuses", () => {
    function expectUnchanged(schedule: TaskSchedule) {
      expect(storedSchedule(schedule.id)).toMatchObject({
        revision: schedule.revision,
        nextOccurrenceAt: schedule.nextOccurrenceAt,
      });
    }

    it.each([
      ["skip", {}],
      ["move", { scheduledAt: JAN_15.toISOString() }],
    ])(
      "to %s an Occurrence that already created its Task",
      async (action, extra) => {
        const schedule = seedTaskSchedule({
          nextOccurrenceAt: JAN_14,
          releasedCount: 1,
        });
        const occurrence = seedOccurrence(schedule, JAN_7, {
          state: "RELEASED",
          releasedTaskId: "task_released",
        });

        const response = await send(schedule, occurrence.id, {
          action,
          ...extra,
        });

        expect(response.status).toBe(409);
        expect(await response.json()).toMatchObject({
          kind: "schedule_occurrence_state_conflict",
        });
        expect(occurrencesOf(schedule.id)).toEqual([occurrence]);
        expectUnchanged(schedule);
      },
    );

    it("to skip an Occurrence whose time has passed", async () => {
      const schedule = seedTaskSchedule({ nextOccurrenceAt: DEC_30 });
      const occurrence = seedOccurrence(schedule, DEC_30);

      const response = await send(schedule, occurrence.id, { action: "skip" });

      expect(response.status).toBe(409);
      expect(await response.json()).toMatchObject({
        kind: "schedule_occurrence_state_conflict",
      });
      expect(occurrencesOf(schedule.id)).toEqual([occurrence]);
    });

    it("to skip an Occurrence that is already skipped", async () => {
      const schedule = seedTaskSchedule({ nextOccurrenceAt: JAN_14 });
      const occurrence = seedOccurrence(schedule, JAN_7, { state: "SKIPPED" });

      const response = await send(schedule, occurrence.id, { action: "skip" });

      expect(response.status).toBe(409);
      expect(await response.json()).toMatchObject({
        kind: "schedule_occurrence_state_conflict",
      });
    });

    it("to restore an Occurrence that was neither skipped nor moved", async () => {
      const schedule = seedTaskSchedule({ nextOccurrenceAt: JAN_7 });
      const occurrence = seedOccurrence(schedule, JAN_7);

      const response = await send(schedule, occurrence.id, {
        action: "restore",
      });

      expect(response.status).toBe(409);
      expect(await response.json()).toMatchObject({
        kind: "schedule_occurrence_state_conflict",
      });
      expectUnchanged(schedule);
    });

    it("to restore a moved Occurrence a rule edit canceled", async () => {
      const schedule = seedTaskSchedule({ nextOccurrenceAt: JAN_14 });
      const occurrence = seedOccurrence(schedule, JAN_7, {
        state: "CANCELED",
        effectiveScheduledAt: JAN_15,
      });

      const response = await send(schedule, occurrence.id, {
        action: "restore",
      });

      expect(response.status).toBe(409);
      expect(await response.json()).toMatchObject({
        kind: "schedule_occurrence_state_conflict",
      });
      expect(occurrencesOf(schedule.id)).toEqual([occurrence]);
    });

    it("to move an Occurrence into the past", async () => {
      const schedule = seedTaskSchedule({ nextOccurrenceAt: JAN_7 });
      const occurrence = seedOccurrence(schedule, JAN_7);

      const response = await send(schedule, occurrence.id, {
        action: "move",
        scheduledAt: DEC_30.toISOString(),
      });

      expect(response.status).toBe(422);
      expect(await response.json()).toMatchObject({
        kind: "schedule_occurrence_target_invalid",
      });
      expect(occurrencesOf(schedule.id)).toEqual([occurrence]);
    });

    it("to move an Occurrence past the projection horizon", async () => {
      const schedule = seedTaskSchedule({ nextOccurrenceAt: JAN_7 });
      const occurrence = seedOccurrence(schedule, JAN_7);

      const response = await send(schedule, occurrence.id, {
        action: "move",
        scheduledAt: BEYOND_HORIZON.toISOString(),
      });

      expect(response.status).toBe(422);
      expect(await response.json()).toMatchObject({
        kind: "schedule_occurrence_target_invalid",
      });
      expect(occurrencesOf(schedule.id)).toEqual([occurrence]);
    });

    it("to skip an Occurrence past the projection horizon", async () => {
      const schedule = seedTaskSchedule({ nextOccurrenceAt: BEYOND_HORIZON });
      const occurrence = seedOccurrence(schedule, BEYOND_HORIZON);

      const response = await send(schedule, occurrence.id, { action: "skip" });

      expect(response.status).toBe(422);
      expect(await response.json()).toMatchObject({
        kind: "schedule_occurrence_target_invalid",
      });
    });

    it("to restore a moved Occurrence whose rule time has passed", async () => {
      const schedule = seedTaskSchedule({ nextOccurrenceAt: JAN_7 });
      const occurrence = seedOccurrence(schedule, DEC_30, {
        effectiveScheduledAt: JAN_7,
      });

      const response = await send(schedule, occurrence.id, {
        action: "restore",
      });

      expect(response.status).toBe(422);
      expect(await response.json()).toMatchObject({
        kind: "schedule_occurrence_target_invalid",
      });
      expect(occurrencesOf(schedule.id)).toEqual([occurrence]);
    });

    it("a stale revision", async () => {
      const schedule = seedTaskSchedule({
        nextOccurrenceAt: JAN_7,
        revision: 2,
      });
      const occurrence = seedOccurrence(schedule, JAN_7);

      const response = await send(schedule, occurrence.id, {
        action: "skip",
        expectedRevision: 1,
      });

      expect(response.status).toBe(409);
      expect(await response.json()).toMatchObject({
        kind: "schedule_revision_conflict",
      });
      expect(occurrencesOf(schedule.id)).toEqual([occurrence]);
      expectUnchanged(schedule);
    });

    it.each(["PAUSED", "ENDED"] as const)(
      "an Occurrence of a %s schedule",
      async (state) => {
        const schedule = seedTaskSchedule({ state, nextOccurrenceAt: null });
        const occurrence = seedOccurrence(schedule, JAN_7, {
          state: "SKIPPED",
        });

        const response = await send(schedule, occurrence.id, {
          action: "restore",
        });

        expect(response.status).toBe(409);
        expect(await response.json()).toMatchObject({
          kind: "schedule_state_conflict",
        });
        expect(occurrencesOf(schedule.id)).toEqual([occurrence]);
      },
    );

    it("a change racing a release of the same schedule", async () => {
      const schedule = seedTaskSchedule({ nextOccurrenceAt: JAN_7 });
      const occurrence = seedOccurrence(schedule, JAN_14);
      // A release commits between this request's read and its write.
      vi.mocked(
        taskScheduleTestPrisma.taskScheduleOccurrence.findFirst,
      ).mockImplementationOnce(async () => {
        taskScheduleTestDb.schedules = taskScheduleTestDb.schedules.map(
          (row) => ({ ...row, releasedCount: row.releasedCount + 1 }),
        );
        return occurrence;
      });

      const response = await send(schedule, occurrence.id, { action: "skip" });

      expect(response.status).toBe(409);
      expect(occurrencesOf(schedule.id)).toEqual([occurrence]);
    });

    it("an Occurrence of another schedule", async () => {
      const schedule = seedTaskSchedule({ nextOccurrenceAt: JAN_7 });
      const other = seedTaskSchedule();
      const occurrence = seedOccurrence(other, JAN_7);

      const response = await send(schedule, occurrence.id, { action: "skip" });

      expect(response.status).toBe(404);
      expect(occurrencesOf(other.id)).toEqual([occurrence]);
    });
  });
});
