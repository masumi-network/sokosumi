import {
  TaskScheduleEndsMode,
  TaskScheduleState,
  TaskStatus,
} from "@sokosumi/database";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { OpenAPIHonoWithAuth } from "@/lib/hono";
import {
  COWORKER_AUTH,
  COWORKER_ID,
  MEMBER_ID,
  PERSONAL_WORKSPACE_ID,
  resetTaskScheduleTestDb,
  seedTask,
  seedTaskSchedule,
  taskScheduleTestDb,
  taskScheduleTestPrisma,
  userAuth,
  VENDOR_ID,
} from "@/test-fixtures/task-schedule";
import {
  createTaskScheduleTestApp,
  jsonRequest,
} from "@/test-fixtures/task-schedule-app";

import mountMovedTaskScheduleRoutes from "../moved-schedule-routes";
import { migratedTaskScheduleId, shimCreateOperationId } from "./ids";
import mountLegacyVendorSchedules from "./index";

function mount(app: OpenAPIHonoWithAuth) {
  mountLegacyVendorSchedules(app);
  mountMovedTaskScheduleRoutes(app);
}

const { logSet } = vi.hoisted(() => ({ logSet: vi.fn() }));
vi.mock("@/lib/evlog", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/evlog")>()),
  tryUseLogger: () => ({ set: logSet }),
}));
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
const HOLD = { mode: "once" as const, runAt: "2099-12-31T23:59:00.000Z" };
const RUN_AT = "2030-01-01T09:00:00.000Z";

/** A Task as the vendor creates it before the PUT: a Draft for its Coworker. */
function seedBlueprint(overrides: Parameters<typeof seedTask>[0] = {}) {
  const createdAt = new Date(Date.now() - 60_000);
  return seedTask({
    id: TASK_ID,
    name: "Weekly content",
    description: "The brief",
    status: TaskStatus.DRAFT,
    visibility: "PUBLIC",
    projectId: null,
    createdAt,
    updatedAt: createdAt,
    ...overrides,
  });
}

function app(auth = COWORKER_AUTH) {
  return createTaskScheduleTestApp(mount, auth);
}

function put(body: unknown, id = TASK_ID, testApp = app()) {
  return testApp.request(
    `http://localhost/${id}/schedule`,
    jsonRequest("PUT", body),
  );
}

interface View {
  data: {
    id: string;
    scheduleId: string | null;
    status: string;
    metadata: string | null;
    nextRunAt: string | null;
    runAt: string | null;
    scheduleRevision: number;
  };
}

async function view(response: Response) {
  const { data } = (await response.json()) as View;
  return { ...data, spec: data.metadata ? JSON.parse(data.metadata) : null };
}

