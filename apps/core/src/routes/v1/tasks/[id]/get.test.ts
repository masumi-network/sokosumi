import { OpenAPIHono } from "@hono/zod-openapi";
import { TaskLinkType, TaskStatus } from "@sokosumi/database";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { OpenAPIHonoWithAuth } from "@/lib/hono";
import type { AuthenticationContext, AuthVariables } from "@/middleware/auth";

import mountGetTaskById from "./get";

const {
  prismaTransactionMock,
  requireCoworkerTaskAccessMock,
  requireWorkspaceTaskAccessMock,
  findWorkspaceForContextMock,
  taskFindUniqueMock,
} = vi.hoisted(() => ({
  prismaTransactionMock: vi.fn(),
  requireCoworkerTaskAccessMock: vi.fn(),
  requireWorkspaceTaskAccessMock: vi.fn(),
  findWorkspaceForContextMock: vi.fn(),
  taskFindUniqueMock: vi.fn(),
}));

vi.mock("@/helpers/access-control", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@/helpers/access-control")>();

  return {
    ...actual,
    requireCoworkerTaskAccess: requireCoworkerTaskAccessMock,
    requireWorkspaceTaskAccess: requireWorkspaceTaskAccessMock,
  };
});

vi.mock("@sokosumi/database/helpers", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@sokosumi/database/helpers")>();

  return {
    ...actual,
    findWorkspaceForContext: findWorkspaceForContextMock,
  };
});

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
    events: unknown[];
  }>,
) {
  return {
    id: "tsk_a",
    createdAt: new Date("2026-03-25T10:00:00.000Z"),
    updatedAt: new Date("2026-03-25T10:00:00.000Z"),
    userId: "user_123",
    user: {
      id: "user_123",
      name: "Ada Lovelace",
      image: "https://example.com/ada.png",
    },
    organizationId: "org_123",
    coworkerId: "cow_123",
    name: "Task A",
    description: null,
    status: TaskStatus.READY,
    events: overrides?.events ?? [],
    jobs: [],
    workspace: {
      id: "11111111-1111-7111-8111-111111111111",
      organizationId: "org_123",
      organization: {
        id: "org_123",
        name: "Acme Labs",
        slug: "acme-labs",
      },
    },
    share: null,
    linksFrom: overrides?.linksFrom ?? [],
    linksTo: overrides?.linksTo ?? [],
  };
}

