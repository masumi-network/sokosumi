import { HTTPException } from "hono/http-exception";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { OpenAPIHonoWithAuth } from "@/lib/hono";
import { TEST_VENDOR_ID } from "@/test-fixtures/vendor.js";

import mountGetCoworkerMeEvents from "./get";

vi.mock("@/middleware/auth", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/middleware/auth")>();
  const { stubAuthMiddleware } = await import(
    "@/test-fixtures/auth-middleware"
  );
  return { ...actual, authMiddleware: stubAuthMiddleware };
});

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
  const app = new OpenAPIHonoWithAuth();

  app.use("*", async (c, next) => {
    c.set("isAuthenticated", true);
    c.set("authContext", {
      actor: "coworker",
      coworkerId: "cow_123",
      vendorId: TEST_VENDOR_ID,
    });
    return await next();
  });

  mountGetCoworkerMeEvents(app);
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
