import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  COWORKER_AUTH,
  MEMBER_ID,
  PERSONAL_WORKSPACE_ID,
  PROJECT_ID,
  resetTaskScheduleTestDb,
  seedTaskSchedule,
  taskScheduleTestDb,
  userAuth,
} from "@/test-fixtures/task-schedule";
import { createTaskScheduleTestApp } from "@/test-fixtures/task-schedule-app";

import mountGetTaskSchedules from "./get";

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

interface ListBody {
  data: Array<{ id: string }>;
  meta: { pagination: { nextCursor: string | null; total: number } };
}

async function list(
  query = "",
  app = createTaskScheduleTestApp(mountGetTaskSchedules),
): Promise<{ status: number; body: ListBody }> {
  const response = await app.request(`http://localhost/schedules${query}`);
  return { status: response.status, body: (await response.json()) as ListBody };
}

function at(minute: number): Date {
  return new Date(Date.UTC(2026, 8, 1, 8, minute));
}

describe("GET /tasks/schedules", () => {
  beforeEach(() => {
    resetTaskScheduleTestDb();
  });

  it("lists the workspace's schedules, newest first", async () => {
    const older = seedTaskSchedule({ createdAt: at(1) });
    const newer = seedTaskSchedule({ createdAt: at(2) });
    seedTaskSchedule({ workspaceId: PERSONAL_WORKSPACE_ID });

    const { status, body } = await list();

    expect(status).toBe(200);
    expect(body.data.map((schedule) => schedule.id)).toEqual([
      newer.id,
      older.id,
    ]);
    expect(body.meta.pagination.total).toBe(2);
  });

  it("filters by project and state", async () => {
    const match = seedTaskSchedule({ projectId: PROJECT_ID, state: "PAUSED" });
    seedTaskSchedule({ projectId: PROJECT_ID });
    seedTaskSchedule({ state: "PAUSED" });

    const { body } = await list(`?projectId=${PROJECT_ID}&state=PAUSED`);

    expect(body.data.map((schedule) => schedule.id)).toEqual([match.id]);
  });

  it("leaves other members' private schedules out", async () => {
    const visible = seedTaskSchedule({ createdAt: at(1) });
    seedTaskSchedule({ visibility: "PRIVATE", createdAt: at(2) });

    const { body } = await list(
      "",
      createTaskScheduleTestApp(mountGetTaskSchedules, userAuth(MEMBER_ID)),
    );

    expect(body.data.map((schedule) => schedule.id)).toEqual([visible.id]);
  });

  it("pages with a cursor", async () => {
    const first = seedTaskSchedule({ createdAt: at(3) });
    const second = seedTaskSchedule({ createdAt: at(2) });
    const third = seedTaskSchedule({ createdAt: at(1) });

    const page1 = await list("?limit=2");
    expect(page1.body.data.map((schedule) => schedule.id)).toEqual([
      first.id,
      second.id,
    ]);
    expect(page1.body.meta.pagination.nextCursor).toBe(second.id);

    const page2 = await list(`?limit=2&cursor=${second.id}`);
    expect(page2.body.data.map((schedule) => schedule.id)).toEqual([third.id]);
    expect(page2.body.meta.pagination.nextCursor).toBeNull();
  });

  it("refuses a Coworker without a workspace grant", async () => {
    taskScheduleTestDb.vendorGrantStatus = null;

    const { status } = await list(
      "",
      createTaskScheduleTestApp(mountGetTaskSchedules, COWORKER_AUTH),
    );

    expect(status).toBe(403);
  });
});