describe("legacy PUT /{id}/schedule", () => {
  beforeEach(() => {
    resetTaskScheduleTestDb();
    process.env.LEGACY_TASK_SCHEDULE_VENDOR_IDS = VENDOR_ID;
  });

  afterEach(() => {
    delete process.env.LEGACY_TASK_SCHEDULE_VENDOR_IDS;
    vi.useRealTimers();
  });

  describe("outside the listed vendors", () => {
    it.each([
      ["a person", userAuth()],
      ["an unlisted vendor's Coworker", COWORKER_AUTH],
    ])("answers 410 to %s", async (label, auth) => {
      if (label.includes("unlisted")) {
        process.env.LEGACY_TASK_SCHEDULE_VENDOR_IDS = "another-vendor";
      }
      seedBlueprint();

      const response = await put(WEEKLY, TASK_ID, app(auth));

      expect(response.status).toBe(410);
      expect(await response.json()).toMatchObject({
        kind: "task_schedule_moved",
        replacement: "POST /v1/tasks/schedules",
      });
      expect(taskScheduleTestDb.schedules).toHaveLength(0);
    });

    it("answers 410, not 422, to an invalid body", async () => {
      const response = await put({ version: 2 }, TASK_ID, app(userAuth()));

      expect(response.status).toBe(410);
    });

    it("answers 410 after EOD 2026-09-29 CEST", async () => {
      vi.useFakeTimers({ toFake: ["Date"] });
      vi.setSystemTime(new Date("2026-09-29T22:00:00.000Z"));
      seedBlueprint();

      const response = await put(WEEKLY);

      expect(response.status).toBe(410);
    });
  });

  it.each([
    ["POST", "/scheduled", "POST /v1/tasks/schedules"],
    ["DELETE", `/${TASK_ID}/schedule`, "DELETE /v1/tasks/schedules/{id}"],
    ["PUT", `/${TASK_ID}/calendar-schedule`, "PATCH /v1/tasks/schedules/{id}"],
  ])(
    "%s %s stays 410 even for a listed vendor",
    async (method, path, replacement) => {
      const response = await app().request(
        `http://localhost${path}`,
        jsonRequest(method, method === "DELETE" ? undefined : {}),
      );

      expect(response.status).toBe(410);
      expect(await response.json()).toMatchObject({
        kind: "task_schedule_moved",
        replacement,
      });
    },
  );

  describe("recurring", () => {
    it("makes a schedule of the Task, keyed on it, and shows it as the old template", async () => {
      seedBlueprint();

      const response = await put(WEEKLY);

      expect(response.status).toBe(200);
      const data = await view(response);
      expect(data).toMatchObject({
        id: TASK_ID,
        status: "QUEUED",
        spec: { mode: "recurring", expr: "0 9 * * 1", endsMode: "never" },
      });
      expect(data.nextRunAt).toBeTruthy();
      expect(taskScheduleTestDb.schedules[0]).toMatchObject({
        id: data.scheduleId,
        name: "Weekly content",
        description: "The brief",
        creatorCoworkerId: COWORKER_ID,
      });
      expect(taskScheduleTestDb.createOperations).toMatchObject([
        {
          operationId: shimCreateOperationId(TASK_ID),
          scheduleId: data.scheduleId,
        },
      ]);
      expect(taskScheduleTestDb.tasks[0]).toMatchObject({
        status: TaskStatus.DRAFT,
      });
      expect(logSet).toHaveBeenCalledWith({
        legacyTaskScheduleShim: expect.objectContaining({
          path: "/v1/tasks/{id}/schedule",
          vendorId: VENDOR_ID,
        }),
      });
    });

    it("changes the rule on a later PUT and keeps it on an identical one", async () => {
      seedBlueprint();
      const created = await view(await put(WEEKLY));
      const epochId = taskScheduleTestDb.schedules[0]?.epochId;

      const resent = await view(await put(WEEKLY));
      expect(resent.scheduleRevision).toBe(created.scheduleRevision);
      expect(taskScheduleTestDb.schedules[0]?.epochId).toBe(epochId);

      const changed = await view(await put({ ...WEEKLY, expr: "0 10 * * 1" }));
      expect(changed.spec.expr).toBe("0 10 * * 1");
      expect(taskScheduleTestDb.schedules).toHaveLength(1);
    });

    it("reads an `M H */N * *` cron as every N days, as the old release did", async () => {
      seedBlueprint();
      const everyThirdDay = { ...WEEKLY, expr: "0 9 */3 * *" };

      const created = await view(await put(everyThirdDay));

      expect(taskScheduleTestDb.schedules[0]?.intervalDays).toBe(3);
      const resent = await view(await put(everyThirdDay));
      expect(resent.scheduleRevision).toBe(created.scheduleRevision);
    });

    it("counts occurrences from the Runs already released", async () => {
      const schedule = seedTaskSchedule({
        creatorCoworkerId: COWORKER_ID,
        endsMode: TaskScheduleEndsMode.AFTER,
        targetRunCount: 5,
        releasedCount: 3,
      });

      const data = await view(
        await put(
          { ...WEEKLY, endsMode: "after", occurrences: 4 },
          schedule.id,
        ),
      );

      expect(data.spec.occurrences).toBe(4);
      expect(taskScheduleTestDb.schedules[0]?.targetRunCount).toBe(7);
    });

    it("finds the schedule the cutover made from a template Task", async () => {
      const schedule = seedTaskSchedule({
        id: migratedTaskScheduleId(TASK_ID),
        creatorCoworkerId: COWORKER_ID,
      });

      const data = await view(await put({ ...WEEKLY, expr: "0 7 * * 1" }));

      expect(data).toMatchObject({ id: TASK_ID, scheduleId: schedule.id });
      expect(taskScheduleTestDb.schedules[0]?.expr).toBe("0 7 * * 1");
    });

    it("replays the first schedule when a racing PUT misses it and creates again", async () => {
      seedBlueprint();
      const first = await view(await put(WEEKLY));
      // The racing request resolved before the first one committed.
      taskScheduleTestPrisma.taskScheduleCreateOperation.findUnique.mockResolvedValueOnce(
        null,
      );

      const second = await view(await put(WEEKLY));

      expect(second.scheduleId).toBe(first.scheduleId);
      expect(taskScheduleTestDb.schedules).toHaveLength(1);
    });

    it("ignores a create ledger row another workspace keyed on the same Task id", async () => {
      const foreign = seedTaskSchedule({
        workspaceId: PERSONAL_WORKSPACE_ID,
        organizationId: null,
      });
      taskScheduleTestDb.createOperations.push({
        id: "op_foreign",
        createdAt: new Date(),
        workspaceId: PERSONAL_WORKSPACE_ID,
        operationId: shimCreateOperationId(TASK_ID),
        requestFingerprint: "foreign",
        scheduleId: foreign.id,
      });
      seedBlueprint();

      const data = await view(await put(WEEKLY));

      expect(data.scheduleId).not.toBe(foreign.id);
    });

    it("rejects a Task that already starts once", async () => {
      seedBlueprint({ status: TaskStatus.QUEUED, runAt: new Date(RUN_AT) });

      const response = await put(WEEKLY);

      expect(response.status).toBe(422);
      expect(taskScheduleTestDb.schedules).toHaveLength(0);
    });
  });

  describe("pause and resume", () => {
    it("pauses on the hold and resumes when the rule is sent again", async () => {
      seedBlueprint();
      await put(WEEKLY);

      const paused = await view(await put(HOLD));
      expect(taskScheduleTestDb.schedules[0]?.state).toBe(
        TaskScheduleState.PAUSED,
      );
      expect(paused).toMatchObject({
        id: TASK_ID,
        status: "QUEUED",
        spec: HOLD,
        nextRunAt: HOLD.runAt,
      });

      const resumed = await view(await put(WEEKLY));
      expect(taskScheduleTestDb.schedules[0]?.state).toBe(
        TaskScheduleState.ACTIVE,
      );
      expect(resumed.spec.mode).toBe("recurring");
    });

    it("rejects turning a repeating job into a one-time one", async () => {
      seedBlueprint();
      await put(WEEKLY);

      const response = await put({ mode: "once", runAt: RUN_AT });

      expect(response.status).toBe(422);
      expect(await response.json()).toMatchObject({
        replacement: "POST /v1/tasks",
      });
    });
  });

  describe("once", () => {
    it("starts the Task itself once at runAt", async () => {
      seedBlueprint();

      const data = await view(await put({ mode: "once", runAt: RUN_AT }));

      expect(data).toMatchObject({
        id: TASK_ID,
        status: "QUEUED",
        runAt: RUN_AT,
        nextRunAt: RUN_AT,
        spec: { mode: "once", runAt: RUN_AT },
      });
      expect(taskScheduleTestDb.tasks[0]).toMatchObject({
        status: TaskStatus.QUEUED,
        runAt: new Date(RUN_AT),
      });
      expect(taskScheduleTestDb.schedules).toHaveLength(0);
    });

    it("parks a one-time Task on the hold", async () => {
      seedBlueprint({ status: TaskStatus.QUEUED, runAt: new Date(RUN_AT) });

      const data = await view(await put(HOLD));

      expect(data.spec).toEqual(HOLD);
      expect(taskScheduleTestDb.tasks[0]?.runAt).toEqual(new Date(HOLD.runAt));
    });
  });

  describe("the Task a PUT schedules", () => {
    it.each([
      ["another member's Task", { ownerId: MEMBER_ID }],
      [
        "another member's private Task",
        { ownerId: MEMBER_ID, visibility: "PRIVATE" as const },
      ],
      ["an archived Task", { archivedAt: new Date("2026-09-24T12:00:00Z") }],
    ])("answers 404 on %s", async (_label, overrides) => {
      seedBlueprint(overrides);

      const response = await put(WEEKLY);

      expect(response.status).toBe(404);
      expect(taskScheduleTestDb.schedules).toHaveLength(0);
    });

    it.each([
      ["one the Coworker neither made nor is assigned", { assigneeId: null }],
      ["one that already started", { status: TaskStatus.RUNNING }],
      ["a parked one", { status: TaskStatus.GRANT_PENDING }],
    ])("answers 403 on %s", async (_label, overrides) => {
      seedBlueprint(overrides);

      const response = await put(WEEKLY);

      expect(response.status).toBe(403);
      expect(taskScheduleTestDb.schedules).toHaveLength(0);
    });

    it("rejects one assigned to a person with 422", async () => {
      seedBlueprint({
        assigneeId: null,
        assigneeUserId: MEMBER_ID,
        creatorCoworkerId: COWORKER_ID,
      });

      const response = await put(WEEKLY);

      expect(response.status).toBe(422);
    });

    it("answers 404 for a non-UUID id", async () => {
      const response = await put(WEEKLY, "tsk_123");

      expect(response.status).toBe(404);
    });

    it("answers 422 with the new route to an untyped body", async () => {
      const response = await put({ version: 2, expr: "0 9 * * 1" });

      expect(response.status).toBe(422);
      expect(await response.json()).toMatchObject({
        replacement: "POST /v1/tasks/schedules",
      });
    });
  });
});
