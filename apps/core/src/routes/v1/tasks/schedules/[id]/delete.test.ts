import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  MEMBER_ID,
  PROJECT_ID,
  resetTaskScheduleTestDb,
  seedTaskSchedule,
  taskScheduleTestDb,
  taskScheduleTestPrisma,
  userAuth,
} from "@/test-fixtures/task-schedule";
import {
  createTaskScheduleTestApp,
  jsonRequest,
} from "@/test-fixtures/task-schedule-app";

import mountDeleteTaskSchedule from "./delete";

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

function remove(
  id: string,
  app = createTaskScheduleTestApp(mountDeleteTaskSchedule),
) {
  return app.request(`http://localhost/schedules/${id}`, jsonRequest("DELETE"));
}

describe("DELETE /tasks/schedules/{id}", () => {
  beforeEach(() => {
    resetTaskScheduleTestDb();
  });

  it("deletes the schedule and leaves the Tasks it created to the SetNull FK", async () => {
    const schedule = seedTaskSchedule();

    const response = await remove(schedule.id);

    expect(response.status).toBe(204);
    expect(taskScheduleTestDb.schedules).toHaveLength(0);
    const { task } = taskScheduleTestPrisma;
    expect(task.update).not.toHaveBeenCalled();
    expect(task.updateMany).not.toHaveBeenCalled();
    expect(task.delete).not.toHaveBeenCalled();
    expect(task.deleteMany).not.toHaveBeenCalled();
  });

  it("refuses a schedule in a closed project", async () => {
    const schedule = seedTaskSchedule({ projectId: PROJECT_ID });
    taskScheduleTestDb.projects.set(PROJECT_ID, {
      workspaceId: schedule.workspaceId,
      closedAt: new Date("2026-09-01T00:00:00.000Z"),
    });

    const response = await remove(schedule.id);

    expect(response.status).toBe(409);
    expect(taskScheduleTestDb.schedules).toHaveLength(1);
  });

  it("lets only the owner delete", async () => {
    const schedule = seedTaskSchedule();

    const response = await remove(
      schedule.id,
      createTaskScheduleTestApp(mountDeleteTaskSchedule, userAuth(MEMBER_ID)),
    );

    expect(response.status).toBe(403);
    expect(taskScheduleTestDb.schedules).toHaveLength(1);
  });

  it("hides another member's private schedule", async () => {
    const schedule = seedTaskSchedule({ visibility: "PRIVATE" });

    const response = await remove(
      schedule.id,
      createTaskScheduleTestApp(mountDeleteTaskSchedule, userAuth(MEMBER_ID)),
    );

    expect(response.status).toBe(404);
  });
});
