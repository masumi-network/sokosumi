import { TaskStatus } from "@sokosumi/database";
import { HTTPException } from "hono/http-exception";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { OpenAPIHonoWithAuth } from "@/lib/hono";

import mountPatchTask from "./[id]/patch";
import mountPostTask from "./post";

vi.mock("@/middleware/auth", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/middleware/auth")>();
  const { stubAuthMiddleware } = await import(
    "@/test-fixtures/auth-middleware"
  );
  return { ...actual, authMiddleware: stubAuthMiddleware };
});

vi.mock("@/helpers/organization-assigned-seat", () => ({
  requireAssignedOrganizationSeat: vi.fn().mockResolvedValue(undefined),
}));

const {
  prismaTransactionMock,
  requireTaskAssignableCoworkerMock,
  requireTaskOwnershipMock,
  mapTaskMock,
  lockCalendarScopeMock,
  lockTaskRowsMock,
  refreshTaskSchedulePlannedOccurrencesMock,
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
  lockCalendarScopeMock: vi.fn(),
  lockTaskRowsMock: vi.fn(),
  refreshTaskSchedulePlannedOccurrencesMock: vi.fn(),
  validateTaskAssigneeAssignmentMock: vi.fn(),
}));

vi.mock("@/lib/db/prisma", () => ({
  default: {
    $transaction: prismaTransactionMock,
  },
}));

vi.mock("@/helpers/access-control", () => ({
  requireTaskAssignableCoworker: requireTaskAssignableCoworkerMock,
  requireTaskAssignableSokoBot: vi.fn(),
  requireTaskOwnership: requireTaskOwnershipMock,
  requireMutableTaskOwnership: requireTaskOwnershipMock,
}));

vi.mock("@/helpers/calendar-locks", () => ({
  lockCalendarScope: lockCalendarScopeMock,
  lockTaskRows: lockTaskRowsMock,
}));

vi.mock("@/helpers/task-schedule-occurrence-index", () => ({
  refreshTaskSchedulePlannedOccurrences:
    refreshTaskSchedulePlannedOccurrencesMock,
}));

vi.mock("@/helpers/task", () => ({
  mapTask: mapTaskMock,
  validateTaskAssigneeAssignment: validateTaskAssigneeAssignmentMock,
}));

function createApp(activeWorkspaceId = "99999999-9999-7999-8999-999999999999") {
  const app = new OpenAPIHonoWithAuth();

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

  mountPostTask(app);
  mountPatchTask(app);

  return app;
}

describe("task coworker whitelist enforcement", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    lockCalendarScopeMock.mockResolvedValue(true);
    lockTaskRowsMock.mockResolvedValue(true);
    refreshTaskSchedulePlannedOccurrencesMock.mockResolvedValue(undefined);
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
      expect.anything(),
      // Only the owner may put work on their own Soko Bot; the assigner has to
      // reach the check for that rule to apply.
      { kind: "user", userId: expect.any(String) },
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
      expect.anything(),
      // Only the owner may put work on their own Soko Bot; the assigner has to
      // reach the check for that rule to apply.
      { kind: "user", userId: expect.any(String) },
    );
    expect(tx.task.create).not.toHaveBeenCalled();
  });
});
