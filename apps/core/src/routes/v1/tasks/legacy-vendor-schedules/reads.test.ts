import { TaskScheduleState, TaskStatus } from "@sokosumi/database";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ok } from "@/helpers/response";
import type { OpenAPIHonoWithAuth } from "@/lib/hono";
import type { AuthenticationContext } from "@/middleware/auth";
import {
  COWORKER_AUTH,
  COWORKER_ID,
  resetTaskScheduleTestDb,
  seedTask,
  seedTaskSchedule,
  taskScheduleTestDb,
  userAuth,
  VENDOR_ID,
} from "@/test-fixtures/task-schedule";
import {
  createTaskScheduleTestApp,
  jsonRequest,
} from "@/test-fixtures/task-schedule-app";

import { migratedTaskScheduleId, shimCreateOperationId } from "./ids";
import mountLegacyVendorSchedules from "./index";

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

const BLUEPRINT_ID = "01960001-0001-7001-8001-0000000000f1";
const TEMPLATE_ID = "01960001-0001-7001-8001-0000000000f2";
const RUN_AT = "2030-01-01T09:00:00.000Z";
const SCHEDULE_CREATED_AT = new Date("2026-09-01T08:00:00.000Z");

/** The routes below the layer, as plain stand-ins. */
function mountRoutes(app: OpenAPIHonoWithAuth) {
  mountLegacyVendorSchedules(app);
  app.get("/", (c) =>
    ok(c, [
      { id: "tsk_once", status: TaskStatus.QUEUED, runAt: RUN_AT },
      { id: "tsk_draft", status: TaskStatus.DRAFT, runAt: null },
    ]),
  );
  app.get("/:id/links", (c) => ok(c, []));
  app.get("/:id", (c) =>
    ok(c, { id: c.req.param("id"), status: TaskStatus.QUEUED, runAt: RUN_AT }),
  );
  app.post("/:id/events", (c) =>
    c.json({ data: { passedThrough: true } }, 201),
  );
}

function send(
  method: string,
  path: string,
  auth: AuthenticationContext = COWORKER_AUTH,
  body?: unknown,
) {
  return createTaskScheduleTestApp(mountRoutes, auth).request(
    `http://localhost${path}`,
    jsonRequest(method, body),
  );
}

async function data<T>(response: Response): Promise<T> {
  return ((await response.json()) as { data: T }).data;
}

interface Row {
  id: string;
  status: string;
  metadata?: string | null;
  nextRunAt?: string | null;
}

const specOf = (row: Row | undefined) =>
  row?.metadata ? JSON.parse(row.metadata) : null;

/** A schedule the vendor made with PUT from a Task, as the layer records it. */
function seedShimSchedule(state: TaskScheduleState = TaskScheduleState.ACTIVE) {
  seedTask({
    id: BLUEPRINT_ID,
    status: TaskStatus.DRAFT,
    createdAt: new Date(SCHEDULE_CREATED_AT.getTime() - 1000),
  });
  const schedule = seedTaskSchedule({
    creatorCoworkerId: COWORKER_ID,
    assigneeId: COWORKER_ID,
    createdAt: SCHEDULE_CREATED_AT,
    state,
  });
  taskScheduleTestDb.createOperations.push({
    id: "op_1",
    createdAt: SCHEDULE_CREATED_AT,
    workspaceId: schedule.workspaceId,
    operationId: shimCreateOperationId(BLUEPRINT_ID),
    requestFingerprint: "fingerprint",
    scheduleId: schedule.id,
  });
  return schedule;
}

