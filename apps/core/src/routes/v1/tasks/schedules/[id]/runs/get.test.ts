import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  COWORKER_AUTH,
  MEMBER_ID,
  resetTaskScheduleTestDb,
  seedRun,
  seedTaskSchedule,
  taskScheduleTestDb,
  userAuth,
} from "@/test-fixtures/task-schedule";
import { createTaskScheduleTestApp } from "@/test-fixtures/task-schedule-app";

import mount from "./get";

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

const NOW = new Date("2030-01-10T08:00:00.000Z");
const JAN_7 = new Date("2030-01-07T09:00:00.000Z");
const JAN_14 = new Date("2030-01-14T09:00:00.000Z");
const JAN_16 = new Date("2030-01-16T09:00:00.000Z");
const JAN_21 = new Date("2030-01-21T09:00:00.000Z");

function list(id: string, query = "", app = createTaskScheduleTestApp(mount)) {
  return app.request(`http://localhost/schedules/${id}/runs${query}`);
}

describe("GET /tasks/schedules/{id}/runs", () => {
  beforeEach(() => {
    resetTaskScheduleTestDb();
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(NOW);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("lists released, skipped, moved, and planned Runs in time order", async () => {
    const schedule = seedTaskSchedule({ releasedCount: 1 });
    const released = seedRun(schedule, JAN_7, {
      state: "RELEASED",
      releasedTaskId: "task_released",
    });
    const moved = seedRun(schedule, JAN_14, {
      effectiveScheduledAt: JAN_16,
      actorUserId: MEMBER_ID,
    });
    const skipped = seedRun(schedule, JAN_21, { state: "SKIPPED" });
    seedRun(seedTaskSchedule(), JAN_14);

    const response = await list(schedule.id);

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      data: [
        {
          id: released.id,
          state: "RELEASED",
          releasedTaskId: "task_released",
          effectiveScheduledAt: JAN_7.toISOString(),
        },
        {
          id: moved.id,
          state: "PLANNED",
          originalScheduledAt: JAN_14.toISOString(),
          effectiveScheduledAt: JAN_16.toISOString(),
          actorUserId: MEMBER_ID,
        },
        { id: skipped.id, state: "SKIPPED" },
      ],
      meta: { pagination: { total: 3, nextCursor: null } },
    });
  });

  it("limits the list to a time range", async () => {
    const schedule = seedTaskSchedule();
    seedRun(schedule, JAN_7, { state: "RELEASED" });
    const inRange = seedRun(schedule, JAN_14);
    seedRun(schedule, JAN_21);

    const response = await list(
      schedule.id,
      `?from=${JAN_14.toISOString()}&to=${JAN_21.toISOString()}`,
    );

    const body = await response.json();
    expect(body.data.map((row: { id: string }) => row.id)).toEqual([
      inRange.id,
    ]);
    expect(body.meta.pagination.total).toBe(1);
  });

  it("pages with a cursor", async () => {
    const schedule = seedTaskSchedule();
    const first = seedRun(schedule, JAN_7);
    const second = seedRun(schedule, JAN_14);
    const third = seedRun(schedule, JAN_21);

    const firstPage = await (await list(schedule.id, "?limit=2")).json();
    const secondPage = await (
      await list(
        schedule.id,
        `?limit=2&cursor=${firstPage.meta.pagination.nextCursor}`,
      )
    ).json();

    expect(firstPage.data.map((row: { id: string }) => row.id)).toEqual([
      first.id,
      second.id,
    ]);
    expect(secondPage.data.map((row: { id: string }) => row.id)).toEqual([
      third.id,
    ]);
    expect(secondPage.meta.pagination.nextCursor).toBeNull();
  });

  it("shows a workspace-visible schedule's Runs to other members", async () => {
    const schedule = seedTaskSchedule();
    seedRun(schedule, JAN_14);

    const response = await list(
      schedule.id,
      "",
      createTaskScheduleTestApp(mount, userAuth(MEMBER_ID)),
    );

    expect(response.status).toBe(200);
  });

  it("hides a private schedule from other members", async () => {
    const schedule = seedTaskSchedule({ visibility: "PRIVATE" });
    seedRun(schedule, JAN_14);

    const response = await list(
      schedule.id,
      "",
      createTaskScheduleTestApp(mount, userAuth(MEMBER_ID)),
    );

    expect(response.status).toBe(404);
  });

  it("refuses an unseated member of a paid organization", async () => {
    const schedule = seedTaskSchedule();
    taskScheduleTestDb.seatAssigned = false;

    const response = await list(schedule.id);

    expect(response.status).toBe(403);
  });

  it("lets a Coworker with a workspace grant read them", async () => {
    const schedule = seedTaskSchedule();
    seedRun(schedule, JAN_14);

    const response = await list(
      schedule.id,
      "",
      createTaskScheduleTestApp(mount, COWORKER_AUTH),
    );

    expect(response.status).toBe(200);
  });

  it("refuses a Coworker without a workspace grant", async () => {
    const schedule = seedTaskSchedule();
    taskScheduleTestDb.vendorGrantStatus = null;

    const response = await list(
      schedule.id,
      "",
      createTaskScheduleTestApp(mount, COWORKER_AUTH),
    );

    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({ kind: "grant_required" });
  });
});
