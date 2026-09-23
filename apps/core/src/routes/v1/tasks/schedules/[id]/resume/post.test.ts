import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  resetTaskScheduleTestDb,
  runsOf,
  seedRun,
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

  it("resumes a Paused schedule from the next Run after now", async () => {
    const schedule = seedTaskSchedule({
      state: "PAUSED",
      nextRunAt: null,
    });
    const before = Date.now();

    const response = await send(schedule.id);

    expect(response.status).toBe(200);
    const row = stored(schedule.id);
    expect(row?.state).toBe("ACTIVE");
    expect(row?.nextRunAt?.getTime()).toBeGreaterThan(before);
    expect(row?.nextRunAt?.getUTCDay()).toBe(1);
  });

  it("plans the Runs from now in the schedule's epoch", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2030-01-01T00:00:00.000Z"));
    try {
      const schedule = seedTaskSchedule({
        state: "PAUSED",
        nextRunAt: null,
        releasedCount: 1,
      });
      const released = seedRun(schedule, new Date("2029-12-24T09:00:00.000Z"), {
        state: "RELEASED",
        releasedTaskId: "task_released",
      });

      await send(schedule.id);

      const [first, ...planned] = runsOf(schedule.id);
      expect(first).toEqual(released);
      // The Monday missed while paused (Dec 31) is not made up.
      expect(planned[0]).toMatchObject({
        state: "PLANNED",
        epochId: schedule.epochId,
        effectiveScheduledAt: new Date("2030-01-07T09:00:00.000Z"),
      });
      expect(stored(schedule.id)?.nextRunAt).toEqual(
        new Date("2030-01-07T09:00:00.000Z"),
      );
    } finally {
      vi.useRealTimers();
    }
  });

  it("keeps a skipped Run skipped and plans the ones around it", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2030-01-01T00:00:00.000Z"));
    try {
      const schedule = seedTaskSchedule({
        state: "PAUSED",
        nextRunAt: null,
      });
      const skipped = seedRun(schedule, new Date("2030-01-14T09:00:00.000Z"), {
        state: "SKIPPED",
      });

      await send(schedule.id);

      const [first, second, third] = runsOf(schedule.id);
      expect(first).toMatchObject({
        state: "PLANNED",
        effectiveScheduledAt: new Date("2030-01-07T09:00:00.000Z"),
      });
      expect(second).toEqual(skipped);
      expect(third).toMatchObject({
        state: "PLANNED",
        effectiveScheduledAt: new Date("2030-01-21T09:00:00.000Z"),
      });
    } finally {
      vi.useRealTimers();
    }
  });

  it("keeps an upcoming move and cancels one whose time passed while paused", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2030-01-01T00:00:00.000Z"));
    try {
      const schedule = seedTaskSchedule({
        state: "PAUSED",
        nextRunAt: null,
      });
      const missed = seedRun(schedule, new Date("2030-01-14T09:00:00.000Z"), {
        effectiveScheduledAt: new Date("2029-12-31T09:00:00.000Z"),
      });
      const moved = seedRun(schedule, new Date("2030-01-21T09:00:00.000Z"), {
        effectiveScheduledAt: new Date("2030-01-22T09:00:00.000Z"),
      });

      await send(schedule.id);

      const rows = runsOf(schedule.id);
      expect(rows.find((row) => row.id === missed.id)?.state).toBe("CANCELED");
      expect(rows.find((row) => row.id === moved.id)?.state).toBe("PLANNED");
      expect(
        rows
          .filter((row) => row.state === "PLANNED")
          .slice(0, 3)
          .map((row) => row.effectiveScheduledAt),
      ).toEqual([
        new Date("2030-01-07T09:00:00.000Z"),
        new Date("2030-01-22T09:00:00.000Z"),
        new Date("2030-01-28T09:00:00.000Z"),
      ]);
      expect(stored(schedule.id)?.nextRunAt).toEqual(
        new Date("2030-01-07T09:00:00.000Z"),
      );
    } finally {
      vi.useRealTimers();
    }
  });

  it("ends a schedule whose end date passed while it was paused", async () => {
    const schedule = seedTaskSchedule({
      state: "PAUSED",
      nextRunAt: null,
      endsMode: "ON",
      endsOn: new Date("2026-01-01T00:00:00.000Z"),
    });

    const response = await send(schedule.id);

    expect(response.status).toBe(200);
    expect(stored(schedule.id)).toMatchObject({
      state: "ENDED",
      nextRunAt: null,
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
