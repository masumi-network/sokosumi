import { OpenAPIHono } from "@hono/zod-openapi";
import { HTTPException } from "hono/http-exception";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { OpenAPIHonoWithAuth } from "@/lib/hono";
import type { AuthVariables } from "@/middleware/auth";
import { TEST_VENDOR_ID } from "@/test-fixtures/vendor.js";

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
      vendorId: TEST_VENDOR_ID,
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

  it("includes tasks awaiting vendor approval in the events query", async () => {
    const app = createApp();
    const response = await app.request("http://localhost/me/events");

    expect(response.status).toBe(200);
    expect(taskEventFindManyMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          task: {
            assigneeId: "cow_123",
            status: { not: "DRAFT" },
          },
        },
      }),
    );
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
});
