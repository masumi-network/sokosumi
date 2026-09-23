import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  resetTaskScheduleTestDb,
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
