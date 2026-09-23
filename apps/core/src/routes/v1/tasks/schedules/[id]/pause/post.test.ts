import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  MEMBER_ID,
  occurrencesOf,
  resetTaskScheduleTestDb,
  seedOccurrence,
  seedTaskSchedule,
  taskScheduleTestDb,
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

function send(id: string, app = createTaskScheduleTestApp(mount)) {
  return app.request(
    `http://localhost/schedules/${id}/pause`,
    jsonRequest("POST"),
  );
}

function stored(id: string) {
  return taskScheduleTestDb.schedules.find((schedule) => schedule.id === id);
}

describe("POST /tasks/schedules/{id}/pause", () => {
  beforeEach(() => {
    resetTaskScheduleTestDb();
  });

  it("pauses an Active schedule and clears its next Occurrence", async () => {
    const schedule = seedTaskSchedule();

    const response = await send(schedule.id);

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      data: { state: "PAUSED", nextOccurrenceAt: null, revision: 1 },
    });
  });

  it("drops the planned Occurrences and keeps the released ones", async () => {
    const schedule = seedTaskSchedule({ releasedCount: 1 });
    const released = seedOccurrence(
      schedule,
      new Date("2029-12-31T09:00:00.000Z"),
      { state: "RELEASED", releasedTaskId: "task_released" },
    );
    seedOccurrence(schedule, new Date("2030-01-07T09:00:00.000Z"));

    await send(schedule.id);

    expect(occurrencesOf(schedule.id)).toEqual([released]);
  });

  it("keeps skipped and moved Occurrences for the resume", async () => {
    const schedule = seedTaskSchedule();
    const moved = seedOccurrence(
      schedule,
      new Date("2030-01-07T09:00:00.000Z"),
      {
        effectiveScheduledAt: new Date("2030-01-08T09:00:00.000Z"),
      },
    );
    const skipped = seedOccurrence(
      schedule,
      new Date("2030-01-14T09:00:00.000Z"),
      { state: "SKIPPED" },
    );
    seedOccurrence(schedule, new Date("2030-01-21T09:00:00.000Z"));

    await send(schedule.id);

    expect(occurrencesOf(schedule.id)).toEqual([moved, skipped]);
  });

  it.each(["PAUSED", "ENDED"] as const)(
    "rejects pausing a %s schedule",
    async (state) => {
      const schedule = seedTaskSchedule({ state, nextOccurrenceAt: null });

      const response = await send(schedule.id);

      expect(response.status).toBe(409);
      expect(await response.json()).toMatchObject({
        kind: "schedule_state_conflict",
      });
      expect(stored(schedule.id)?.state).toBe(state);
    },
  );

  it("lets only the owner pause", async () => {
    const schedule = seedTaskSchedule();

    const response = await send(
      schedule.id,
      createTaskScheduleTestApp(mount, userAuth(MEMBER_ID)),
    );

    expect(response.status).toBe(403);
    expect(stored(schedule.id)?.state).toBe("ACTIVE");
  });
});
