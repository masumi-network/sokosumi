import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { migratedTaskScheduleId } from "@/helpers/legacy-task-schedule-id";
import { shimCreatedTaskScheduleId } from "@/helpers/legacy-task-schedule-shim";
import {
  COWORKER_AUTH,
  COWORKER_ID,
  MEMBER_ID,
  PROJECT_ID,
  resetTaskScheduleTestDb,
  seedTask,
  seedTaskSchedule,
  taskScheduleTestDb,
} from "@/test-fixtures/task-schedule";
import {
  createTaskScheduleTestApp,
  jsonRequest,
} from "@/test-fixtures/task-schedule-app";

import mount from "./moved-schedule-routes";

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

const TASK_ID = "01960001-0001-7001-8001-0000000000f1";
const WEEKLY = {
  mode: "recurring" as const,
  expr: "0 9 * * 1",
  timezone: "UTC",
};
const CREATE_BODY = {
  source: { type: "workspace" as const },
  name: "Weekly report",
  assigneeId: COWORKER_ID,
  schedule: WEEKLY,
};

function app(
  auth = undefined as Parameters<typeof createTaskScheduleTestApp>[1],
) {
  return createTaskScheduleTestApp(mount, auth);
}

function send(method: string, path: string, body?: unknown, testApp = app()) {
  return testApp.request(`http://localhost${path}`, jsonRequest(method, body));
}

type Projection = {
  data: {
    id: string;
    scheduleId: string;
    name: string;
    nextRunAt: string | null;
    scheduleRevision: number;
    schedule: { mode: string; expr: string; endsMode: string };
  };
};

