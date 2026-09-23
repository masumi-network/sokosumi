import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  COWORKER_AUTH,
  COWORKER_ID,
  MEMBER_ID,
  PROJECT_ID,
  resetTaskScheduleTestDb,
  seedTaskSchedule,
  taskScheduleTestDb,
  userAuth,
} from "@/test-fixtures/task-schedule";
import {
  createTaskScheduleTestApp,
  jsonRequest,
} from "@/test-fixtures/task-schedule-app";

import mountPatchTaskSchedule from "./patch";

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

function patch(
  id: string,
  body: unknown,
  app = createTaskScheduleTestApp(mountPatchTaskSchedule),
) {
  return app.request(
    `http://localhost/schedules/${id}`,
    jsonRequest("PATCH", body),
  );
}

function stored(id: string) {
  return taskScheduleTestDb.schedules.find((schedule) => schedule.id === id);
}

describe("PATCH /tasks/schedules/{id}", () => {
  beforeEach(() => {
    resetTaskScheduleTestDb();
  });

  it("changes the blueprint and advances the revision", async () => {
    const schedule = seedTaskSchedule({ revision: 2 });

    const response = await patch(schedule.id, {
      expectedRevision: 2,
      name: "Monthly report",
      description: "Summarise the month",
      projectId: PROJECT_ID,
    });

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      data: {
        name: "Monthly report",
        description: "Summarise the month",
        projectId: PROJECT_ID,
        revision: 3,
      },
    });
  });

  it("replaces the rule from now on, leaving already released counts", async () => {
    const schedule = seedTaskSchedule({ releasedCount: 3 });
    const before = Date.now();

    const response = await patch(schedule.id, {
      expectedRevision: 0,
      rule: { expr: "0 7 * * 5", timezone: "Europe/Berlin", endsMode: "NEVER" },
    });

    expect(response.status).toBe(200);
    const row = stored(schedule.id);
    expect(row).toMatchObject({
      expr: "0 7 * * 5",
      timezone: "Europe/Berlin",
      releasedCount: 3,
    });
    expect(row?.ruleEffectiveFrom.getTime()).toBeGreaterThanOrEqual(before);
    expect(row?.nextOccurrenceAt?.getTime()).toBeGreaterThan(before);
    expect(row?.nextOccurrenceAt?.getUTCDay()).toBe(5);
  });

  it("keeps a paused schedule without a next Occurrence", async () => {
    const schedule = seedTaskSchedule({
      state: "PAUSED",
      nextOccurrenceAt: null,
    });

    await patch(schedule.id, {
      expectedRevision: 0,
      rule: { expr: "0 7 * * 5", timezone: "UTC", endsMode: "NEVER" },
    });

    expect(stored(schedule.id)?.nextOccurrenceAt).toBeNull();
  });

  it("replaces the whole assignee when one assignee field is sent", async () => {
    const schedule = seedTaskSchedule({ assigneeId: COWORKER_ID });

    await patch(schedule.id, {
      expectedRevision: 0,
      assigneeUserId: MEMBER_ID,
    });

    expect(stored(schedule.id)).toMatchObject({
      assigneeId: null,
      assigneeUserId: MEMBER_ID,
    });
  });

  it("rejects a stale revision without writing", async () => {
    const schedule = seedTaskSchedule({ revision: 4 });

    const response = await patch(schedule.id, {
      expectedRevision: 3,
      name: "Monthly report",
    });

    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({
      kind: "schedule_revision_conflict",
    });
    expect(stored(schedule.id)).toMatchObject({
      name: "Weekly report",
      revision: 4,
    });
  });

  it.each(["timezone", "endsMode"])(
    "requires %s in a replacement rule instead of resetting it",
    async (field) => {
      const schedule = seedTaskSchedule({ timezone: "Europe/Berlin" });
      const rule: Record<string, unknown> = {
        expr: "0 7 * * 5",
        timezone: "Europe/Berlin",
        endsMode: "NEVER",
      };
      delete rule[field];

      const response = await patch(schedule.id, {
        expectedRevision: 0,
        rule,
      });

      expect(response.status).toBe(422);
      expect(stored(schedule.id)?.timezone).toBe("Europe/Berlin");
    },
  );

  it("rejects an invalid rule", async () => {
    const schedule = seedTaskSchedule();

    const response = await patch(schedule.id, {
      expectedRevision: 0,
      rule: { expr: "0 9 * * 1", timezone: "Mars/Olympus", endsMode: "NEVER" },
    });

    expect(response.status).toBe(400);
  });

  it("rejects an Occurrence count already reached", async () => {
    const schedule = seedTaskSchedule({ releasedCount: 5 });

    const response = await patch(schedule.id, {
      expectedRevision: 0,
      rule: {
        expr: "0 9 * * 1",
        timezone: "UTC",
        endsMode: "AFTER",
        targetOccurrenceCount: 5,
      },
    });

    expect(response.status).toBe(422);
  });

  it("rejects a project outside the workspace", async () => {
    const schedule = seedTaskSchedule();

    const response = await patch(schedule.id, {
      expectedRevision: 0,
      projectId: "01960001-0001-7001-8001-0000000000bb",
    });

    expect(response.status).toBe(404);
  });

  it("refuses edits to an Ended schedule", async () => {
    const schedule = seedTaskSchedule({ state: "ENDED" });

    const response = await patch(schedule.id, {
      expectedRevision: 0,
      name: "Monthly report",
    });

    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({
      kind: "schedule_state_conflict",
    });
  });

  it("lets only the owner edit a workspace-visible schedule", async () => {
    const schedule = seedTaskSchedule();

    const response = await patch(
      schedule.id,
      { expectedRevision: 0, name: "Mine now" },
      createTaskScheduleTestApp(mountPatchTaskSchedule, userAuth(MEMBER_ID)),
    );

    expect(response.status).toBe(403);
    expect(stored(schedule.id)?.name).toBe("Weekly report");
  });

  it("hides another member's private schedule", async () => {
    const schedule = seedTaskSchedule({ visibility: "PRIVATE" });

    const response = await patch(
      schedule.id,
      { expectedRevision: 0, name: "Mine now" },
      createTaskScheduleTestApp(mountPatchTaskSchedule, userAuth(MEMBER_ID)),
    );

    expect(response.status).toBe(404);
  });

  describe("Coworker", () => {
    function coworkerPatch(id: string, body: unknown) {
      return patch(
        id,
        body,
        createTaskScheduleTestApp(mountPatchTaskSchedule, COWORKER_AUTH),
      );
    }

    it("edits a schedule it created", async () => {
      const schedule = seedTaskSchedule({
        creatorUserId: null,
        creatorCoworkerId: COWORKER_ID,
      });

      const response = await coworkerPatch(schedule.id, {
        expectedRevision: 0,
        name: "Renamed by vendor",
      });

      expect(response.status).toBe(200);
    });

    it("does not edit another member's schedule it is assigned to", async () => {
      const schedule = seedTaskSchedule({
        ownerId: MEMBER_ID,
        creatorUserId: MEMBER_ID,
        assigneeId: COWORKER_ID,
      });

      const response = await coworkerPatch(schedule.id, {
        expectedRevision: 0,
        name: "Renamed by vendor",
      });

      expect(response.status).toBe(403);
    });

    it("does not edit a schedule outside its vendor family", async () => {
      const schedule = seedTaskSchedule();

      const response = await coworkerPatch(schedule.id, {
        expectedRevision: 0,
        name: "Renamed by vendor",
      });

      expect(response.status).toBe(403);
    });
  });
});
