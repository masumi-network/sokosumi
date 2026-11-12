import { beforeEach, describe, expect, it, vi } from "vitest";

import { notFound } from "@/helpers/error";
import { errorHandler } from "@/helpers/error-handler";
import { OpenAPIHonoWithAuth } from "@/lib/hono";
import type { AuthenticationContext } from "@/middleware/auth";

import mountPostTaskDueDates, { MAX_TASK_DUE_DATE_MOVES } from "./post";

vi.mock("@/middleware/auth", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/middleware/auth")>();
  const { stubAuthMiddleware } = await import(
    "@/test-fixtures/auth-middleware"
  );
  return { ...actual, authMiddleware: stubAuthMiddleware };
});

const {
  deliverCalendarInvalidationsNowMock,
  lockCalendarScopeMock,
  requireMutableTaskWriteAccessMock,
  requireAssignedOrganizationSeatMock,
  updateManyMock,
} = vi.hoisted(() => ({
  deliverCalendarInvalidationsNowMock: vi.fn(),
  lockCalendarScopeMock: vi.fn(),
  requireMutableTaskWriteAccessMock: vi.fn(),
  requireAssignedOrganizationSeatMock: vi.fn(),
  updateManyMock: vi.fn(),
}));

vi.mock("@/helpers/access-control", () => ({
  requireMutableTaskWriteAccess: requireMutableTaskWriteAccessMock,
}));
vi.mock("@/helpers/calendar-invalidation", () => ({
  deliverCalendarInvalidationsNow: deliverCalendarInvalidationsNowMock,
}));
vi.mock("@/helpers/calendar-locks", () => ({
  lockCalendarScope: lockCalendarScopeMock,
  lockTaskRows: vi.fn().mockResolvedValue(true),
}));
vi.mock("@/helpers/organization-assigned-seat", () => ({
  requireAssignedOrganizationSeat: requireAssignedOrganizationSeatMock,
}));
vi.mock("@/lib/db/prisma", () => ({
  default: {
    $transaction: (fn: (tx: unknown) => unknown) =>
      fn({ task: { updateMany: updateManyMock } }),
  },
}));

const WORKSPACE_ID = "11111111-1111-7111-8111-111111111111";
const OTHER_WORKSPACE_ID = "22222222-2222-7222-8222-222222222222";

function task(id: string, workspaceId = WORKSPACE_ID) {
  return {
    id,
    workspaceId,
    projectId: null,
    ownerId: "user_123",
    organizationId: "org_123",
  };
}

function createApp(
  authContext: AuthenticationContext = {
    actor: "user",
    userId: "user_123",
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
  mountPostTaskDueDates(app);
  return app;
}

function post(app: OpenAPIHonoWithAuth, body: unknown) {
  return app.request("/due-dates", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("POST /tasks/due-dates", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    lockCalendarScopeMock.mockResolvedValue(true);
    requireAssignedOrganizationSeatMock.mockResolvedValue(undefined);
    requireMutableTaskWriteAccessMock.mockImplementation(
      async (_user: unknown, id: string) => {
        if (id === "tsk_gone") throw notFound("Task not found");
        if (id === "tsk_elsewhere") return task(id, OTHER_WORKSPACE_ID);
        return task(id);
      },
    );
    // A Task whose due day changed since the move matches nothing.
    updateManyMock.mockImplementation(
      async ({ where }: { where: { id: string } }) => ({
        count: where.id === "tsk_changed" ? 0 : 1,
      }),
    );
  });

  it("moves only Tasks that still have their from day, and skips the rest", async () => {
    const res = await post(createApp(), {
      tasks: [
        { id: "tsk_a", from: "2026-11-08", to: "2026-11-13" },
        { id: "tsk_changed", from: "2026-11-09", to: "2026-11-13" },
        { id: "tsk_gone", from: "2026-11-09", to: "2026-11-13" },
        { id: "tsk_elsewhere", from: "2026-11-09", to: "2026-11-13" },
      ],
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data).toEqual({ moved: ["tsk_a"] });
    expect(updateManyMock).toHaveBeenCalledWith({
      where: {
        id: "tsk_a",
        archivedAt: null,
        dueOn: new Date("2026-11-08T00:00:00.000Z"),
      },
      data: { dueOn: new Date("2026-11-13T00:00:00.000Z") },
    });
    // The Task in another workspace is never written.
    expect(updateManyMock).not.toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ id: "tsk_elsewhere" }),
      }),
    );
    expect(deliverCalendarInvalidationsNowMock).toHaveBeenCalledWith(
      WORKSPACE_ID,
    );
  });

  it("skips a Task whose locks cannot be taken", async () => {
    lockCalendarScopeMock.mockResolvedValue(false);
    const res = await post(createApp(), {
      tasks: [{ id: "tsk_a", from: "2026-11-08", to: "2026-11-13" }],
    });

    expect((await res.json()).data).toEqual({ moved: [] });
    expect(updateManyMock).not.toHaveBeenCalled();
    expect(deliverCalendarInvalidationsNowMock).not.toHaveBeenCalled();
  });

  it("rejects bad days and too many Tasks", async () => {
    const app = createApp();
    const badDay = await post(app, {
      tasks: [{ id: "tsk_a", from: "2026-02-30", to: "2026-11-13" }],
    });
    const tooMany = await post(app, {
      tasks: Array.from({ length: MAX_TASK_DUE_DATE_MOVES + 1 }, (_, i) => ({
        id: `tsk_${i}`,
        from: "2026-11-08",
        to: "2026-11-13",
      })),
    });

    expect(badDay.status).toBe(422);
    expect(tooMany.status).toBe(422);
    expect(updateManyMock).not.toHaveBeenCalled();
  });

  it("is for people only", async () => {
    const res = await post(
      createApp({
        actor: "coworker",
        coworkerId: "cow_1",
        vendorId: "ven_1",
      } as AuthenticationContext),
      { tasks: [{ id: "tsk_a", from: "2026-11-08", to: "2026-11-13" }] },
    );

    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(updateManyMock).not.toHaveBeenCalled();
  });
});
