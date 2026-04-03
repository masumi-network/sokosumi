import { OpenAPIHono } from "@hono/zod-openapi";
import { TaskEventOrigin, TaskStatus } from "@sokosumi/database";
import { HTTPException } from "hono/http-exception";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { OpenAPIHonoWithAuth } from "@/lib/hono";
import type { AuthVariables } from "@/middleware/auth";

import mountGetTaskEvents from "./get";

const {
  prismaTransactionMock,
  requireTaskReadAccessMock,
  taskEventFindManyMock,
} = vi.hoisted(() => ({
  prismaTransactionMock: vi.fn(),
  requireTaskReadAccessMock: vi.fn(),
  taskEventFindManyMock: vi.fn(),
}));

vi.mock("@/helpers/access-control", () => ({
  requireTaskReadAccess: requireTaskReadAccessMock,
}));

vi.mock("@/lib/db/prisma", () => ({
  default: {
    $transaction: prismaTransactionMock,
  },
}));

function createApp() {
  const app = new OpenAPIHono<{
    Variables: AuthVariables;
  }>();

  app.use("*", async (c, next) => {
    c.set("isAuthenticated", true);
    c.set("authContext", {
      actor: "user",
      userId: "user_123",
      organizationId: "org_123",
    });

    return await next();
  });

  mountGetTaskEvents(app as unknown as OpenAPIHonoWithAuth);

  return app;
}

describe("GET /tasks/{id}/events", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    requireTaskReadAccessMock.mockResolvedValue(undefined);
    prismaTransactionMock.mockImplementation(async (callback) => {
      return await callback({
        taskEvent: {
          findMany: taskEventFindManyMock,
        },
      });
    });
    taskEventFindManyMock.mockResolvedValue([
      {
        id: "evt_123",
        taskId: "tsk_123",
        createdAt: new Date("2026-03-25T10:00:00.000Z"),
        updatedAt: new Date("2026-03-25T10:00:00.000Z"),
        userId: "user_456",
        coworkerId: null,
        transactionId: null,
        cents: null,
        comment: "Created by teammate",
        authenticationUrl: null,
        origin: TaskEventOrigin.SOKOSUMI,
        status: TaskStatus.RUNNING,
        user: {
          id: "user_456",
          name: "Grace Hopper",
          image: "https://example.com/grace.png",
        },
        transaction: null,
      },
    ]);
  });

  it("reads task events with task read scope", async () => {
    const app = createApp();

    const response = await app.request("http://localhost/tsk_123/events");

    expect(response.status).toBe(200);
    expect(requireTaskReadAccessMock).toHaveBeenCalledWith(
      {
        actor: "user",
        userId: "user_123",
        organizationId: "org_123",
      },
      "tsk_123",
      expect.any(Object),
    );
    expect(taskEventFindManyMock).toHaveBeenCalledWith({
      where: { taskId: "tsk_123" },
      orderBy: { createdAt: "asc" },
      include: {
        user: {
          select: {
            id: true,
            name: true,
            image: true,
          },
        },
        transaction: {
          select: { amount: true },
        },
      },
    });
  });

  it("does not query events when task read access is denied", async () => {
    requireTaskReadAccessMock.mockRejectedValueOnce(
      new HTTPException(404, { message: "Task not found" }),
    );
    const app = createApp();

    const response = await app.request("http://localhost/tsk_123/events");

    expect(response.status).toBe(404);
    expect(taskEventFindManyMock).not.toHaveBeenCalled();
  });
});
