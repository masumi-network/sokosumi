import { TaskScheduleEndsMode, TaskStatus } from "@sokosumi/database";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  migratedTaskScheduleId,
  shimCreateOperationId,
} from "@/helpers/legacy-task-schedule-id";
import {
  COWORKER_AUTH,
  COWORKER_ID,
  MEMBER_ID,
  PROJECT_ID,
  resetTaskScheduleTestDb,
  seedTask,
  seedTaskSchedule,
  taskScheduleTestDb,
  taskScheduleTestPrisma,
  userAuth,
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
    schedule: {
      mode: string;
      expr: string;
      endsMode: string;
      occurrences?: number | null;
    };
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
      expect(await response.json()).toMatchObject({
        replacement: "POST /v1/tasks/schedules",
      });
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

    it("resolves the schedule the cutover minted for a template Task id", async () => {
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

    it("answers 404 for a non-UUID id without querying it as a schedule id", async () => {
      const response = await send("GET", "/tsk_123/schedule");

      expect(response.status).toBe(404);
      expect(
        taskScheduleTestPrisma.taskSchedule.findFirst,
      ).not.toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: "tsk_123" } }),
      );
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

    it("creates from a Task blueprint, keyed on the Task, and leaves the Task alone", async () => {
      seedTask({
        id: TASK_ID,
        name: "From task",
        description: "Blueprint",
        assigneeId: COWORKER_ID,
      });

      const created = await send("PUT", `/${TASK_ID}/schedule`, WEEKLY);

      expect(created.status).toBe(200);
      const { data } = (await created.json()) as Projection;
      expect(data.name).toBe("From task");
      expect(data.schedule.expr).toBe("0 9 * * 1");
      expect(
        taskScheduleTestDb.tasks.find((row) => row.id === TASK_ID)?.scheduleId,
      ).toBeUndefined();
      expect(taskScheduleTestDb.createOperations).toMatchObject([
        { operationId: shimCreateOperationId(TASK_ID), scheduleId: data.id },
      ]);

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

    it("Serviceplan path: coworker PUT creates, calendar PUT updates, occurrences read", async () => {
      seedTask({
        id: TASK_ID,
        name: "Weekly content",
        assigneeId: COWORKER_ID,
      });
      const coworkerApp = app(COWORKER_AUTH);

      const created = await send(
        "PUT",
        `/${TASK_ID}/schedule`,
        WEEKLY,
        coworkerApp,
      );
      expect(created.status).toBe(200);
      const { data: createdData } = (await created.json()) as Projection;
      expect(taskScheduleTestDb.schedules[0]).toMatchObject({
        id: createdData.id,
        creatorCoworkerId: COWORKER_ID,
      });

      const updated = await send(
        "PUT",
        `/${TASK_ID}/calendar-schedule`,
        {
          expectedScheduleRevision: createdData.scheduleRevision,
          discardFutureExceptions: true,
          schedule: { mode: "recurring", expr: "0 8 * * 1", timezone: "UTC" },
        },
        coworkerApp,
      );
      expect(updated.status).toBe(200);
      const { data: updatedData } = (await updated.json()) as Projection;
      expect(updatedData.id).toBe(createdData.id);
      expect(updatedData.schedule.expr).toBe("0 8 * * 1");

      const reads = await send(
        "GET",
        `/${TASK_ID}/schedule/occurrences`,
        undefined,
        coworkerApp,
      );
      expect(reads.status).toBe(200);
      const body = (await reads.json()) as { data: { id: string }[] };
      expect(body.data.length).toBeGreaterThan(0);
    });

    it("answers 404 when the Task is missing", async () => {
      const response = await send("PUT", `/${TASK_ID}/schedule`, WEEKLY);

      expect(response.status).toBe(404);
    });

    it.each([
      ["another member's Task", { ownerId: MEMBER_ID }],
      [
        "another member's private Task",
        { ownerId: MEMBER_ID, visibility: "PRIVATE" as const },
      ],
      ["an archived Task", { archivedAt: new Date("2026-09-24T12:00:00Z") }],
    ])("answers 404 on %s and creates nothing", async (_label, overrides) => {
      seedTask({ id: TASK_ID, name: "Not yours", ...overrides });

      const response = await send("PUT", `/${TASK_ID}/schedule`, WEEKLY);

      expect(response.status).toBe(404);
      expect(taskScheduleTestDb.schedules).toHaveLength(0);
      expect(taskScheduleTestDb.createOperations).toHaveLength(0);
    });

    it("answers 403 to a Coworker on a Task it did not create and is not assigned", async () => {
      seedTask({ id: TASK_ID, name: "Someone else's", assigneeId: null });

      const response = await send(
        "PUT",
        `/${TASK_ID}/schedule`,
        WEEKLY,
        app(COWORKER_AUTH),
      );

      expect(response.status).toBe(403);
      expect(taskScheduleTestDb.schedules).toHaveLength(0);
    });

    it("answers 403 on a parked Task", async () => {
      seedTask({
        id: TASK_ID,
        name: "Parked",
        status: TaskStatus.GRANT_PENDING,
      });

      const response = await send("PUT", `/${TASK_ID}/schedule`, WEEKLY);

      expect(response.status).toBe(403);
      expect(taskScheduleTestDb.schedules).toHaveLength(0);
    });

    it("rejects a Task assigned to a person with 422", async () => {
      seedTask({
        id: TASK_ID,
        name: "For a person",
        assigneeId: null,
        assigneeUserId: MEMBER_ID,
      });

      const response = await send("PUT", `/${TASK_ID}/schedule`, WEEKLY);

      expect(response.status).toBe(422);
      expect(await response.json()).toMatchObject({
        replacement: "POST /v1/tasks/schedules",
      });
      expect(taskScheduleTestDb.schedules).toHaveLength(0);
    });

    it("replays the first schedule when a racing PUT misses it and creates again", async () => {
      seedTask({ id: TASK_ID, name: "Weekly content" });
      const first = await send("PUT", `/${TASK_ID}/schedule`, WEEKLY);
      const { data: firstData } = (await first.json()) as Projection;
      // The racing request resolved before the first one committed.
      taskScheduleTestPrisma.taskScheduleCreateOperation.findFirst.mockResolvedValueOnce(
        null,
      );

      const second = await send("PUT", `/${TASK_ID}/schedule`, WEEKLY);

      expect(second.status).toBe(200);
      const { data } = (await second.json()) as Projection;
      expect(data.id).toBe(firstData.id);
      expect(taskScheduleTestDb.schedules).toHaveLength(1);
    });

    it("keeps the schedule as it is when the same rule is re-sent", async () => {
      seedTask({ id: TASK_ID, name: "Weekly content" });
      const created = await send("PUT", `/${TASK_ID}/schedule`, WEEKLY);
      const { data: createdData } = (await created.json()) as Projection;
      const epochId = taskScheduleTestDb.schedules[0]?.epochId;

      const resent = await send("PUT", `/${TASK_ID}/schedule`, WEEKLY);

      expect(resent.status).toBe(200);
      const { data } = (await resent.json()) as Projection;
      expect(data.scheduleRevision).toBe(createdData.scheduleRevision);
      expect(taskScheduleTestDb.schedules[0]?.epochId).toBe(epochId);
    });

    it("answers 403 to a reader re-sending the rule of a schedule it cannot write", async () => {
      const schedule = seedTaskSchedule();

      const response = await send(
        "PUT",
        `/${schedule.id}/schedule`,
        WEEKLY,
        app(userAuth(MEMBER_ID)),
      );

      expect(response.status).toBe(403);
    });

    it("counts occurrences from the Runs already released", async () => {
      const schedule = seedTaskSchedule({
        endsMode: TaskScheduleEndsMode.AFTER,
        targetRunCount: 5,
        releasedCount: 3,
      });

      const response = await send("PUT", `/${schedule.id}/schedule`, {
        ...WEEKLY,
        endsMode: "after",
        occurrences: 4,
      });

      expect(response.status).toBe(200);
      const { data } = (await response.json()) as Projection;
      expect(data.schedule.occurrences).toBe(4);
      expect(taskScheduleTestDb.schedules[0]?.targetRunCount).toBe(7);
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

  describe("DELETE /{id}/schedule stays 410", () => {
    it("answers 410 task_schedule_moved", async () => {
      const response = await send("DELETE", `/${TASK_ID}/schedule`);

      expect(response.status).toBe(410);
      expect(await response.json()).toMatchObject({
        kind: "task_schedule_moved",
        replacement: "DELETE /v1/tasks/schedules/{id}",
      });
    });
  });

  describe("occurrences", () => {
    it("GET lists Runs of the schedule created via PUT /{id}/schedule", async () => {
      seedTask({
        id: TASK_ID,
        name: "From task",
        assigneeId: COWORKER_ID,
      });
      const created = await send("PUT", `/${TASK_ID}/schedule`, WEEKLY);
      expect(created.status).toBe(200);

      const response = await send("GET", `/${TASK_ID}/schedule/occurrences`);

      expect(response.status).toBe(200);
      const body = (await response.json()) as {
        data: { id: string; state: string }[];
      };
      expect(body.data.length).toBeGreaterThan(0);
      expect(body.data[0]?.state).toBeDefined();
    });

    it("PATCH occurrence stays 410", async () => {
      const response = await send(
        "PATCH",
        `/${TASK_ID}/schedule/occurrences/occ_1`,
        {},
      );

      expect(response.status).toBe(410);
      expect(await response.json()).toMatchObject({
        error: "Gone",
        kind: "task_schedule_moved",
        replacement: "PATCH /v1/tasks/schedules/{id}/runs/{runId}",
      });
    });
  });

  describe("after EOD 2026-09-29 CEST", () => {
    afterEach(() => {
      vi.useRealTimers();
    });

    it("answers 410 on PUT /{id}/schedule even when the flag is on", async () => {
      vi.useFakeTimers({ toFake: ["Date"] });
      vi.setSystemTime(new Date("2026-09-29T22:00:00.000Z"));
      process.env.LEGACY_TASK_SCHEDULE_SHIM = "1";
      seedTask({
        id: TASK_ID,
        name: "Weekly content",
        assigneeId: COWORKER_ID,
      });

      const response = await send("PUT", `/${TASK_ID}/schedule`, WEEKLY);

      expect(response.status).toBe(410);
      expect(await response.json()).toMatchObject({
        kind: "task_schedule_moved",
        replacement: "POST /v1/tasks/schedules",
      });
    });
  });

  describe("when LEGACY_TASK_SCHEDULE_SHIM is off", () => {
    beforeEach(() => {
      process.env.LEGACY_TASK_SCHEDULE_SHIM = "0";
    });

    it("answers 410, not 422, to an invalid body", async () => {
      const response = await send("PUT", `/${TASK_ID}/schedule`, {
        version: 2,
      });

      expect(response.status).toBe(410);
      expect(await response.json()).toMatchObject({
        kind: "task_schedule_moved",
      });
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
        "GET",
        `/${TASK_ID}/schedule/occurrences`,
        undefined,
        "GET /v1/tasks/schedules/{id}/runs",
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
