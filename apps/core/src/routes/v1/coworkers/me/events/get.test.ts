import { OpenAPIHono } from "@hono/zod-openapi";
import { HTTPException } from "hono/http-exception";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { OpenAPIHonoWithAuth } from "@/lib/hono";
import type { AuthVariables } from "@/middleware/auth";

import mountGetCoworkerMeEvents from "./get";

const {
  prismaTransactionMock,
  requireCoworkerCapabilityMock,
  taskEventCountMock,
  taskEventFindManyMock,
} = vi.hoisted(() => ({
  prismaTransactionMock: vi.fn(),
  requireCoworkerCapabilityMock: vi.fn(),
  taskEventCountMock: vi.fn(),
  taskEventFindManyMock: vi.fn(),
}));

vi.mock("@/helpers/access-control", () => ({
  requireCoworkerCapability: requireCoworkerCapabilityMock,
}));

vi.mock("@/lib/db/prisma", () => ({
  default: {
    $transaction: prismaTransactionMock,
    taskEvent: {
      count: taskEventCountMock,
      findMany: taskEventFindManyMock,
    },
  },
}));

function createApp() {
  const app = new OpenAPIHono<{
    Variables: AuthVariables;
  }>();

  app.use("*", async (c, next) => {
    c.set("isAuthenticated", true);
    c.set("authContext", {
      actor: "coworker",
      coworkerId: "cow_123",
    });
    return await next();
  });

  mountGetCoworkerMeEvents(app as unknown as OpenAPIHonoWithAuth);
  return app;
}

describe("GET /coworkers/me/events", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    requireCoworkerCapabilityMock.mockResolvedValue(undefined);
    taskEventFindManyMock.mockResolvedValue([]);
    taskEventCountMock.mockResolvedValue(0);
    prismaTransactionMock.mockImplementation(async (operations) => {
      return await Promise.all(operations);
    });
  });

  it("returns 403 when tasks capability is unavailable", async () => {
    requireCoworkerCapabilityMock.mockRejectedValue(
      new HTTPException(403, {
        message: "Coworker is not allowed to use tasks",
      }),
    );

    const app = createApp();
    const response = await app.request("http://localhost/me/events");

    expect(response.status).toBe(403);
    expect(taskEventFindManyMock).not.toHaveBeenCalled();
    expect(taskEventCountMock).not.toHaveBeenCalled();
  });

  it("serializes coworker task events with nullable user data", async () => {
    taskEventFindManyMock.mockResolvedValue([
      {
        id: "evt_123",
        taskId: "tsk_123",
        createdAt: new Date("2025-01-01T00:00:00.000Z"),
        updatedAt: new Date("2025-01-01T00:00:00.000Z"),
        userId: null,
        coworkerId: "cow_123",
        transactionId: null,
        cents: null,
        comment: "Looks good.",
        authenticationUrl: null,
        origin: "SOKOSUMI",
        status: "RUNNING",
        user: null,
        transaction: null,
      },
    ]);
    taskEventCountMock.mockResolvedValue(1);

    const app = createApp();
    const response = await app.request("http://localhost/me/events");

    expect(response.status).toBe(200);
    expect(taskEventFindManyMock).toHaveBeenCalledWith(
      expect.objectContaining({
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
      }),
    );
    await expect(response.json()).resolves.toMatchObject({
      data: [
        {
          id: "evt_123",
          user: null,
          credits: null,
        },
      ],
    });
  });
});