describe("legacy per-Task schedule shim", () => {
  const originalFlag = process.env.LEGACY_TASK_SCHEDULE_SHIM;

  beforeEach(() => {
    resetTaskScheduleTestDb();
    process.env.LEGACY_TASK_SCHEDULE_SHIM = "1";
  });

  afterEach(() => {
    if (originalFlag === undefined) {
      delete process.env.LEGACY_TASK_SCHEDULE_SHIM;
    } else {
      process.env.LEGACY_TASK_SCHEDULE_SHIM = originalFlag;
    }
  });

  describe("POST /scheduled", () => {
    it("creates a Task Schedule and returns a legacy projection", async () => {
      const response = await send("POST", "/scheduled", CREATE_BODY);

      expect(response.status).toBe(201);
      const { data } = (await response.json()) as Projection;
      expect(data).toMatchObject({
        id: data.scheduleId,
        name: "Weekly report",
        scheduleRevision: 0,
        schedule: { mode: "recurring", expr: "0 9 * * 1", endsMode: "never" },
      });
      expect(data.nextRunAt).toBeTruthy();
      expect(taskScheduleTestDb.schedules).toHaveLength(1);
      expect(taskScheduleTestDb.schedules[0]?.id).toBe(data.id);
    });

    it("creates as a Coworker vendor in a granted workspace", async () => {
      const response = await send(
        "POST",
        "/scheduled",
        CREATE_BODY,
        app(COWORKER_AUTH),
      );

      expect(response.status).toBe(201);
      expect(taskScheduleTestDb.schedules[0]).toMatchObject({
        creatorCoworkerId: COWORKER_ID,
        assigneeId: COWORKER_ID,
      });
    });

    it("rejects once-mode with 422 pointing at runAt on POST /v1/tasks", async () => {
      const response = await send("POST", "/scheduled", {
        source: { type: "workspace" },
        name: "One shot",
        schedule: { mode: "once", runAt: "2030-01-01T09:00:00.000Z" },
      });

      expect(response.status).toBe(422);
      expect(await response.json()).toMatchObject({
        replacement: "POST /v1/tasks",
      });
      expect(taskScheduleTestDb.schedules).toHaveLength(0);
    });

    it("rejects a person assignee with 422 pointing at the new create route", async () => {
      const response = await send("POST", "/scheduled", {
        ...CREATE_BODY,
        assigneeId: undefined,
        assigneeUserId: MEMBER_ID,
      });

      expect(response.status).toBe(422);
      expect(await response.json()).toMatchObject({
        replacement: "POST /v1/tasks/schedules",
      });
      expect(taskScheduleTestDb.schedules).toHaveLength(0);
    });

    it("rejects an untyped legacy payload with 422", async () => {
      const response = await send("POST", "/scheduled", {
        source: { type: "workspace" },
        name: "Weekly report",
        schedule: { version: 2, expr: "0 9 * * 1" },
      });

      expect(response.status).toBe(422);
      expect(taskScheduleTestDb.schedules).toHaveLength(0);
    });
  });

  describe("GET /{id}/schedule", () => {
    it("reads the schedule created via POST /scheduled", async () => {
      const created = await send("POST", "/scheduled", CREATE_BODY);
      const { data: createdData } = (await created.json()) as Projection;

      const response = await send("GET", `/${createdData.id}/schedule`);

      expect(response.status).toBe(200);
      const { data } = (await response.json()) as Projection;
      expect(data.id).toBe(createdData.id);
      expect(data.schedule.expr).toBe("0 9 * * 1");
    });

    it("resolves a Task by scheduleId", async () => {
      const schedule = seedTaskSchedule({ name: "From task" });
      seedTask({ id: TASK_ID, scheduleId: schedule.id, name: "Child" });

      const response = await send("GET", `/${TASK_ID}/schedule`);

      expect(response.status).toBe(200);
      const { data } = (await response.json()) as Projection;
      expect(data.id).toBe(schedule.id);
    });

    it("resolves a cutover template Task id after the template row is gone", async () => {
      const schedule = seedTaskSchedule({
        id: migratedTaskScheduleId(TASK_ID),
        name: "Migrated",
      });

      const response = await send("GET", `/${TASK_ID}/schedule`);

      expect(response.status).toBe(200);
      const { data } = (await response.json()) as Projection;
      expect(data.id).toBe(schedule.id);
    });

    it("answers 404 when no schedule is linked", async () => {
      const response = await send("GET", `/${TASK_ID}/schedule`);

      expect(response.status).toBe(404);
    });
  });

  describe("PUT /{id}/schedule", () => {
    it("updates an existing schedule by schedule id", async () => {
      const created = await send("POST", "/scheduled", CREATE_BODY);
      const { data: createdData } = (await created.json()) as Projection;

      const response = await send("PUT", `/${createdData.id}/schedule`, {
        mode: "recurring",
        expr: "0 10 * * 1",
        timezone: "UTC",
      });

      expect(response.status).toBe(200);
      const { data } = (await response.json()) as Projection;
      expect(data.schedule.expr).toBe("0 10 * * 1");
      expect(data.scheduleRevision).toBeGreaterThan(
        createdData.scheduleRevision,
      );
    });

    it("creates from a Task blueprint and a later PUT finds the shim id", async () => {
      seedTask({
        id: TASK_ID,
        name: "From task",
        description: "Blueprint",
        assigneeId: COWORKER_ID,
      });

      const created = await send("PUT", `/${TASK_ID}/schedule`, WEEKLY);

      expect(created.status).toBe(200);
      const { data } = (await created.json()) as Projection;
      expect(data.id).toBe(shimCreatedTaskScheduleId(TASK_ID));
      expect(data.name).toBe("From task");
      expect(data.schedule.expr).toBe("0 9 * * 1");

      const updated = await send("PUT", `/${TASK_ID}/schedule`, {
        mode: "recurring",
        expr: "0 11 * * 1",
        timezone: "UTC",
      });
      expect(updated.status).toBe(200);
      const { data: updatedData } = (await updated.json()) as Projection;
      expect(updatedData.id).toBe(data.id);
      expect(updatedData.schedule.expr).toBe("0 11 * * 1");
      expect(taskScheduleTestDb.schedules).toHaveLength(1);
    });

    it("answers 404 when the Task is missing", async () => {
      const response = await send("PUT", `/${TASK_ID}/schedule`, WEEKLY);

      expect(response.status).toBe(404);
    });

    it("rejects once-mode with 422", async () => {
      const response = await send("PUT", `/${TASK_ID}/schedule`, {
        mode: "once",
        runAt: "2030-01-01T09:00:00.000Z",
      });

      expect(response.status).toBe(422);
      expect(await response.json()).toMatchObject({
        replacement: "POST /v1/tasks",
      });
    });
  });

  describe("calendar PUT", () => {
    it("replaces the rule via PUT /{id}/calendar-schedule", async () => {
      const created = await send("POST", "/scheduled", CREATE_BODY);
      const { data: createdData } = (await created.json()) as Projection;

      const response = await send(
        "PUT",
        `/${createdData.id}/calendar-schedule`,
        {
          expectedScheduleRevision: createdData.scheduleRevision,
          discardFutureExceptions: true,
          schedule: { mode: "recurring", expr: "0 12 * * 1", timezone: "UTC" },
        },
      );

      expect(response.status).toBe(200);
      const { data } = (await response.json()) as Projection;
      expect(data.schedule.expr).toBe("0 12 * * 1");
    });

    it("moves the project via PUT /{id}/calendar-source", async () => {
      const created = await send("POST", "/scheduled", CREATE_BODY);
      const { data: createdData } = (await created.json()) as Projection;

      const response = await send("PUT", `/${createdData.id}/calendar-source`, {
        expectedScheduleRevision: createdData.scheduleRevision,
        discardFutureExceptions: true,
        source: { type: "project", projectId: PROJECT_ID },
      });

      expect(response.status).toBe(200);
      expect(taskScheduleTestDb.schedules[0]?.projectId).toBe(PROJECT_ID);
    });

    it("rejects once-mode on calendar-schedule with 422", async () => {
      const response = await send("PUT", `/${TASK_ID}/calendar-schedule`, {
        expectedScheduleRevision: 0,
        discardFutureExceptions: true,
        schedule: { mode: "once", runAt: "2030-01-01T09:00:00.000Z" },
      });

      expect(response.status).toBe(422);
      expect(await response.json()).toMatchObject({
        replacement: "POST /v1/tasks",
      });
    });
  });

  describe("DELETE /{id}/schedule", () => {
    it("deletes the linked Task Schedule", async () => {
      const created = await send("POST", "/scheduled", CREATE_BODY);
      const { data } = (await created.json()) as Projection;

      const response = await send("DELETE", `/${data.id}/schedule`);

      expect(response.status).toBe(204);
      expect(taskScheduleTestDb.schedules).toHaveLength(0);
    });
  });

  describe("occurrences stay 410", () => {
    it.each([
      [
        "GET",
        `/${TASK_ID}/schedule/occurrences`,
        "GET /v1/tasks/schedules/{id}/runs",
      ],
      [
        "PATCH",
        `/${TASK_ID}/schedule/occurrences/occ_1`,
        "PATCH /v1/tasks/schedules/{id}/runs/{runId}",
      ],
    ])(
      "%s %s answers 410 task_schedule_moved",
      async (method, path, replacement) => {
        const response = await send(
          method,
          path,
          method === "GET" ? undefined : {},
        );

        expect(response.status).toBe(410);
        expect(await response.json()).toMatchObject({
          error: "Gone",
          kind: "task_schedule_moved",
          replacement,
        });
      },
    );
  });

  describe("when LEGACY_TASK_SCHEDULE_SHIM is off", () => {
    beforeEach(() => {
      process.env.LEGACY_TASK_SCHEDULE_SHIM = "0";
    });

    it.each([
      ["POST", "/scheduled", CREATE_BODY, "POST /v1/tasks/schedules"],
      ["PUT", `/${TASK_ID}/schedule`, WEEKLY, "POST /v1/tasks/schedules"],
      [
        "GET",
        `/${TASK_ID}/schedule`,
        undefined,
        "GET /v1/tasks/schedules/{id}",
      ],
      [
        "DELETE",
        `/${TASK_ID}/schedule`,
        undefined,
        "DELETE /v1/tasks/schedules/{id}",
      ],
      [
        "PUT",
        `/${TASK_ID}/calendar-schedule`,
        {
          expectedScheduleRevision: 0,
          discardFutureExceptions: true,
          schedule: WEEKLY,
        },
        "PATCH /v1/tasks/schedules/{id}",
      ],
      [
        "PUT",
        `/${TASK_ID}/calendar-source`,
        {
          expectedScheduleRevision: 0,
          discardFutureExceptions: true,
          source: { type: "workspace" },
        },
        "PATCH /v1/tasks/schedules/{id}",
      ],
    ])(
      "%s %s answers 410 task_schedule_moved pointing to %s",
      async (method, path, body, replacement) => {
        const response = await send(method, path, body);

        expect(response.status).toBe(410);
        expect(await response.json()).toMatchObject({
          error: "Gone",
          kind: "task_schedule_moved",
          replacement,
        });
      },
    );
  });
});
