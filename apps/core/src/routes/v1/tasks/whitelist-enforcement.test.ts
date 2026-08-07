import { OpenAPIHono } from "@hono/zod-openapi";
import { TaskStatus } from "@sokosumi/database";
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
  validateTaskAssigneeAssignmentMock,
} = vi.hoisted(() => ({
  prismaTransactionMock: vi.fn(),
  requireTaskAssignableCoworkerMock: vi.fn(),
  requireTaskOwnershipMock: vi.fn(),
  mapTaskMock: vi.fn((task: unknown) => {
    const t = task as Record<string, unknown>;
    const status = t.status as string | undefined;
    return {
      ...t,
      grantResumeStatus:
        status === TaskStatus.GRANT_PENDING
          ? ((t.grantResumeStatus as string | null) ?? TaskStatus.DRAFT)
          : null,
      pendingVendorGrantId:
        status === TaskStatus.GRANT_PENDING
          ? ((t.pendingVendorGrantId as string | null) ?? null)
          : null,
      owner: t.owner ?? {
        id: t.ownerId,
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
      assignee:
        t.assignee ??
        (t.assigneeId
          ? {
              id: t.assigneeId,
              name: "Coworker",
              image: null,
              slug: "coworker",
            }
          : null),
      creator: (() => {
        const creatorOrchestratorId =
          (t.creatorOrchestratorId as string | null | undefined) ?? null;
        if (creatorOrchestratorId != null) {
          return {
            type: "orchestrator" as const,
            id: creatorOrchestratorId,
            orchestrator: (t.creatorOrchestrator as
              | object
              | null
              | undefined) ?? {
              id: creatorOrchestratorId,
              name: "Orchestrator",
              avatarSeed: null,
              owner: { id: "user_fallback", name: "Owner", image: null },
            },
          };
        }

        const creatorCoworkerId =
          (t.creatorCoworkerId as string | null | undefined) ?? null;
        if (creatorCoworkerId != null) {
          return {
            type: "coworker" as const,
            id: creatorCoworkerId,
            coworker: (t.creatorCoworker as object | null | undefined) ?? {
              id: creatorCoworkerId,
              name: "Coworker",
              image: null,
              slug: "coworker",
            },
          };
        }

        const creatorUserId =
          (t.creatorUserId as string | null | undefined) ??
          (t.ownerId as string);
        return {
          type: "user" as const,
          id: creatorUserId,
          user: (t.creatorUser as object | null | undefined) ?? {
            id: creatorUserId,
            name: "Task owner",
            image: null,
          },
        };
      })(),
      userId: t.ownerId as string,
      user: (t.owner as object | undefined) ?? {
        id: t.ownerId,
        name: "Task owner",
        image: null,
      },
      coworkerId:
        (t.coworkerId as string | null | undefined) ??
        (t.assigneeId as string | null | undefined) ??
        null,
      coworker:
        (t.coworker as object | null | undefined) ??
        (t.assignee as object | null | undefined) ??
        (t.assigneeId
          ? {
              id: t.assigneeId,
              name: "Coworker",
              image: null,
              slug: "coworker",
            }
          : null),
      orchestratorId:
        (t.orchestratorId as string | null | undefined) ??
        (t.creatorOrchestratorId as string | null | undefined) ??
        null,
      orchestrator:
        (t.orchestrator as object | null | undefined) ??
        (t.creatorOrchestrator as object | null | undefined) ??
        null,
    };
  }),
  validateTaskAssigneeAssignmentMock: vi.fn(),
}));

vi.mock("@/lib/db/prisma", () => ({
  default: {
    $transaction: prismaTransactionMock,
  },
}));

vi.mock("@/helpers/access-control", () => ({
  requireTaskAssignableCoworker: requireTaskAssignableCoworkerMock,
  requireTaskOwnership: requireTaskOwnershipMock,
  requireMutableTaskOwnership: requireTaskOwnershipMock,
}));

vi.mock("@/helpers/task", () => ({
  mapTask: mapTaskMock,
  validateTaskAssigneeAssignment: validateTaskAssigneeAssignmentMock,
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
      new HTTPException(404, {
        message: "Coworker is not usable in this workspace",
      }),
    );

    const app = createApp();
    const response = await app.request("http://localhost/", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        name: "Whitelist check",
        assigneeId: "cow_123",
        status: TaskStatus.READY,
      }),
    });

    expect(response.status).toBe(404);
    expect(requireTaskAssignableCoworkerMock).toHaveBeenCalledWith(
      "cow_123",
      "99999999-9999-7999-8999-999999999999",
    );
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
      assigneeId: null,
      workspaceId: "22222222-2222-7222-8222-222222222222",
    });
    requireTaskAssignableCoworkerMock.mockRejectedValue(
      new HTTPException(404, {
        message: "Coworker is not usable in this workspace",
      }),
    );

    const app = createApp();
    const response = await app.request("http://localhost/tsk_123", {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        assigneeId: "cow_123",
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
      ownerId: "user_123",
      organizationId: null,
      projectId: null,
      status: TaskStatus.READY,
      assigneeId: null,
      name: "Updated title",
      description: null,
      metadata: null,
      nextRunAt: null,
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
      files: [],
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
      assigneeId: null,
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
      new HTTPException(404, {
        message: "Coworker is not usable in this workspace",
      }),
    );

    const app = createApp();
    const response = await app.request("http://localhost/", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        name: "Capability check",
        assigneeId: "cow_123",
        status: TaskStatus.READY,
      }),
    });

    expect(response.status).toBe(404);
    expect(requireTaskAssignableCoworkerMock).toHaveBeenCalledWith(
      "cow_123",
      "99999999-9999-7999-8999-999999999999",
    );
    expect(tx.task.create).not.toHaveBeenCalled();
  });
});
