import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  COWORKER_AUTH,
  COWORKER_ID,
  MEMBER_ID,
  OWNER_ID,
  PROJECT_ID,
  resetTaskScheduleTestDb,
  SOKO_BOT_AUTH,
  SOKO_BOT_ID,
  taskScheduleTestDb,
  userAuth,
} from "@/test-fixtures/task-schedule";
import {
  createTaskScheduleTestApp,
  jsonRequest,
} from "@/test-fixtures/task-schedule-app";

import mountPostTaskSchedule from "./post";

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

const WEEKLY_RULE = { expr: "0 9 * * 1", timezone: "Europe/Berlin" };

function post(
  body: unknown,
  app = createTaskScheduleTestApp(mountPostTaskSchedule),
) {
  return app.request("http://localhost/schedules", jsonRequest("POST", body));
}

describe("POST /tasks/schedules", () => {
  beforeEach(() => {
    resetTaskScheduleTestDb();
  });

  it("creates an Active schedule with the rule, blueprint, and next Occurrence", async () => {
    const response = await post({
      name: "Weekly report",
      description: "Summarise the week",
      projectId: PROJECT_ID,
      rule: WEEKLY_RULE,
    });

    expect(response.status).toBe(201);
    const { data } = (await response.json()) as {
      data: Record<string, unknown> & { rule: Record<string, unknown> };
    };
    expect(data).toMatchObject({
      state: "ACTIVE",
      name: "Weekly report",
      description: "Summarise the week",
      projectId: PROJECT_ID,
      visibility: "PUBLIC",
      ownerId: OWNER_ID,
      creatorUserId: OWNER_ID,
      revision: 0,
      releasedCount: 0,
      rule: {
        expr: "0 9 * * 1",
        timezone: "Europe/Berlin",
        endsMode: "NEVER",
        endsOn: null,
        targetOccurrenceCount: null,
      },
    });
    const next = new Date(data.nextOccurrenceAt as string);
    expect(next.getTime()).toBeGreaterThan(Date.now());
    expect(next.getUTCDay()).toBe(1);
    expect(taskScheduleTestDb.schedules).toHaveLength(1);
  });

  describe("rule validation", () => {
    it.each([
      [
        "an unknown timezone",
        { expr: "0 9 * * 1", timezone: "Mars/Olympus" },
        400,
      ],
      ["an invalid cron expression", { expr: "not a cron" }, 400],
      [
        "endsMode ON without endsOn",
        { expr: "0 9 * * 1", endsMode: "ON" },
        422,
      ],
      [
        "endsMode AFTER without targetOccurrenceCount",
        { expr: "0 9 * * 1", endsMode: "AFTER" },
        422,
      ],
      [
        "an end date in the past",
        {
          expr: "0 9 * * 1",
          endsMode: "ON",
          endsOn: "2020-01-01T00:00:00.000Z",
        },
        422,
      ],
      [
        "an interval without an anchor",
        { expr: "0 9 * * *", intervalDays: 3 },
        422,
      ],
    ])("rejects %s", async (_label, rule, status) => {
      const response = await post({ name: "Weekly report", rule });

      expect(response.status).toBe(status);
      expect(taskScheduleTestDb.schedules).toHaveLength(0);
    });

    it("stores an end rule after N Occurrences", async () => {
      const response = await post({
        name: "Weekly report",
        rule: { ...WEEKLY_RULE, endsMode: "AFTER", targetOccurrenceCount: 4 },
      });

      expect(response.status).toBe(201);
      expect(taskScheduleTestDb.schedules[0]).toMatchObject({
        endsMode: "AFTER",
        targetOccurrenceCount: 4,
        endsOn: null,
      });
    });
  });

  describe("assignee", () => {
    it.each([
      ["a Coworker", { assigneeId: COWORKER_ID }],
      ["the owner's Soko Bot", { assigneeSokoBotId: SOKO_BOT_ID }],
      ["a workspace member", { assigneeUserId: MEMBER_ID }],
    ])("accepts %s as the blueprint assignee", async (_label, assignee) => {
      const response = await post({
        name: "Weekly report",
        rule: WEEKLY_RULE,
        ...assignee,
      });

      expect(response.status).toBe(201);
      expect(taskScheduleTestDb.schedules[0]).toMatchObject({
        assigneeId: null,
        assigneeSokoBotId: null,
        assigneeUserId: null,
        ...assignee,
      });
    });

    it("rejects more than one assignee", async () => {
      const response = await post({
        name: "Weekly report",
        rule: WEEKLY_RULE,
        assigneeId: COWORKER_ID,
        assigneeUserId: MEMBER_ID,
      });

      expect(response.status).toBe(422);
    });

    it("rejects a person outside the workspace", async () => {
      const response = await post({
        name: "Weekly report",
        rule: WEEKLY_RULE,
        assigneeUserId: "user_stranger",
      });

      expect(response.status).toBe(404);
      expect(taskScheduleTestDb.schedules).toHaveLength(0);
    });

    it("rejects another member's Soko Bot", async () => {
      const response = await post(
        {
          name: "Weekly report",
          rule: WEEKLY_RULE,
          assigneeSokoBotId: SOKO_BOT_ID,
        },
        createTaskScheduleTestApp(mountPostTaskSchedule, userAuth(MEMBER_ID)),
      );

      expect(response.status).toBe(403);
    });

    it("rejects a person assignee on a private schedule", async () => {
      const response = await post({
        name: "Weekly report",
        rule: WEEKLY_RULE,
        visibility: "PRIVATE",
        assigneeUserId: MEMBER_ID,
      });

      expect(response.status).toBe(400);
    });
  });

  it("creates a private schedule in an organization workspace", async () => {
    const response = await post({
      name: "Weekly report",
      rule: WEEKLY_RULE,
      visibility: "PRIVATE",
    });

    expect(response.status).toBe(201);
    expect(taskScheduleTestDb.schedules[0]?.visibility).toBe("PRIVATE");
  });

  it("refuses an unseated member of a paid organization", async () => {
    taskScheduleTestDb.seatAssigned = false;

    const response = await post({ name: "Weekly report", rule: WEEKLY_RULE });

    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({
      kind: "organization_seat_required",
    });
    expect(taskScheduleTestDb.schedules).toHaveLength(0);
  });

  describe("Coworker", () => {
    it("creates a schedule as its creator in a granted workspace", async () => {
      const response = await post(
        { name: "Weekly report", rule: WEEKLY_RULE, assigneeId: COWORKER_ID },
        createTaskScheduleTestApp(mountPostTaskSchedule, COWORKER_AUTH),
      );

      expect(response.status).toBe(201);
      expect(taskScheduleTestDb.schedules[0]).toMatchObject({
        ownerId: OWNER_ID,
        creatorUserId: null,
        creatorCoworkerId: COWORKER_ID,
      });
    });

    it("is refused without a workspace grant", async () => {
      taskScheduleTestDb.vendorGrantStatus = null;

      const response = await post(
        { name: "Weekly report", rule: WEEKLY_RULE },
        createTaskScheduleTestApp(mountPostTaskSchedule, COWORKER_AUTH),
      );

      expect(response.status).toBe(403);
      expect(await response.json()).toMatchObject({ kind: "grant_required" });
      expect(taskScheduleTestDb.schedules).toHaveLength(0);
    });

    it("is refused when the member it acts for has no Seat", async () => {
      taskScheduleTestDb.seatAssigned = false;

      const response = await post(
        { name: "Weekly report", rule: WEEKLY_RULE },
        createTaskScheduleTestApp(mountPostTaskSchedule, COWORKER_AUTH),
      );

      expect(response.status).toBe(403);
      expect(await response.json()).toMatchObject({
        kind: "organization_seat_required",
      });
    });

    it("is refused when the grant was revoked", async () => {
      taskScheduleTestDb.vendorGrantStatus = "REVOKED";

      const response = await post(
        { name: "Weekly report", rule: WEEKLY_RULE },
        createTaskScheduleTestApp(mountPostTaskSchedule, COWORKER_AUTH),
      );

      expect(response.status).toBe(403);
      expect(await response.json()).toMatchObject({ kind: "grant_revoked" });
    });
  });

  it("refuses Soko Bot actors", async () => {
    const response = await post(
      { name: "Weekly report", rule: WEEKLY_RULE },
      createTaskScheduleTestApp(mountPostTaskSchedule, SOKO_BOT_AUTH),
    );

    expect(response.status).toBe(403);
  });
});
