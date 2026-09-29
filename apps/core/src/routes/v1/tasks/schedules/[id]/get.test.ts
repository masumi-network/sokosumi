import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  COWORKER_AUTH,
  COWORKER_ID,
  MEMBER_ID,
  PERSONAL_WORKSPACE_ID,
  resetTaskScheduleTestDb,
  SOKO_BOT_AUTH,
  seedTaskSchedule,
  taskScheduleTestDb,
  userAuth,
  VENDOR_ID,
} from "@/test-fixtures/task-schedule";
import { createTaskScheduleTestApp } from "@/test-fixtures/task-schedule-app";

import mountGetTaskSchedule from "./get";

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

function get(
  id: string,
  app = createTaskScheduleTestApp(mountGetTaskSchedule),
) {
  return app.request(`http://localhost/schedules/${id}`);
}

describe("GET /tasks/schedules/{id}", () => {
  beforeEach(() => {
    resetTaskScheduleTestDb();
  });

  it("returns a schedule with its rule and blueprint", async () => {
    const schedule = seedTaskSchedule({ assigneeId: COWORKER_ID });

    const response = await get(schedule.id);

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      data: {
        id: schedule.id,
        state: "ACTIVE",
        assigneeId: COWORKER_ID,
        rule: { expr: "0 9 * * 1", timezone: "UTC", endsMode: "NEVER" },
        nextRunAt: "2030-01-07T09:00:00.000Z",
      },
    });
  });

  it("shows a workspace-visible schedule to other members", async () => {
    const schedule = seedTaskSchedule();

    const response = await get(
      schedule.id,
      createTaskScheduleTestApp(mountGetTaskSchedule, userAuth(MEMBER_ID)),
    );

    expect(response.status).toBe(200);
  });

  it("hides a private schedule from other members", async () => {
    const schedule = seedTaskSchedule({ visibility: "PRIVATE" });

    const response = await get(
      schedule.id,
      createTaskScheduleTestApp(mountGetTaskSchedule, userAuth(MEMBER_ID)),
    );

    expect(response.status).toBe(404);
  });

  it("hides a schedule from another workspace", async () => {
    const schedule = seedTaskSchedule({ workspaceId: PERSONAL_WORKSPACE_ID });

    const response = await get(schedule.id);

    expect(response.status).toBe(404);
  });

  it("refuses an unseated member of a paid organization", async () => {
    const schedule = seedTaskSchedule();
    taskScheduleTestDb.seatAssigned = false;

    const response = await get(schedule.id);

    expect(response.status).toBe(403);
  });

  describe("Coworker", () => {
    function coworkerGet(id: string) {
      return get(
        id,
        createTaskScheduleTestApp(mountGetTaskSchedule, COWORKER_AUTH),
      );
    }

    it("reads a workspace-visible schedule with a workspace grant", async () => {
      const schedule = seedTaskSchedule();

      expect((await coworkerGet(schedule.id)).status).toBe(200);
    });

    it("reads a private schedule assigned to its vendor family", async () => {
      taskScheduleTestDb.coworkers.set("cow_sibling", { vendorId: VENDOR_ID });
      const schedule = seedTaskSchedule({
        visibility: "PRIVATE",
        assigneeId: "cow_sibling",
      });

      expect((await coworkerGet(schedule.id)).status).toBe(200);
    });

    it("does not read another member's private schedule, even on its vendor family", async () => {
      taskScheduleTestDb.coworkers.set("cow_sibling", { vendorId: VENDOR_ID });
      const schedule = seedTaskSchedule({
        visibility: "PRIVATE",
        ownerId: MEMBER_ID,
        creatorUserId: MEMBER_ID,
        assigneeId: "cow_sibling",
      });

      expect((await coworkerGet(schedule.id)).status).toBe(404);
    });

    it("does not read the member's private schedule outside its vendor family", async () => {
      const schedule = seedTaskSchedule({ visibility: "PRIVATE" });

      expect((await coworkerGet(schedule.id)).status).toBe(404);
    });

    it("is refused without a workspace grant", async () => {
      const schedule = seedTaskSchedule();
      taskScheduleTestDb.vendorGrantStatus = null;

      const response = await coworkerGet(schedule.id);

      expect(response.status).toBe(403);
      expect(await response.json()).toMatchObject({ kind: "grant_required" });
    });
  });

  it("refuses Soko Bot actors", async () => {
    const schedule = seedTaskSchedule();

    const response = await get(
      schedule.id,
      createTaskScheduleTestApp(mountGetTaskSchedule, SOKO_BOT_AUTH),
    );

    expect(response.status).toBe(403);
  });
});
