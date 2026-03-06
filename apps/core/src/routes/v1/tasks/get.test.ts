import { OpenAPIHono } from "@hono/zod-openapi";
import { TaskStatus } from "@sokosumi/database";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { OpenAPIHonoWithAuth } from "@/lib/hono";
import type { AuthVariables } from "@/middleware/auth";

import mountGetTasks from "./get";

const { prismaTransactionMock, taskCountMock, taskFindManyMock } = vi.hoisted(
  () => ({
    prismaTransactionMock: vi.fn(),
    taskCountMock: vi.fn(),
    taskFindManyMock: vi.fn(),
  }),
);

vi.mock("@/lib/db/prisma", () => ({
  default: {
    $transaction: prismaTransactionMock,
    task: {
      count: taskCountMock,
      findMany: taskFindManyMock,
    },
  },
}));

function createApp(actor: "user" | "coworker" = "user") {
  const app = new OpenAPIHono<{
    Variables: AuthVariables;
  }>();

  app.use("*", async (c, next) => {
    c.set("isAuthenticated", true);
    if (actor === "coworker") {
      c.set("authContext", {
        actor: "coworker",
        coworkerId: "cow_123",
      });
    } else {
      c.set("authContext", {
        actor: "user",
        userId: "user_123",
        organizationId: "org_123",
      });
    }

    return await next();
  });

  mountGetTasks(app as unknown as OpenAPIHonoWithAuth);
  return app;
}

describe("GET /tasks", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    taskFindManyMock.mockResolvedValue([]);
    taskCountMock.mockResolvedValue(0);
    prismaTransactionMock.mockImplementation(async (operations) => {
      return await Promise.all(operations);
    });
  });

  it("parses multiple statuses into an IN filter", async () => {
    const app = createApp();
    const response = await app.request(
      "http://localhost/?status=COMPLETED,FAILED&status=COMPLETED",
    );

    expect(response.status).toBe(200);
    expect(taskFindManyMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          archivedAt: null,
          OR: [{ userId: "user_123", organizationId: "org_123" }],
          status: {
            in: [TaskStatus.COMPLETED, TaskStatus.FAILED],
          },
        },
      }),
    );
  });

  it("rejects coworker requests that include DRAFT", async () => {
    const app = createApp("coworker");
    const response = await app.request("http://localhost/?status=DRAFT,READY");

    expect(response.status).toBe(400);
    expect(taskFindManyMock).not.toHaveBeenCalled();
    expect(taskCountMock).not.toHaveBeenCalled();
  });
});
