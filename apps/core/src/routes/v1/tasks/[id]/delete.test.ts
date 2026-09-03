import { TaskStatus } from "@sokosumi/database";
import { getTaskCannotArchiveMessage } from "@sokosumi/utils";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { errorHandler } from "@/helpers/error-handler";
import { OpenAPIHonoWithAuth } from "@/lib/hono";
import type { AuthenticationContext } from "@/middleware/auth";

import mountDeleteTask from "./delete";

vi.mock("@/middleware/auth", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/middleware/auth")>();
  const { stubAuthMiddleware } = await import(
    "@/test-fixtures/auth-middleware"
  );
  return { ...actual, authMiddleware: stubAuthMiddleware };
});

const {
  mapTaskMock,
  prismaTransactionMock,
  removeTaskSchedulePlannedOccurrencesMock,
  requireTaskArchiveAccessMock,
} = vi.hoisted(() => ({
  prismaTransactionMock: vi.fn(),
  requireTaskArchiveAccessMock: vi.fn(),
  removeTaskSchedulePlannedOccurrencesMock: vi.fn(),
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
      assigneeOrchestratorId:
        (t.assigneeOrchestratorId as string | null | undefined) ?? null,
      assignee:
        t.assignee ??
        (t.assigneeOrchestratorId
          ? {
              type: "orchestrator" as const,
              id: t.assigneeOrchestratorId,
              orchestrator: {
                id: t.assigneeOrchestratorId,
                name: "Personal assistant",
                avatarSeed: null,
                avatarImageUrl: null,
                owner: { id: "user-1", name: "Owner", image: null },
              },
            }
          : t.assigneeId
            ? {
                type: "coworker" as const,
                id: t.assigneeId,
                coworker: {
                  id: t.assigneeId,
                  name: "Coworker",
                  image: null,
                  slug: "coworker",
                },
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
              slug: "orchestrator",
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
}));

vi.mock("@/helpers/access-control", () => ({
  requireTaskArchiveAccess: requireTaskArchiveAccessMock,
}));

vi.mock("@/helpers/task-schedule-occurrence-index", () => ({
  removeTaskSchedulePlannedOccurrences:
    removeTaskSchedulePlannedOccurrencesMock,
}));

vi.mock("@/helpers/task", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/helpers/task")>();
  return {
    ...actual,
    mapTask: mapTaskMock,
  };
});

vi.mock("@/lib/db/prisma", () => ({
  default: {
    $transaction: prismaTransactionMock,
  },
}));

function createApp(
  activeWorkspaceId = "99999999-9999-7999-8999-999999999999",
  authContext: AuthenticationContext = {
    actor: "user",
    userId: "user_123",
    organizationId: null,
    role: "user",
  },
) {
  const app = new OpenAPIHonoWithAuth();

  app.use("*", async (c, next) => {
    c.set("requestId", "req_delete_route_test");
    c.set("isAuthenticated", true);
    c.set("authContext", authContext);
    c.set("workspaceContext", {
      workspaceId: activeWorkspaceId,
      userId: "user_123",
      organizationId: null,
    });

    return await next();
  });

  app.onError(errorHandler);

  mountDeleteTask(app);

  return app;
}

const archivedTask = {
  id: "tsk_123",
  createdAt: "2026-03-25T10:00:00.000Z",
  updatedAt: "2026-03-25T10:00:00.000Z",
  ownerId: "user_123",
  organizationId: null,
  projectId: null,
  status: TaskStatus.READY,
  assigneeId: null,
  name: "Archived task",
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
};

describe("DELETE /tasks/{id}", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  function emptyScheduleLinksTx(taskMocks: {
    updateMany: ReturnType<typeof vi.fn>;
    findFirstOrThrow: ReturnType<typeof vi.fn>;
  }) {
    return {
      task: taskMocks,
      taskLink: {
        findMany: vi.fn().mockResolvedValue([]),
      },
    };
  }

  it("uses the task workspace for link visibility in the archive response", async () => {
    const updateManyMock = vi.fn().mockResolvedValue({ count: 1 });
    const findFirstOrThrowMock = vi.fn().mockResolvedValue(archivedTask);

    prismaTransactionMock.mockImplementation(async (callback) => {
      return await callback(
        emptyScheduleLinksTx({
          updateMany: updateManyMock,
          findFirstOrThrow: findFirstOrThrowMock,
        }),
      );
    });

    requireTaskArchiveAccessMock.mockResolvedValue({
      id: "tsk_123",
      ownerId: "user_123",
      status: TaskStatus.READY,
      workspaceId: "22222222-2222-7222-8222-222222222222",
    });

    const app = createApp();
    const response = await app.request("http://localhost/tsk_123", {
      method: "DELETE",
    });

    expect(response.status).toBe(200);
    expect(updateManyMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          id: "tsk_123",
          archivedAt: null,
          status: TaskStatus.READY,
        }),
        data: expect.objectContaining({
          archivedAt: expect.any(Date),
        }),
      }),
    );
    expect(removeTaskSchedulePlannedOccurrencesMock).toHaveBeenCalledWith(
      expect.anything(),
      "tsk_123",
    );
    expect(findFirstOrThrowMock).toHaveBeenCalledWith(
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
        }),
      }),
    );
  });

  it("returns 422 when the task status is not archivable", async () => {
    const updateManyMock = vi.fn();
    prismaTransactionMock.mockImplementation(async (callback) => {
      return await callback({
        task: {
          updateMany: updateManyMock,
          findFirstOrThrow: vi.fn(),
        },
      });
    });

    requireTaskArchiveAccessMock.mockResolvedValue({
      id: "tsk_123",
      ownerId: "user_123",
      status: TaskStatus.RUNNING,
      workspaceId: "22222222-2222-7222-8222-222222222222",
    });

    const app = createApp();
    const response = await app.request("http://localhost/tsk_123", {
      method: "DELETE",
    });

    expect(response.status).toBe(422);
    expect(updateManyMock).not.toHaveBeenCalled();

    const body = (await response.json()) as { message?: string };
    expect(body.message).toBe(getTaskCannotArchiveMessage(TaskStatus.RUNNING));
  });

  it("archives parked tasks awaiting vendor grant approval", async () => {
    const updateManyMock = vi.fn().mockResolvedValue({ count: 1 });
    const findFirstOrThrowMock = vi.fn().mockResolvedValue({
      ...archivedTask,
      status: TaskStatus.GRANT_PENDING,
      grantResumeStatus: TaskStatus.DRAFT,
    });

    prismaTransactionMock.mockImplementation(async (callback) => {
      return await callback(
        emptyScheduleLinksTx({
          updateMany: updateManyMock,
          findFirstOrThrow: findFirstOrThrowMock,
        }),
      );
    });

    requireTaskArchiveAccessMock.mockResolvedValue({
      id: "tsk_123",
      ownerId: "user_other",
      status: TaskStatus.GRANT_PENDING,
      workspaceId: "22222222-2222-7222-8222-222222222222",
    });

    const app = createApp();
    const response = await app.request("http://localhost/tsk_123", {
      method: "DELETE",
    });

    expect(response.status).toBe(200);
    expect(updateManyMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          id: "tsk_123",
          status: TaskStatus.GRANT_PENDING,
        }),
      }),
    );
  });

  it("returns 409 when org admin archive races grant approval", async () => {
    const updateManyMock = vi.fn().mockResolvedValue({ count: 0 });

    prismaTransactionMock.mockImplementation(async (callback) => {
      return await callback({
        task: {
          updateMany: updateManyMock,
          findFirstOrThrow: vi.fn(),
        },
      });
    });

    requireTaskArchiveAccessMock.mockResolvedValue({
      id: "tsk_123",
      ownerId: "user_other",
      status: TaskStatus.GRANT_PENDING,
      workspaceId: "22222222-2222-7222-8222-222222222222",
    });

    const app = createApp();
    const response = await app.request("http://localhost/tsk_123", {
      method: "DELETE",
    });

    expect(response.status).toBe(409);
    expect(updateManyMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          status: TaskStatus.GRANT_PENDING,
        }),
      }),
    );
  });

  it("cascades archive to SCHEDULE runs linked from the template", async () => {
    const updateManyMock = vi
      .fn()
      .mockResolvedValueOnce({ count: 1 })
      .mockResolvedValueOnce({ count: 1 })
      .mockResolvedValueOnce({ count: 1 });
    const taskLinkFindManyMock = vi.fn().mockResolvedValue([
      {
        toTask: {
          id: "tsk_child_ready",
          status: TaskStatus.READY,
          archivedAt: null,
        },
      },
      {
        toTask: {
          id: "tsk_child_completed",
          status: TaskStatus.COMPLETED,
          archivedAt: null,
        },
      },
    ]);
    const findFirstOrThrowMock = vi.fn().mockResolvedValue(archivedTask);

    prismaTransactionMock.mockImplementation(async (callback) => {
      return await callback({
        task: {
          updateMany: updateManyMock,
          findFirstOrThrow: findFirstOrThrowMock,
        },
        taskLink: {
          findMany: taskLinkFindManyMock,
        },
      });
    });

    requireTaskArchiveAccessMock.mockResolvedValue({
      id: "tsk_123",
      ownerId: "user_123",
      status: TaskStatus.READY,
      workspaceId: "22222222-2222-7222-8222-222222222222",
      metadata: null,
      nextRunAt: null,
    });

    const app = createApp();
    const response = await app.request("http://localhost/tsk_123", {
      method: "DELETE",
    });

    expect(response.status).toBe(200);
    expect(taskLinkFindManyMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          fromTaskId: "tsk_123",
          type: "SCHEDULE",
        },
      }),
    );
    expect(updateManyMock).toHaveBeenCalledTimes(3);
    expect(updateManyMock).toHaveBeenNthCalledWith(2, {
      where: {
        id: "tsk_child_ready",
        archivedAt: null,
        status: TaskStatus.READY,
      },
      data: expect.objectContaining({
        archivedAt: expect.any(Date),
      }),
    });
  });

  it("does not archive children when template has no SCHEDULE links", async () => {
    const updateManyMock = vi.fn().mockResolvedValue({ count: 1 });
    const taskLinkFindManyMock = vi.fn().mockResolvedValue([]);
    const findFirstOrThrowMock = vi.fn().mockResolvedValue(archivedTask);

    prismaTransactionMock.mockImplementation(async (callback) => {
      return await callback({
        task: {
          updateMany: updateManyMock,
          findFirstOrThrow: findFirstOrThrowMock,
        },
        taskLink: {
          findMany: taskLinkFindManyMock,
        },
      });
    });

    requireTaskArchiveAccessMock.mockResolvedValue({
      id: "tsk_123",
      ownerId: "user_123",
      status: TaskStatus.READY,
      workspaceId: "22222222-2222-7222-8222-222222222222",
      metadata: null,
      nextRunAt: null,
    });

    const app = createApp();
    const response = await app.request("http://localhost/tsk_123", {
      method: "DELETE",
    });

    expect(response.status).toBe(200);
    expect(taskLinkFindManyMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          fromTaskId: "tsk_123",
          type: "SCHEDULE",
        },
      }),
    );
    expect(updateManyMock).toHaveBeenCalledTimes(1);
  });

  it("returns 422 when a SCHEDULE run is mid-flight", async () => {
    const updateManyMock = vi.fn().mockResolvedValue({ count: 1 });
    const taskLinkFindManyMock = vi.fn().mockResolvedValue([
      {
        toTask: {
          id: "tsk_child_running",
          status: TaskStatus.RUNNING,
          archivedAt: null,
        },
      },
      {
        toTask: {
          id: "tsk_child_ready",
          status: TaskStatus.READY,
          archivedAt: null,
        },
      },
    ]);

    prismaTransactionMock.mockImplementation(async (callback) => {
      return await callback({
        task: {
          updateMany: updateManyMock,
        },
        taskLink: {
          findMany: taskLinkFindManyMock,
        },
      });
    });

    requireTaskArchiveAccessMock.mockResolvedValue({
      id: "tsk_123",
      ownerId: "user_123",
      status: TaskStatus.READY,
      workspaceId: "22222222-2222-7222-8222-222222222222",
    });

    const app = createApp();
    const response = await app.request("http://localhost/tsk_123", {
      method: "DELETE",
    });

    expect(response.status).toBe(422);
    expect(updateManyMock).toHaveBeenCalledTimes(1);
    const body = await response.json();
    expect(body.message).toContain("RUNNING");
  });

  it("returns 403 for coworker context even when X-Context-User-Id matches owner", async () => {
    const app = createApp("99999999-9999-7999-8999-999999999999", {
      actor: "coworker",
      coworkerId: "cow_123",
      vendorId: "01960001-0001-7001-8001-000000000001",
      context: { userId: "user_123", organizationId: null },
    });

    const response = await app.request("http://localhost/tsk_123", {
      method: "DELETE",
    });

    expect(response.status).toBe(403);
    expect(requireTaskArchiveAccessMock).not.toHaveBeenCalled();
  });
});