describe("legacy vendor schedule reads", () => {
  beforeEach(() => {
    resetTaskScheduleTestDb();
    process.env.LEGACY_TASK_SCHEDULE_VENDOR_IDS = VENDOR_ID;
  });

  afterEach(() => {
    delete process.env.LEGACY_TASK_SCHEDULE_VENDOR_IDS;
  });

  describe("GET /?sort=nextRunAt", () => {
    it("lists each live schedule under the id the vendor knows, and one-time Tasks", async () => {
      const shimmed = seedShimSchedule();
      seedTask({
        id: TEMPLATE_ID,
        archivedAt: new Date(),
        createdAt: new Date("2026-06-01T08:00:00.000Z"),
      });
      const migrated = seedTaskSchedule({
        id: migratedTaskScheduleId(TEMPLATE_ID),
        createdAt: new Date("2026-06-01T08:00:00.000Z"),
      });
      const fromUi = seedTaskSchedule({ state: TaskScheduleState.PAUSED });
      seedTaskSchedule({ state: TaskScheduleState.ENDED });
      seedTask({
        id: "tsk_once",
        status: TaskStatus.QUEUED,
        runAt: new Date(RUN_AT),
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      const rows = await data<Row[]>(await send("GET", "/?sort=nextRunAt"));

      const byId = new Map(rows.map((row) => [row.id, row]));
      expect([...byId.keys()].sort()).toEqual(
        [BLUEPRINT_ID, TEMPLATE_ID, fromUi.id, "tsk_once"].sort(),
      );
      expect(byId.get(BLUEPRINT_ID)).toMatchObject({ status: "QUEUED" });
      expect(specOf(byId.get(BLUEPRINT_ID))).toMatchObject({
        mode: "recurring",
        expr: shimmed.expr,
      });
      expect(specOf(byId.get(TEMPLATE_ID))?.mode).toBe("recurring");
      expect(byId.get(TEMPLATE_ID)).toMatchObject({
        scheduleId: migrated.id,
      });
      expect(specOf(byId.get(fromUi.id))).toEqual({
        mode: "once",
        runAt: "2099-12-31T23:59:00.000Z",
      });
      expect(specOf(byId.get("tsk_once"))).toEqual({
        mode: "once",
        runAt: RUN_AT,
      });
    });

    it("passes a person's list through untouched", async () => {
      const rows = await data<Row[]>(
        await send("GET", "/?sort=nextRunAt", userAuth()),
      );

      expect(rows.map((row) => row.id)).toEqual(["tsk_once", "tsk_draft"]);
      expect(rows[0]?.metadata).toBeUndefined();
    });
  });

  it("GET / adds the old once fields to one-time Tasks", async () => {
    const rows = await data<Row[]>(await send("GET", "/"));

    expect(specOf(rows[0])).toEqual({ mode: "once", runAt: RUN_AT });
    expect(rows[0]?.nextRunAt).toBe(RUN_AT);
    expect(rows[1]?.metadata).toBeUndefined();
  });

  describe("GET /{id}", () => {
    it("reads a schedule's Task id as the old template", async () => {
      const schedule = seedShimSchedule();

      const row = await data<Row & { scheduleId: string }>(
        await send("GET", `/${BLUEPRINT_ID}`),
      );

      expect(row).toMatchObject({
        id: BLUEPRINT_ID,
        scheduleId: schedule.id,
        status: "QUEUED",
      });
      expect(specOf(row).expr).toBe(schedule.expr);
    });

    it("passes any other Task through, with the once fields", async () => {
      const row = await data<Row>(await send("GET", "/tsk_other"));

      expect(row.id).toBe("tsk_other");
      expect(row.nextRunAt).toBe(RUN_AT);
    });
  });

  describe("GET /{id}/links", () => {
    it("links a Run's Task to its template with schedule_series", async () => {
      const schedule = seedShimSchedule();
      seedTask({ id: "tsk_run", scheduleId: schedule.id });

      const links = await data<
        Array<{ relation: string; peerTask: { id: string; status: string } }>
      >(await send("GET", "/tsk_run/links"));

      expect(links).toEqual([
        expect.objectContaining({
          relation: "schedule_series",
          peerTask: expect.objectContaining({
            id: BLUEPRINT_ID,
            status: "QUEUED",
          }),
        }),
      ]);
    });

    it("adds nothing to a Task no schedule made", async () => {
      seedTask({ id: "tsk_plain" });

      const links = await data<unknown[]>(
        await send("GET", "/tsk_plain/links"),
      );

      expect(links).toEqual([]);
    });
  });

  describe("POST /{id}/events", () => {
    /** These clients post events with the Coworker key alone. */
    const COWORKER_KEY_ONLY: AuthenticationContext = {
      actor: "coworker",
      coworkerId: COWORKER_ID,
      vendorId: VENDOR_ID,
    };

    it("ends the schedule on CANCELED, after accepting READY", async () => {
      seedShimSchedule();

      const ready = await send(
        "POST",
        `/${BLUEPRINT_ID}/events`,
        COWORKER_KEY_ONLY,
        { status: "READY" },
      );
      expect(ready.status).toBe(201);
      expect(taskScheduleTestDb.schedules[0]?.state).toBe(
        TaskScheduleState.ACTIVE,
      );

      const canceled = await send(
        "POST",
        `/${BLUEPRINT_ID}/events`,
        COWORKER_KEY_ONLY,
        { status: "CANCELED" },
      );
      expect(canceled.status).toBe(201);
      expect(await data(canceled)).toMatchObject({ status: "CANCELED" });
      expect(taskScheduleTestDb.schedules[0]?.state).toBe(
        TaskScheduleState.ENDED,
      );
    });

    it("answers 403 to a Coworker that may not write the schedule", async () => {
      seedShimSchedule();
      taskScheduleTestDb.schedules[0] = {
        ...taskScheduleTestDb.schedules[0]!,
        creatorCoworkerId: null,
        assigneeId: null,
      };

      const response = await send(
        "POST",
        `/${BLUEPRINT_ID}/events`,
        COWORKER_KEY_ONLY,
        { status: "CANCELED" },
      );

      expect(response.status).toBe(403);
      expect(taskScheduleTestDb.schedules[0]?.state).toBe(
        TaskScheduleState.ACTIVE,
      );
    });

    it("passes events on other Tasks, and comments, through", async () => {
      seedShimSchedule();
      seedTask({ id: "tsk_plain" });

      for (const [path, body] of [
        ["/tsk_plain/events", { status: "CANCELED" }],
        [`/${BLUEPRINT_ID}/events`, { comment: "Paused" }],
      ] as const) {
        const response = await send("POST", path, COWORKER_KEY_ONLY, body);
        expect(await data(response)).toEqual({ passedThrough: true });
      }
      expect(taskScheduleTestDb.schedules[0]?.state).toBe(
        TaskScheduleState.ACTIVE,
      );
    });
  });
});
