import { OpenAPIHono } from "@hono/zod-openapi";
import { TaskStatus } from "@sokosumi/utils";
import { HTTPException } from "hono/http-exception";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { OpenAPIHonoWithAuth } from "@/lib/hono";
import type { AuthVariables } from "@/middleware/auth";
import type { WorkspaceVariables } from "@/middleware/workspace";

import mountPatchTask from "./[id]/patch";
import mountPostTask from "./post";

const {
  prismaTransactionMock,
  requireTaskAssignableCoworkerMock,
  requireTaskOwnershipMock,
  mapTaskMock,
  validateTaskCoworkerAssignmentMock,
} = vi.hoisted(() => ({
  prismaTransactionMock: vi.fn(),
  requireTaskAssignableCoworkerMock: vi.fn(),
  requireTaskOwnershipMock: vi.fn(),
  mapTaskMock: vi.fn((task: unknown) => {
    const t = task as Record<string, unknown>;
    return {
      ...t,
      pendingVendorGrantId: t.pendingVendorGrantId ?? null,
      awaitingVendorApproval: t.pendingVendorGrantId != null,
      user: t.user ?? {
        id: t.userId,
        name: "Task owner",
        image: null,
      },
      organization:
        t.organization ??
        (t.organizationId
          ? {
              id: t.organizationId,
              name: "Organization",
              slug: "organization",
            }
          : null),
      coworker:
        t.coworker ??
        (t.coworkerId
          ? {
              id: t.coworkerId,
              name: "Coworker",
              image: null,
              slug: "coworker",
            }
          : null),
    };
  }),
  validateTaskCoworkerAssignmentMock: vi.fn(),
}));

vi.mock("@/lib/db/prisma", () => ({
  default: {
    $transaction: prismaTransactionMock,
  },
}));

vi.mock("@/helpers/access-control", () => ({
  requireTaskAssignableCoworker: requireTaskAssignableCoworkerMock,
  requireTaskOwnership: requireTaskOwnershipMock,
}));

vi.mock("@/helpers/task", () => ({
  mapTask: mapTaskMock,
  validateTaskCoworkerAssignment: validateTaskCoworkerAssignmentMock,
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
      role: "user",
    });
    c.set("workspaceContext", {
      workspaceId: activeWorkspaceId,
      userId: "user_123",
      organizationId: null,
    });

    return await next();
  });

  mountPostTask(app as unknown as OpenAPIHonoWithAuth);
  mountPatchTask(app as unknown as OpenAPIHonoWithAuth);

  return app;
}

describe("task coworker whitelist enforcement", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("rejects task creation when coworker is not whitelisted", async () => {
    const tx = {
      task: {
        create: vi.fn(),
      },
    };

    prismaTransactionMock.mockImplementation(async (callback) => {
      return await callback(tx);
    });

    requireTaskAssignableCoworkerMock.mockRejectedValue(
      new HTTPException(404, { message: "Coworker not found" }),
    );

    const app = createApp();
    const response = await app.request("http://localhost/", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        name: "Whitelist check",
        coworkerId: "cow_123",
        status: TaskStatus.READY,
      }),
    });

    expect(response.status).toBe(404);
    expect(requireTaskAssignableCoworkerMock).toHaveBeenCalledWith("cow_123");
    expect(tx.task.create).not.toHaveBeenCalled();
  });

  it("rejects task update when coworker is not whitelisted", async () => {
    const tx = {
      task: {
        update: vi.fn(),
      },
    };

    prismaTransactionMock.mockImplementation(async (callback) => {
      return await callback(tx);
    });

    requireTaskOwnershipMock.mockResolvedValue({
      id: "tsk_123",
      status: TaskStatus.READY,
      coworkerId: null,
      workspaceId: "22222222-2222-7222-8222-222222222222",
    });
    requireTaskAssignableCoworkerMock.mockRejectedValue(
      new HTTPException(404, { message: "Coworker not found" }),
    );

    const app = createApp();
    const response = await app.request("http://localhost/tsk_123", {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        coworkerId: "cow_123",
      }),
    });

    expect(response.status).toBe(404);
    expect(tx.task.update).not.toHaveBeenCalled();
  });

  it("uses workspace-scoped link visibility in the patch response", async () => {
    const updateMock = vi.fn().mockResolvedValue({
      id: "tsk_123",
      createdAt: "2026-03-25T10:00:00.000Z",
      updatedAt: "2026-03-25T10:00:00.000Z",
      userId: "user_123",
      organizationId: null,
      projectId: null,
      status: TaskStatus.READY,
      coworkerId: null,
      name: "Updated title",
      description: null,
      metadata: null,
      nextRunAt: null,
      pendingVendorGrantId: null,
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
    const tx = {
      task: {
        update: updateMock,
      },
    };

    prismaTransactionMock.mockImplementation(async (callback) => {
      return await callback(tx);
    });

    requireTaskOwnershipMock.mockResolvedValue({
      id: "tsk_123",
      status: TaskStatus.READY,
      coworkerId: null,
      workspaceId: "22222222-2222-7222-8222-222222222222",
    });

    const app = createApp();
    const response = await app.request("http://localhost/tsk_123", {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        name: "Updated title",
      }),
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
                  pendingVendorGrantId: null,
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
                  pendingVendorGrantId: null,
                },
              },
            },
          }),
        }),
      }),
    );
  });

  it("rejects task creation when coworker lacks tasks capability", async () => {
    const tx = {
      task: {
        create: vi.fn(),
      },
    };

    prismaTransactionMock.mockImplementation(async (callback) => {
      return await callback(tx);
    });

    requireTaskAssignableCoworkerMock.mockRejectedValue(
      new HTTPException(404, { message: "Coworker not found" }),
    );

    const app = createApp();
    const response = await app.request("http://localhost/", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        name: "Capability check",
        coworkerId: "cow_123",
        status: TaskStatus.READY,
      }),
    });

    expect(response.status).toBe(404);
    expect(requireTaskAssignableCoworkerMock).toHaveBeenCalledWith("cow_123");
    expect(tx.task.create).not.toHaveBeenCalled();
  });
});
