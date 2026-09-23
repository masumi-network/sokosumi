import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  occurrencesOf,
  resetTaskScheduleTestDb,
  seedOccurrence,
  seedTaskSchedule,
  taskScheduleTestDb,
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

function send(id: string, app = createTaskScheduleTestApp(mount)) {
  return app.request(
    `http://localhost/schedules/${id}/resume`,
    jsonRequest("POST"),
  );
}

function stored(id: string) {
  return taskScheduleTestDb.schedules.find((schedule) => schedule.id === id);
}

describe("POST /tasks/schedules/{id}/resume", () => {
  beforeEach(() => {
    resetTaskScheduleTestDb();
  });

  it("resumes a Paused schedule from the next Occurrence after now", async () => {
    const schedule = seedTaskSchedule({
      state: "PAUSED",
      nextOccurrenceAt: null,
    });
    const before = Date.now();

    const response = await send(schedule.id);

    expect(response.status).toBe(200);
    const row = stored(schedule.id);
    expect(row?.state).toBe("ACTIVE");
    expect(row?.nextOccurrenceAt?.getTime()).toBeGreaterThan(before);
    expect(row?.nextOccurrenceAt?.getUTCDay()).toBe(1);
  });

  it("plans the Occurrences from now in the schedule's epoch", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2030-01-01T00:00:00.000Z"));
    try {
      const schedule = seedTaskSchedule({
        state: "PAUSED",
        nextOccurrenceAt: null,
        releasedCount: 1,
      });
      const released = seedOccurrence(
        schedule,
        new Date("2029-12-24T09:00:00.000Z"),
        { state: "RELEASED", releasedTaskId: "task_released" },
      );

      await send(schedule.id);

      const [first, ...planned] = occurrencesOf(schedule.id);
      expect(first).toEqual(released);
      // The Monday missed while paused (Dec 31) is not made up.
      expect(planned[0]).toMatchObject({
        state: "PLANNED",
        epochId: schedule.epochId,
        effectiveScheduledAt: new Date("2030-01-07T09:00:00.000Z"),
      });
      expect(stored(schedule.id)?.nextOccurrenceAt).toEqual(
        new Date("2030-01-07T09:00:00.000Z"),
      );
    } finally {
      vi.useRealTimers();
    }
  });

  it("ends a schedule whose end date passed while it was paused", async () => {
    const schedule = seedTaskSchedule({
      state: "PAUSED",
      nextOccurrenceAt: null,
      endsMode: "ON",
      endsOn: new Date("2026-01-01T00:00:00.000Z"),
    });

    const response = await send(schedule.id);

    expect(response.status).toBe(200);
    expect(stored(schedule.id)).toMatchObject({
      state: "ENDED",
      nextOccurrenceAt: null,
    });
  });

  it.each(["ACTIVE", "ENDED"] as const)(
    "rejects resuming an %s schedule",
    async (state) => {
      const schedule = seedTaskSchedule({ state });

      const response = await send(schedule.id);

      expect(response.status).toBe(409);
      expect(await response.json()).toMatchObject({
        kind: "schedule_state_conflict",
      });
      expect(stored(schedule.id)?.state).toBe(state);
    },
  );
});
