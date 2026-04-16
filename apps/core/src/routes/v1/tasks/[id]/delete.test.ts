import { OpenAPIHono } from "@hono/zod-openapi";
import { TaskStatus } from "@sokosumi/database";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { OpenAPIHonoWithAuth } from "@/lib/hono";
import type { AuthVariables } from "@/middleware/auth";
import type { WorkspaceVariables } from "@/middleware/workspace";

import mountDeleteTask from "./delete";

const {
  prismaTransactionMock,
  requireTaskOwnershipMock,
  mapTaskMock,
} = vi.hoisted(() => ({
  prismaTransactionMock: vi.fn(),
  requireTaskOwnershipMock: vi.fn(),
  mapTaskMock: vi.fn((task: unknown) => task),
}));

vi.mock("@/helpers/access-control", () => ({
  requireTaskOwnership: requireTaskOwnershipMock,
}));

vi.mock("@/helpers/task", () => ({
  isTaskArchivableStatus: vi.fn(() => true),
  mapTask: mapTaskMock,
}));

vi.mock("@/lib/db/prisma", () => ({
  default: {
    $transaction: prismaTransactionMock,
  },
}));

function createApp(activeWorkspaceId = "99999999-9999-7999-8999-999999999999") {
  const app = new OpenAPIHono<{
    Variables: AuthVariables & WorkspaceVariables;
  }>();

  app.use("*", async (c, next) => {
    c.set("isAuthenticated", true);
    c.set("authContext", {
      actor: "user",
      userId: "user_123",
      organizationId: null,
    });
    c.set("workspaceContext", {
      workspaceId: activeWorkspaceId,
      userId: "user_123",
      organizationId: null,
    });

    return await next();
  });

  mountDeleteTask(app as unknown as OpenAPIHonoWithAuth);

  return app;
}

describe("DELETE /tasks/{id}", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("uses the task workspace for link visibility in the archive response", async () => {
    const updateMock = vi.fn().mockResolvedValue({
      id: "tsk_123",
      createdAt: "2026-03-25T10:00:00.000Z",
      updatedAt: "2026-03-25T10:00:00.000Z",
      userId: "user_123",
      organizationId: null,
      status: TaskStatus.READY,
      coworkerId: null,
      name: "Archived task",
      description: null,
      credits: 0,
      events: [],
      jobs: [],
      workspace: {
        id: "22222222-2222-7222-8222-222222222222",
        organizationId: null,
        organization: null,
      },
      share: null,
      links: [],
      linksFrom: [],
      linksTo: [],
    });

    prismaTransactionMock.mockImplementation(async (callback) => {
      return await callback({
        task: {
          update: updateMock,
        },
      });
    });

    requireTaskOwnershipMock.mockResolvedValue({
      id: "tsk_123",
      status: TaskStatus.READY,
      workspaceId: "22222222-2222-7222-8222-222222222222",
    });

    const app = createApp();
    const response = await app.request("http://localhost/tsk_123", {
      method: "DELETE",
    });

    expect(response.status).toBe(200);
    expect(updateMock).toHaveBeenCalledWith(
      expect.objectContaining({
        include: expect.objectContaining({
          linksFrom: expect.objectContaining({
            where: {
              toTask: {
                is: {
                  workspaceId: "22222222-2222-7222-8222-222222222222",
                  archivedAt: null,
                },
              },
            },
          }),
          linksTo: expect.objectContaining({
            where: {
              fromTask: {
                is: {
                  workspaceId: "22222222-2222-7222-8222-222222222222",
                  archivedAt: null,
                },
              },
            },
          }),
        }),
      }),
    );
  });
});
