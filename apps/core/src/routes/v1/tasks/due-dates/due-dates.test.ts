import { TaskStatus } from "@sokosumi/database";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { notFound } from "@/helpers/error";
import { errorHandler } from "@/helpers/error-handler";
import { OpenAPIHonoWithAuth } from "@/lib/hono";
import type { AuthenticationContext } from "@/middleware/auth";

import { MAX_DUE_DATE_MOVES } from "./each-locked-task";
import mountMoveOverdue from "./move-overdue/post";
import mountUndo from "./undo/post";

vi.mock("@/middleware/auth", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/middleware/auth")>();
  const { stubAuthMiddleware } = await import(
    "@/test-fixtures/auth-middleware"
  );
  return { ...actual, authMiddleware: stubAuthMiddleware };
});

const mocks = vi.hoisted(() => ({
  captureException: vi.fn(),
  deliverCalendarInvalidationsNow: vi.fn(),
  findMany: vi.fn(),
  findUniqueOrThrow: vi.fn(),
  lockCalendarScope: vi.fn(),
  requireMutableTaskWriteAccess: vi.fn(),
  transaction: vi.fn(),
  updateMany: vi.fn(),
}));

vi.mock("@sentry/node", () => ({ captureException: mocks.captureException }));
vi.mock("@/helpers/access-control", () => ({
  requireMutableTaskWriteAccess: mocks.requireMutableTaskWriteAccess,
}));
vi.mock("@/helpers/calendar-invalidation", () => ({
  deliverCalendarInvalidationsNow: mocks.deliverCalendarInvalidationsNow,
}));
vi.mock("@/helpers/calendar-locks", () => ({
  lockCalendarScope: mocks.lockCalendarScope,
  lockTaskRows: vi.fn().mockResolvedValue(true),
}));
vi.mock("@/helpers/organization-assigned-seat", () => ({
  requireAssignedOrganizationSeat: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("@/lib/db/prisma", () => ({
  default: {
    task: { findMany: mocks.findMany },
    $transaction: mocks.transaction,
  },
}));

const USER_ID = "user_123";
const WORKSPACE_ID = "11111111-1111-7111-8111-111111111111";
const OTHER_WORKSPACE_ID = "22222222-2222-7222-8222-222222222222";
const VERSION = new Date("2026-11-12T09:30:00.123Z");
const tx = {
  task: {
    updateMany: mocks.updateMany,
    findUniqueOrThrow: mocks.findUniqueOrThrow,
  },
};

/** A Task as the move picks it: id and the due day it had then. */
function picked(id: string) {
  return { id, dueOn: new Date("2026-11-02T00:00:00.000Z") };
}

function task(id: string, workspaceId = WORKSPACE_ID) {
  return {
    id,
    workspaceId,
    projectId: null,
    ownerId: USER_ID,
    organizationId: "org_123",
    dueOn: new Date("2026-11-02T00:00:00.000Z"),
  };
}

function createApp(
  authContext: AuthenticationContext = {
    actor: "user",
    userId: USER_ID,
    organizationId: "org_123",
    role: "user",
  },
) {
  const app = new OpenAPIHonoWithAuth();
  app.onError(errorHandler);
  app.use("*", async (c, next) => {
    c.set("requestId", "req_due_dates_test");
    c.set("isAuthenticated", true);
    c.set("authContext", authContext);
    c.set("workspaceContext", {
      workspaceId: WORKSPACE_ID,
      userId: null,
      organizationId: "org_123",
    });
    return await next();
  });
  mountMoveOverdue(app);
  mountUndo(app);
  return app;
}

function post(path: string, body: unknown, app = createApp()) {
  return app.request(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.transaction.mockImplementation((fn: (client: unknown) => unknown) =>
    fn(tx),
  );
  mocks.lockCalendarScope.mockResolvedValue(true);
  mocks.requireMutableTaskWriteAccess.mockImplementation(
    async (_user: unknown, id: string) => {
      if (id === "tsk_gone") throw notFound("Task not found");
      if (id === "tsk_elsewhere") return task(id, OTHER_WORKSPACE_ID);
      return task(id);
    },
  );
  mocks.updateMany.mockResolvedValue({ count: 1 });
  mocks.findUniqueOrThrow.mockResolvedValue({ updatedAt: VERSION });
});

describe("POST /due-dates/move-overdue", () => {
  it("re-dates the caller's open overdue Tasks and returns their Undo data", async () => {
    mocks.findMany.mockResolvedValue([picked("tsk_a")]);

    const res = await post("/due-dates/move-overdue", {
      today: "2026-11-12",
      to: "2026-11-13",
    });

    expect(res.status).toBe(200);
    expect((await res.json()).data).toEqual({
      moved: [
        { id: "tsk_a", from: "2026-11-02", version: VERSION.toISOString() },
      ],
      skipped: 0,
    });
    const where = mocks.findMany.mock.calls[0]?.[0].where;
    expect(where).toMatchObject({
      workspaceId: WORKSPACE_ID,
      archivedAt: null,
      dueOn: { lt: new Date("2026-11-12T00:00:00.000Z") },
      status: {
        notIn: [
          TaskStatus.COMPLETED,
          TaskStatus.CANCELED,
          TaskStatus.GRANT_PENDING,
        ],
      },
    });
    expect(mocks.findMany.mock.calls[0]?.[0].take).toBe(MAX_DUE_DATE_MOVES);
    // The locked write repeats every selection rule, still overdue
    // included, and pins the day the Task had when picked, so a Task
    // finished, reassigned or re-dated since matches nothing.
    expect(mocks.updateMany).toHaveBeenCalledWith({
      where: {
        AND: [
          where,
          { id: "tsk_a", dueOn: new Date("2026-11-02T00:00:00.000Z") },
        ],
      },
      data: { dueOn: new Date("2026-11-13T00:00:00.000Z") },
    });
    expect(mocks.deliverCalendarInvalidationsNow).toHaveBeenCalledWith(
      WORKSPACE_ID,
    );
  });

  it("skips a Task that stopped being eligible after it was selected", async () => {
    mocks.findMany.mockResolvedValue([picked("tsk_done")]);
    mocks.updateMany.mockResolvedValue({ count: 0 });

    const res = await post("/due-dates/move-overdue", {
      today: "2026-11-12",
      to: "2026-11-13",
    });

    expect((await res.json()).data).toEqual({ moved: [], skipped: 1 });
    expect(mocks.deliverCalendarInvalidationsNow).not.toHaveBeenCalled();
  });

  it("keeps the Tasks it already moved when a later one fails", async () => {
    mocks.findMany.mockResolvedValue([
      picked("tsk_a"),
      picked("tsk_broken"),
      picked("tsk_gone"),
      picked("tsk_elsewhere"),
    ]);
    const deadlock = new Error("deadlock detected");
    mocks.transaction.mockImplementation(
      async (fn: (client: unknown) => unknown) => {
        const result = await fn(tx);
        if (mocks.transaction.mock.calls.length === 2) throw deadlock;
        return result;
      },
    );

    const res = await post("/due-dates/move-overdue", {
      today: "2026-11-12",
      to: "2026-11-13",
    });

    expect(res.status).toBe(200);
    expect((await res.json()).data).toEqual({
      moved: [
        { id: "tsk_a", from: "2026-11-02", version: VERSION.toISOString() },
      ],
      skipped: 3,
    });
    expect(mocks.captureException).toHaveBeenCalledTimes(1);
    expect(mocks.captureException).toHaveBeenCalledWith(
      deadlock,
      expect.anything(),
    );
  });

  it("rejects a move into the past and non-people", async () => {
    expect(
      (
        await post("/due-dates/move-overdue", {
          today: "2026-11-12",
          to: "2026-11-11",
        })
      ).status,
    ).toBe(422);
    const coworker = await post(
      "/due-dates/move-overdue",
      { today: "2026-11-12", to: "2026-11-13" },
      createApp({
        actor: "coworker",
        coworkerId: "cow_1",
        vendorId: "ven_1",
      } as AuthenticationContext),
    );
    expect(coworker.status).toBeGreaterThanOrEqual(400);
    expect(mocks.findMany).not.toHaveBeenCalled();
  });
});

describe("POST /due-dates/undo", () => {
  const undo = {
    to: "2026-11-13",
    tasks: [
      { id: "tsk_a", from: "2026-11-02", version: VERSION.toISOString() },
    ],
  };

  it("puts a Task back only while it is untouched since the move", async () => {
    const res = await post("/due-dates/undo", undo);

    expect((await res.json()).data).toEqual({
      restored: ["tsk_a"],
      skipped: 0,
    });
    expect(mocks.updateMany).toHaveBeenCalledWith({
      where: {
        id: "tsk_a",
        workspaceId: WORKSPACE_ID,
        archivedAt: null,
        dueOn: new Date("2026-11-13T00:00:00.000Z"),
        updatedAt: VERSION,
      },
      data: { dueOn: new Date("2026-11-02T00:00:00.000Z") },
    });
  });

  it("keeps the Tasks it restored when a later one fails", async () => {
    mocks.transaction.mockImplementation(
      async (fn: (client: unknown) => unknown) => {
        const result = await fn(tx);
        if (mocks.transaction.mock.calls.length === 2) {
          throw new Error("timeout");
        }
        return result;
      },
    );

    const res = await post("/due-dates/undo", {
      to: "2026-11-13",
      tasks: [
        { id: "tsk_a", from: "2026-11-02", version: VERSION.toISOString() },
        { id: "tsk_b", from: "2026-11-03", version: VERSION.toISOString() },
      ],
    });

    expect((await res.json()).data).toEqual({
      restored: ["tsk_a"],
      skipped: 1,
    });
  });

  it("rejects an Undo without versions", async () => {
    const res = await post("/due-dates/undo", {
      to: "2026-11-13",
      tasks: [{ id: "tsk_a", from: "2026-11-02" }],
    });
    expect(res.status).toBe(422);
    expect(mocks.updateMany).not.toHaveBeenCalled();
  });
});