describe("GET /tasks/{id}", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    requireWorkspaceTaskAccessMock.mockResolvedValue(undefined);
    requireCoworkerTaskAccessMock.mockResolvedValue(undefined);
    findWorkspaceForContextMock.mockResolvedValue({
      id: "11111111-1111-7111-8111-111111111111",
    });
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

  it("keeps archived peer links visible for user-owned task reads", async () => {
    const app = createApp();
    mountGetTaskById(app as unknown as OpenAPIHonoWithAuth);

    const response = await app.request("http://localhost/tsk_a");

    expect(response.status).toBe(200);
    expect(requireWorkspaceTaskAccessMock).toHaveBeenCalledWith(
      {
        actor: "user",
        userId: "user_123",
        organizationId: "org_123",
      },
      "tsk_a",
      expect.any(Object),
    );
    expect(taskFindUniqueMock).toHaveBeenCalledWith({
      where: { id: "tsk_a", archivedAt: null },
      include: expect.objectContaining({
        user: {
          select: {
            id: true,
            name: true,
            image: true,
          },
        },
        events: {
          include: {
            user: {
              select: {
                id: true,
                name: true,
                image: true,
              },
            },
            transaction: {
              select: {
                amount: true,
              },
            },
          },
          orderBy: { createdAt: "asc" },
        },
        share: true,
        linksFrom: {
          where: {
            toTask: {
              is: {
                workspaceId: "11111111-1111-7111-8111-111111111111",
              },
            },
          },
          include: {
            fromTask: {
              select: {
                id: true,
                name: true,
                status: true,
                archivedAt: true,
              },
            },
            toTask: {
              select: {
                id: true,
                name: true,
                status: true,
                archivedAt: true,
              },
            },
          },
          orderBy: { createdAt: "asc" },
        },
        linksTo: {
          where: {
            fromTask: {
              is: {
                workspaceId: "11111111-1111-7111-8111-111111111111",
              },
            },
          },
          include: {
            fromTask: {
              select: {
                id: true,
                name: true,
                status: true,
                archivedAt: true,
              },
            },
            toTask: {
              select: {
                id: true,
                name: true,
                status: true,
                archivedAt: true,
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

    const response = await app.request("http://localhost/tsk_a");

    expect(response.status).toBe(200);
    expect(requireCoworkerTaskAccessMock).toHaveBeenCalledWith(
      {
        actor: "coworker",
        coworkerId: "cow_123",
      },
      "tsk_a",
      expect.any(Object),
    );
    expect(taskFindUniqueMock).toHaveBeenCalledWith({
      where: { id: "tsk_a", archivedAt: null },
      include: expect.objectContaining({
        share: true,
        linksFrom: {
          where: {
            toTask: {
              is: {
                coworkerId: "cow_123",
                archivedAt: null,
                NOT: { status: { in: [TaskStatus.DRAFT] } },
              },
            },
          },
          include: {
            fromTask: {
              select: {
                id: true,
                name: true,
                status: true,
                archivedAt: true,
              },
            },
            toTask: {
              select: {
                id: true,
                name: true,
                status: true,
                archivedAt: true,
              },
            },
          },
          orderBy: { createdAt: "asc" },
        },
        linksTo: {
          where: {
            fromTask: {
              is: {
                coworkerId: "cow_123",
                archivedAt: null,
                NOT: { status: { in: [TaskStatus.DRAFT] } },
              },
            },
          },
          include: {
            fromTask: {
              select: {
                id: true,
                name: true,
                status: true,
                archivedAt: true,
              },
            },
            toTask: {
              select: {
                id: true,
                name: true,
                status: true,
                archivedAt: true,
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
              archivedAt: null,
            },
          },
        ],
      }),
    );

    const app = createApp();
    mountGetTaskById(app as unknown as OpenAPIHonoWithAuth);

    const response = await app.request("http://localhost/tsk_a");

    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      data: {
        links: Array<{
          relation: string;
          peerTask: {
            id: string;
            name: string;
            status: TaskStatus;
            archivedAt: string | null;
          };
        }>;
      };
    };
    expect(body.data.links).toHaveLength(1);
    expect(body.data.links[0]).toMatchObject({
      relation: "related",
      peerTask: {
        id: "tsk_b",
        name: "Task B",
        status: TaskStatus.RUNNING,
        archivedAt: null,
      },
    });
  });

  it("returns creator and event user summaries", async () => {
    taskFindUniqueMock.mockResolvedValue(
      createTask({
        events: [
          {
            id: "evt_1",
            createdAt: new Date("2026-03-25T11:00:00.000Z"),
            updatedAt: new Date("2026-03-25T11:00:00.000Z"),
            taskId: "tsk_a",
            status: null,
            comment: "Created by teammate",
            authenticationUrl: null,
            origin: "SOKOSUMI",
            userId: "user_456",
            user: {
              id: "user_456",
              name: "Grace Hopper",
              image: "https://example.com/grace.png",
            },
            coworkerId: null,
            transactionId: null,
            cents: null,
            transaction: null,
          },
        ],
      }),
    );
    const app = createApp();
    mountGetTaskById(app as unknown as OpenAPIHonoWithAuth);

    const response = await app.request("http://localhost/tsk_a");

    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      data: {
        user: {
          id: string;
          name: string;
          image: string | null;
        };
        events: Array<{
          user: {
            id: string;
            name: string;
            image: string | null;
          } | null;
        }>;
      };
    };

    expect(body.data.user).toEqual({
      id: "user_123",
      name: "Ada Lovelace",
      image: "https://example.com/ada.png",
    });
    expect(body.data.events[0]?.user).toEqual({
      id: "user_456",
      name: "Grace Hopper",
      image: "https://example.com/grace.png",
    });
  });
});
