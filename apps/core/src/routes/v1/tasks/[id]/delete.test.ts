import { OpenAPIHono } from "@hono/zod-openapi";
import { TaskStatus } from "@sokosumi/database";
import { getTaskCannotArchiveMessage } from "@sokosumi/utils";
import type { RequestIdVariables } from "hono/request-id";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { errorHandler } from "@/helpers/error-handler";
import type { OpenAPIHonoWithAuth } from "@/lib/hono";
import type { AuthVariables } from "@/middleware/auth";
import type { WorkspaceVariables } from "@/middleware/workspace";

import mountDeleteTask from "./delete";

const { prismaTransactionMock, requireTaskArchiveAccessMock, mapTaskMock } =
  vi.hoisted(() => ({
    prismaTransactionMock: vi.fn(),
    requireTaskArchiveAccessMock: vi.fn(),
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
        orchestratorId: (t.orchestratorId as string | null | undefined) ?? null,
        orchestrator: (t.orchestrator as object | null | undefined) ?? null,
      };
    }),
  }));

vi.mock("@/helpers/access-control", () => ({
  requireTaskArchiveAccess: requireTaskArchiveAccessMock,
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

function createApp(activeWorkspaceId = "99999999-9999-7999-8999-999999999999") {
  const app = new OpenAPIHono<{
    Variables: AuthVariables & WorkspaceVariables & RequestIdVariables;
  }>();

  app.use("*", async (c, next) => {
    c.set("requestId", "req_delete_route_test");
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

  app.onError(errorHandler);

  mountDeleteTask(app as unknown as OpenAPIHonoWithAuth);

  return app;
}

const archivedTask = {
  id: "tsk_123",
  createdAt: "2026-03-25T10:00:00.000Z",
  updatedAt: "2026-03-25T10:00:00.000Z",
  userId: "user_123",
  organizationId: null,
  projectId: null,
  status: TaskStatus.READY,
  coworkerId: null,
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
  linksFrom: [],
  linksTo: [],
};

describe("DELETE /tasks/{id}", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("uses the task workspace for link visibility in the archive response", async () => {
    const updateManyMock = vi.fn().mockResolvedValue({ count: 1 });
    const findFirstOrThrowMock = vi.fn().mockResolvedValue(archivedTask);

    prismaTransactionMock.mockImplementation(async (callback) => {
      return await callback({
        task: {
          updateMany: updateManyMock,
          findFirstOrThrow: findFirstOrThrowMock,
        },
      });
    });

    requireTaskArchiveAccessMock.mockResolvedValue({
      id: "tsk_123",
      userId: "user_123",
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
      userId: "user_123",
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
      return await callback({
        task: {
          updateMany: updateManyMock,
          findFirstOrThrow: findFirstOrThrowMock,
        },
      });
    });

    requireTaskArchiveAccessMock.mockResolvedValue({
      id: "tsk_123",
      userId: "user_other",
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
      userId: "user_other",
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
});
