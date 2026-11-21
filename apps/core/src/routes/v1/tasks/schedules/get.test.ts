import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  COWORKER_AUTH,
  COWORKER_ID,
  MEMBER_ID,
  OWNER_ID,
  PERSONAL_WORKSPACE_ID,
  PROJECT_ID,
  resetTaskScheduleTestDb,
  seedTask,
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
  data: Array<{
    id: string;
    canWrite: boolean;
    ownerId: string | null;
    lastTask?: {
      id: string;
      identifier: string | null;
      name: string;
      status: string;
    } | null;
  }>;
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

  it("returns the Owner of each schedule, null for one without an Owner", async () => {
    const owned = seedTaskSchedule({
      creatorUserId: null,
      creatorCoworkerId: COWORKER_ID,
    });
    const withoutOwner = seedTaskSchedule({
      ownerId: null,
      creatorUserId: null,
    });

    const { body } = await list();

    expect(
      Object.fromEntries(
        body.data.map((schedule) => [schedule.id, schedule.ownerId]),
      ),
    ).toEqual({ [owned.id]: OWNER_ID, [withoutOwner.id]: null });
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

  it("returns each schedule's newest top-level Task the reader can see, or null", async () => {
    const schedule = seedTaskSchedule();
    const unused = seedTaskSchedule();
    seedTask({
      scheduleId: schedule.id,
      createdAt: at(1),
      status: "COMPLETED",
      name: "Week 1",
    });
    const newest = seedTask({
      scheduleId: schedule.id,
      createdAt: at(2),
      status: "FAILED",
      name: "Week 2",
    });
    seedTask({
      scheduleId: schedule.id,
      createdAt: at(3),
      status: "RUNNING",
      name: "Archived",
      archivedAt: at(4),
    });
    seedTask({
      scheduleId: schedule.id,
      createdAt: at(3),
      status: "RUNNING",
      name: "Sub-task",
      parentTaskId: newest.id,
    });
    seedTask({
      scheduleId: schedule.id,
      createdAt: at(3),
      status: "RUNNING",
      name: "Private",
      visibility: "PRIVATE",
      ownerId: OWNER_ID,
    });

    const { body } = await list(
      "",
      createTaskScheduleTestApp(mountGetTaskSchedules, userAuth(MEMBER_ID)),
    );

    const byId = Object.fromEntries(
      body.data.map((row) => [row.id, row.lastTask]),
    );
    expect(byId[schedule.id]).toEqual({
      id: newest.id,
      identifier: null,
      name: "Week 2",
      status: "FAILED",
    });
    expect(byId[unused.id]).toBeNull();
  });

  it("leaves out a newer Task that was moved to another workspace", async () => {
    const schedule = seedTaskSchedule();
    const stayed = seedTask({
      scheduleId: schedule.id,
      createdAt: at(1),
      status: "COMPLETED",
      name: "Stayed",
    });
    seedTask({
      scheduleId: schedule.id,
      createdAt: at(2),
      status: "FAILED",
      name: "Moved",
      workspaceId: PERSONAL_WORKSPACE_ID,
    });

    const { body } = await list();

    expect(body.data[0]?.lastTask).toMatchObject({
      id: stayed.id,
      name: "Stayed",
    });
  });

  it("gives a Coworker the newest Task it may open, skipping a draft a person still sees", async () => {
    const schedule = seedTaskSchedule();
    const ready = seedTask({
      scheduleId: schedule.id,
      createdAt: at(1),
      status: "READY",
      name: "Ready",
    });
    const draft = seedTask({
      scheduleId: schedule.id,
      createdAt: at(2),
      status: "DRAFT",
      name: "Draft",
    });

    const person = await list();
    const coworker = await list(
      "",
      createTaskScheduleTestApp(mountGetTaskSchedules, COWORKER_AUTH),
    );

    expect(person.body.data[0]?.lastTask?.id).toBe(draft.id);
    expect(coworker.body.data[0]?.lastTask?.id).toBe(ready.id);
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

  it("tells each reader which schedules they may change", async () => {
    const created = seedTaskSchedule({
      creatorUserId: null,
      creatorCoworkerId: COWORKER_ID,
      createdAt: at(2),
    });
    const other = seedTaskSchedule({ ownerId: MEMBER_ID, createdAt: at(1) });

    const member = await list(
      "",
      createTaskScheduleTestApp(mountGetTaskSchedules, userAuth(MEMBER_ID)),
    );
    const coworker = await list(
      "",
      createTaskScheduleTestApp(mountGetTaskSchedules, COWORKER_AUTH),
    );

    expect(member.body.data).toEqual([
      expect.objectContaining({ id: created.id, canWrite: true }),
      expect.objectContaining({ id: other.id, canWrite: true }),
    ]);
    expect(coworker.body.data).toEqual([
      expect.objectContaining({ id: created.id, canWrite: true }),
      expect.objectContaining({ id: other.id, canWrite: false }),
    ]);
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
