import { OpenAPIHono } from "@hono/zod-openapi";
import { TaskStatus } from "@sokosumi/database";
import { HTTPException } from "hono/http-exception";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { OpenAPIHonoWithAuth } from "@/lib/hono";
import type { AuthVariables } from "@/middleware/auth";

import mountGetTasks from "./get";

const {
  prismaTransactionMock,
  requireCoworkerCapabilityMock,
  taskCountMock,
  taskFindManyMock,
} = vi.hoisted(() => ({
  prismaTransactionMock: vi.fn(),
  requireCoworkerCapabilityMock: vi.fn(),
  taskCountMock: vi.fn(),
  taskFindManyMock: vi.fn(),
}));

vi.mock("@/helpers/access-control", () => ({
  requireCoworkerCapability: requireCoworkerCapabilityMock,
}));

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
    requireCoworkerCapabilityMock.mockResolvedValue(undefined);
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

  it("filters included links to peer tasks visible in the requested scope", async () => {
    const app = createApp();

    const response = await app.request("http://localhost/?scope=context");

    expect(response.status).toBe(200);
    expect(taskFindManyMock).toHaveBeenCalledWith(
      expect.objectContaining({
        include: expect.objectContaining({
          linksFrom: {
            where: {
              toTask: {
                is: {
                  archivedAt: null,
                  OR: [{ userId: "user_123", organizationId: "org_123" }],
                },
              },
            },
            orderBy: { createdAt: "asc" },
          },
          linksTo: {
            where: {
              fromTask: {
                is: {
                  archivedAt: null,
                  OR: [{ userId: "user_123", organizationId: "org_123" }],
                },
              },
            },
            orderBy: { createdAt: "asc" },
          },
        }),
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

  it("rejects coworker requests when tasks capability is unavailable", async () => {
    requireCoworkerCapabilityMock.mockRejectedValue(
      new HTTPException(403, {
        message: "Coworker is not allowed to use tasks",
      }),
    );

    const app = createApp("coworker");
    const response = await app.request("http://localhost/");

    expect(response.status).toBe(403);
    expect(taskFindManyMock).not.toHaveBeenCalled();
    expect(taskCountMock).not.toHaveBeenCalled();
  });
});
