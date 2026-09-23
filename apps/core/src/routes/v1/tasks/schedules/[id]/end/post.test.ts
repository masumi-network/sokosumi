import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  COWORKER_AUTH,
  COWORKER_ID,
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
    `http://localhost/schedules/${id}/end`,
    jsonRequest("POST"),
  );
}

function stored(id: string) {
  return taskScheduleTestDb.schedules.find((schedule) => schedule.id === id);
}

describe("POST /tasks/schedules/{id}/end", () => {
  beforeEach(() => {
    resetTaskScheduleTestDb();
  });

  it.each(["ACTIVE", "PAUSED"] as const)(
    "ends a %s schedule and keeps it",
    async (state) => {
      const schedule = seedTaskSchedule({ state });

      const response = await send(schedule.id);

      expect(response.status).toBe(200);
      expect(stored(schedule.id)).toMatchObject({
        state: "ENDED",
        nextOccurrenceAt: null,
      });
    },
  );

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

  it("rejects ending an Ended schedule", async () => {
    const schedule = seedTaskSchedule({ state: "ENDED" });

    const response = await send(schedule.id);

    expect(response.status).toBe(409);
  });

  it("lets a Coworker end a schedule assigned to it", async () => {
    const schedule = seedTaskSchedule({ assigneeId: COWORKER_ID });

    const response = await send(
      schedule.id,
      createTaskScheduleTestApp(mount, COWORKER_AUTH),
    );

    expect(response.status).toBe(200);
  });
});
