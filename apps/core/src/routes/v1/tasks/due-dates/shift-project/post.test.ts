import { beforeEach, describe, expect, it, vi } from "vitest";

import { notFound } from "@/helpers/error";
import { errorHandler } from "@/helpers/error-handler";
import { OpenAPIHonoWithAuth } from "@/lib/hono";

import { MAX_DUE_DATE_MOVES } from "../each-locked-task";
import mountShiftProject from "./post";

vi.mock("@/middleware/auth", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/middleware/auth")>();
  const { stubAuthMiddleware } = await import(
    "@/test-fixtures/auth-middleware"
  );
  return { ...actual, authMiddleware: stubAuthMiddleware };
});

const mocks = vi.hoisted(() => ({
  deliverCalendarInvalidationsNow: vi.fn(),
  findMany: vi.fn(),
  requireMutableTaskWriteAccess: vi.fn(),
  transaction: vi.fn(),
  updateMany: vi.fn(),
}));

vi.mock("@sentry/node", () => ({ captureException: vi.fn() }));
vi.mock("@/helpers/access-control", () => ({
  buildTaskWriteAccessWhere: (userId: string) => ({ writableBy: userId }),
  requireMutableTaskWriteAccess: mocks.requireMutableTaskWriteAccess,
}));
vi.mock("@/helpers/calendar-invalidation", () => ({
  deliverCalendarInvalidationsNow: mocks.deliverCalendarInvalidationsNow,
}));
vi.mock("@/helpers/calendar-locks", () => ({
  lockCalendarScope: vi.fn().mockResolvedValue(true),
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
const PROJECT_ID = "33333333-3333-7333-8333-333333333333";
const tx = { task: { updateMany: mocks.updateMany } };

function dated(id: string, name: string, day: string) {
  return { id, name, dueOn: new Date(`${day}T00:00:00.000Z`) };
}

function createApp() {
  const app = new OpenAPIHonoWithAuth();
  app.onError(errorHandler);
  app.use("*", async (c, next) => {
    c.set("requestId", "req_shift_project_test");
    c.set("isAuthenticated", true);
    c.set("authContext", {
      actor: "user",
      userId: USER_ID,
      organizationId: "org_123",
      role: "user",
    });
    c.set("workspaceContext", {
      workspaceId: WORKSPACE_ID,
      userId: null,
      organizationId: "org_123",
    });
    return await next();
  });
  mountShiftProject(app);
  return app;
}

function post(body: unknown) {
  return createApp().request("/due-dates/shift-project", {
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
  mocks.requireMutableTaskWriteAccess.mockImplementation(
    async (_user: unknown, id: string) => {
      if (id === "tsk_gone") throw notFound("Task not found");
      return {
        id,
        name: `Task ${id}`,
        workspaceId: WORKSPACE_ID,
        projectId: PROJECT_ID,
      };
    },
  );
  mocks.updateMany.mockResolvedValue({ count: 1 });
});

describe("POST /due-dates/shift-project", () => {
  it("previews each open, editable, dated Task's new day without writing", async () => {
    mocks.findMany.mockResolvedValue([
      dated("tsk_a", "Draft launch post", "2026-11-20"),
      dated("tsk_b", "Book venue", "2026-12-30"),
    ]);

    const res = await post({ projectId: PROJECT_ID, days: 7 });

    expect(res.status).toBe(200);
    expect((await res.json()).data).toEqual({
      tasks: [
        {
          id: "tsk_a",
          name: "Draft launch post",
          from: "2026-11-20",
          to: "2026-11-27",
        },
        {
          id: "tsk_b",
          name: "Book venue",
          from: "2026-12-30",
          to: "2027-01-06",
        },
      ],
      skipped: 0,
      overLimit: false,
    });
    expect(mocks.transaction).not.toHaveBeenCalled();
    const query = mocks.findMany.mock.calls[0]?.[0];
    expect(query.take).toBe(MAX_DUE_DATE_MOVES + 1);
    expect(query.where).toEqual({
      workspaceId: WORKSPACE_ID,
      projectId: PROJECT_ID,
      archivedAt: null,
      dueOn: { not: null },
      status: { notIn: ["COMPLETED", "CANCELED", "GRANT_PENDING"] },
      AND: [
        {
          OR: [
            { visibility: "PUBLIC" },
            { visibility: "PRIVATE", ownerId: USER_ID },
          ],
        },
        { writableBy: USER_ID },
      ],
    });
  });

  it("flags a project over the limit from the one list it read", async () => {
    mocks.findMany.mockResolvedValue(
      Array.from({ length: MAX_DUE_DATE_MOVES + 1 }, (_, index) =>
        dated(`tsk_${index}`, `Task ${index}`, "2026-11-20"),
      ),
    );

    const res = await post({ projectId: PROJECT_ID, days: 7 });

    const data = (await res.json()).data;
    expect(data.overLimit).toBe(true);
    expect(data.tasks).toHaveLength(MAX_DUE_DATE_MOVES);
  });

  it("moves only the confirmed Tasks, earlier too, from the days the preview showed", async () => {
    const res = await post({
      projectId: PROJECT_ID,
      days: -3,
      tasks: [
        { id: "tsk_a", from: "2026-11-20" },
        { id: "tsk_b", from: "2026-12-01" },
      ],
    });

    expect(res.status).toBe(200);
    expect((await res.json()).data).toEqual({
      tasks: [
        {
          id: "tsk_a",
          name: "Task tsk_a",
          from: "2026-11-20",
          to: "2026-11-17",
        },
        {
          id: "tsk_b",
          name: "Task tsk_b",
          from: "2026-12-01",
          to: "2026-11-28",
        },
      ],
      skipped: 0,
      overLimit: false,
    });
    // Confirm never picks again, so nothing unconfirmed can join.
    expect(mocks.findMany).not.toHaveBeenCalled();
    expect(mocks.updateMany).toHaveBeenNthCalledWith(1, {
      where: {
        AND: [
          expect.objectContaining({
            projectId: PROJECT_ID,
            status: { notIn: ["COMPLETED", "CANCELED", "GRANT_PENDING"] },
          }),
          { id: "tsk_a", dueOn: new Date("2026-11-20T00:00:00.000Z") },
        ],
      },
      data: { dueOn: new Date("2026-11-17T00:00:00.000Z") },
    });
    expect(mocks.deliverCalendarInvalidationsNow).toHaveBeenCalledWith(
      WORKSPACE_ID,
    );
  });

  it("counts a confirmed Task that changed meanwhile or can't be edited as skipped", async () => {
    mocks.updateMany.mockImplementation(
      async ({ where }: { where: { AND: [unknown, { id: string }] } }) => ({
        count: where.AND[1].id === "tsk_changed" ? 0 : 1,
      }),
    );

    const res = await post({
      projectId: PROJECT_ID,
      days: 7,
      tasks: [
        { id: "tsk_a", from: "2026-11-20" },
        { id: "tsk_changed", from: "2026-12-01" },
        { id: "tsk_gone", from: "2026-12-02" },
      ],
    });

    const data = (await res.json()).data;
    expect(data.tasks.map((task: { id: string }) => task.id)).toEqual([
      "tsk_a",
    ]);
    expect(data.skipped).toBe(2);
  });

  it.each([0, 366, -366, 1.5])("rejects a move of %s days", async (days) => {
    const res = await post({ projectId: PROJECT_ID, days });

    expect(res.status).toBe(422);
    expect(mocks.findMany).not.toHaveBeenCalled();
  });

  it("rejects a Confirm with more Tasks than one move takes", async () => {
    const res = await post({
      projectId: PROJECT_ID,
      days: 7,
      tasks: Array.from({ length: MAX_DUE_DATE_MOVES + 1 }, (_, index) => ({
        id: `tsk_${index}`,
        from: "2026-11-20",
      })),
    });

    expect(res.status).toBe(422);
    expect(mocks.transaction).not.toHaveBeenCalled();
  });
});
