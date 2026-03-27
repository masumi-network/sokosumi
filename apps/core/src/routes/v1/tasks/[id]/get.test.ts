import { OpenAPIHono } from "@hono/zod-openapi";
import { TaskLinkType, TaskStatus } from "@sokosumi/database";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { OpenAPIHonoWithAuth } from "@/lib/hono";
import type { AuthenticationContext, AuthVariables } from "@/middleware/auth";

import mountGetTaskById from "./get";

const {
  prismaTransactionMock,
  requireScopedTaskReadAccessMock,
  taskFindUniqueMock,
} = vi.hoisted(() => ({
  prismaTransactionMock: vi.fn(),
  requireScopedTaskReadAccessMock: vi.fn(),
  taskFindUniqueMock: vi.fn(),
}));

vi.mock("@/helpers/access-control", () => ({
  requireScopedTaskReadAccess: requireScopedTaskReadAccessMock,
}));

vi.mock("@/lib/db/prisma", () => ({
  default: {
    $transaction: prismaTransactionMock,
  },
}));

function createApp(actor: "user" | "coworker" = "user") {
  const app = new OpenAPIHono<{
    Variables: AuthVariables;
  }>();

  app.use("*", async (c, next) => {
    c.set("isAuthenticated", true);
    c.set(
      "authContext",
      actor === "coworker"
        ? ({
            actor: "coworker",
            coworkerId: "cow_123",
          } satisfies AuthenticationContext)
        : {
            actor: "user",
            userId: "user_123",
            organizationId: "org_123",
          },
    );
    return await next();
  });

  return app;
}

function createTask(
  overrides?: Partial<{
    linksFrom: unknown[];
    linksTo: unknown[];
  }>,
) {
  return {
    id: "tsk_a",
    createdAt: new Date("2026-03-25T10:00:00.000Z"),
    updatedAt: new Date("2026-03-25T10:00:00.000Z"),
    userId: "user_123",
    organizationId: "org_123",
    coworkerId: "cow_123",
    name: "Task A",
    description: null,
    status: TaskStatus.READY,
    events: [],
    jobs: [],
    linksFrom: overrides?.linksFrom ?? [],
    linksTo: overrides?.linksTo ?? [],
  };
}

describe("GET /tasks/{id}", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    requireScopedTaskReadAccessMock.mockResolvedValue(undefined);
    prismaTransactionMock.mockImplementation(
      async (cb: (tx: unknown) => unknown) => {
        return await cb({
          task: {
            findUnique: taskFindUniqueMock,
          },
        });
      },
    );
    taskFindUniqueMock.mockResolvedValue(createTask());
  });

  it("keeps archived peer links visible for user-scoped task reads", async () => {
    const app = createApp();
    mountGetTaskById(app as unknown as OpenAPIHonoWithAuth);

    const response = await app.request("http://localhost/tsk_a?scope=context");

    expect(response.status).toBe(200);
    expect(taskFindUniqueMock).toHaveBeenCalledWith({
      where: { id: "tsk_a", archivedAt: null },
      include: expect.objectContaining({
        linksFrom: {
          include: {
            fromTask: {
              select: {
                id: true,
                name: true,
                status: true,
              },
            },
            toTask: {
              select: {
                id: true,
                name: true,
                status: true,
              },
            },
          },
          where: {
            toTask: {
              is: {
                OR: [{ userId: "user_123", organizationId: "org_123" }],
              },
            },
          },
          orderBy: { createdAt: "asc" },
        },
        linksTo: {
          include: {
            fromTask: {
              select: {
                id: true,
                name: true,
                status: true,
              },
            },
            toTask: {
              select: {
                id: true,
                name: true,
                status: true,
              },
            },
          },
          where: {
            fromTask: {
              is: {
                OR: [{ userId: "user_123", organizationId: "org_123" }],
              },
            },
          },
          orderBy: { createdAt: "asc" },
        },
      }),
    });
  });

  it("filters included links to peer tasks visible to the coworker", async () => {
    const app = createApp("coworker");
    mountGetTaskById(app as unknown as OpenAPIHonoWithAuth);

    const response = await app.request("http://localhost/tsk_a?scope=context");

    expect(response.status).toBe(200);
    expect(taskFindUniqueMock).toHaveBeenCalledWith({
      where: { id: "tsk_a", archivedAt: null },
      include: expect.objectContaining({
        linksFrom: {
          include: {
            fromTask: {
              select: {
                id: true,
                name: true,
                status: true,
              },
            },
            toTask: {
              select: {
                id: true,
                name: true,
                status: true,
              },
            },
          },
          where: {
            toTask: {
              is: {
                coworkerId: "cow_123",
                archivedAt: null,
                NOT: { status: { in: [TaskStatus.DRAFT] } },
              },
            },
          },
          orderBy: { createdAt: "asc" },
        },
        linksTo: {
          include: {
            fromTask: {
              select: {
                id: true,
                name: true,
                status: true,
              },
            },
            toTask: {
              select: {
                id: true,
                name: true,
                status: true,
              },
            },
          },
          where: {
            fromTask: {
              is: {
                coworkerId: "cow_123",
                archivedAt: null,
                NOT: { status: { in: [TaskStatus.DRAFT] } },
              },
            },
          },
          orderBy: { createdAt: "asc" },
        },
      }),
    });
  });

  it("returns nested peerTask summaries on task detail links", async () => {
    taskFindUniqueMock.mockResolvedValue(
      createTask({
        linksFrom: [
          {
            id: "tl_1",
            createdAt: new Date("2026-03-25T10:00:00.000Z"),
            updatedAt: new Date("2026-03-25T10:00:00.000Z"),
            fromTaskId: "tsk_a",
            toTaskId: "tsk_b",
            type: TaskLinkType.RELATES,
            note: null,
            toTask: {
              id: "tsk_b",
              name: "Task B",
              status: TaskStatus.RUNNING,
            },
          },
        ],
      }),
    );

    const app = createApp();
    mountGetTaskById(app as unknown as OpenAPIHonoWithAuth);

    const response = await app.request("http://localhost/tsk_a?scope=context");

    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      data: {
        links: Array<{
          peerTaskId: string;
          peerTask: { id: string; name: string; status: TaskStatus } | null;
        }>;
      };
    };
    expect(body.data.links).toHaveLength(1);
    expect(body.data.links[0]).toMatchObject({
      peerTaskId: "tsk_b",
      peerTask: {
        id: "tsk_b",
        name: "Task B",
        status: TaskStatus.RUNNING,
      },
    });
  });
});
