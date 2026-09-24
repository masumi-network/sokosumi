import { TaskStatus } from "@sokosumi/database";
import { getTaskCannotArchiveMessage } from "@sokosumi/utils";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { errorHandler } from "@/helpers/error-handler";
import { buildHumanTaskVisibilityWhere } from "@/helpers/task-visibility";
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
  deliverCalendarInvalidationsNowMock,
  mapTaskMock,
  markTaskArchivedReadMock,
  prismaTransactionMock,
  requireTaskArchiveAccessMock,
} = vi.hoisted(() => ({
  markTaskArchivedReadMock: vi.fn(),
  deliverCalendarInvalidationsNowMock: vi.fn(),
  prismaTransactionMock: vi.fn(),
  requireTaskArchiveAccessMock: vi.fn(),
  mapTaskMock: vi.fn((task: unknown) => {
    const t = task as Record<string, unknown>;
    const status = t.status as string | undefined;
    return {
      ...t,
      visibility: (t.visibility as string | undefined) ?? "PUBLIC",
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
      project: t.project ?? null,
      assigneeSokoBotId:
        (t.assigneeSokoBotId as string | null | undefined) ?? null,
      assigneeUserId: (t.assigneeUserId as string | null | undefined) ?? null,
      assignee:
        t.assignee ??
        (t.assigneeSokoBotId
          ? {
              type: "sokoBot" as const,
              id: t.assigneeSokoBotId,
              sokoBot: {
                id: t.assigneeSokoBotId,
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
        const creatorSokoBotId =
          (t.creatorSokoBotId as string | null | undefined) ?? null;
        if (creatorSokoBotId != null) {
          return {
            type: "sokoBot" as const,
            id: creatorSokoBotId,
            sokoBot: (t.creatorSokoBot as object | null | undefined) ?? {
              id: creatorSokoBotId,
              name: "SokoBot",
              slug: "soko-bot",
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
      sokoBotId:
        (t.sokoBotId as string | null | undefined) ??
        (t.creatorSokoBotId as string | null | undefined) ??
        null,
      sokoBot:
        (t.sokoBot as object | null | undefined) ??
        (t.creatorSokoBot as object | null | undefined) ??
        null,
    };
  }),
}));

vi.mock("@/helpers/task-notifications", () => ({
  markTaskArchivedRead: markTaskArchivedReadMock,
}));

vi.mock("@/helpers/calendar-invalidation", () => ({
  deliverCalendarInvalidationsNow: deliverCalendarInvalidationsNowMock,
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
  runAt: null,
  scheduleId: null,
  selectableStatuses: [],
  linksFrom: [],
  linksTo: [],
};

describe("DELETE /tasks/{id}", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  /**
   * An archived task cannot be opened, so every row still asking somebody to
   * act on it stops being a question. Nothing else clears them, and the
   * follow-up sync would remind a day later about a task nobody can act on
   * (SOK-916). Four archivable statuses are non-terminal, so the rows can
   * still be outstanding.
   */
  it("marks the attention rows read when the task is archived", async () => {
    const findFirstOrThrowMock = vi.fn().mockResolvedValue({
      ...archivedTask,
      assigneeUserId: "user_assignee",
    });

    prismaTransactionMock.mockImplementation(async (callback) => {
      return await callback({
        task: {
          updateMany: vi.fn().mockResolvedValue({ count: 1 }),
          findFirstOrThrow: findFirstOrThrowMock,
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

    expect(response.status).toBe(200);
    expect(markTaskArchivedReadMock).toHaveBeenCalledWith(
      expect.objectContaining({
        id: "tsk_123",
        ownerId: "user_123",
        assigneeUserId: "user_assignee",
      }),
    );
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
      ownerId: "user_123",
      status: TaskStatus.READY,
      workspaceId: "22222222-2222-7222-8222-222222222222",
    });

    const app = createApp();
    const response = await app.request("http://localhost/tsk_123", {
      method: "DELETE",
    });

    expect(response.status).toBe(200);
    expect(deliverCalendarInvalidationsNowMock).toHaveBeenCalledWith(
      "22222222-2222-7222-8222-222222222222",
    );
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
                is: expect.objectContaining({
                  workspaceId: "22222222-2222-7222-8222-222222222222",
                  archivedAt: null,
                  ...buildHumanTaskVisibilityWhere("user_123"),
                }),
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
      return await callback({
        task: {
          updateMany: updateManyMock,
          findFirstOrThrow: findFirstOrThrowMock,
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

  it("archives a Queued Task with a Run at like any other Task", async () => {
    const updateManyMock = vi.fn().mockResolvedValue({ count: 1 });
    prismaTransactionMock.mockImplementation(async (callback) => {
      return await callback({
        task: {
          updateMany: updateManyMock,
          findFirstOrThrow: vi.fn().mockResolvedValue(archivedTask),
        },
      });
    });

    requireTaskArchiveAccessMock.mockResolvedValue({
      id: "tsk_123",
      ownerId: "user_123",
      status: TaskStatus.QUEUED,
      workspaceId: "22222222-2222-7222-8222-222222222222",
      runAt: new Date("2026-09-10T09:00:00.000Z"),
      scheduleId: "33333333-3333-7333-8333-333333333333",
    });

    const app = createApp();
    const response = await app.request("http://localhost/tsk_123", {
      method: "DELETE",
    });

    expect(response.status).toBe(200);
    expect(updateManyMock).toHaveBeenCalledWith({
      where: { id: "tsk_123", archivedAt: null, status: TaskStatus.QUEUED },
      data: { archivedAt: expect.any(Date) },
    });
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
