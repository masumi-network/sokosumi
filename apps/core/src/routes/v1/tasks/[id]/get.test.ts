import { OpenAPIHono } from "@hono/zod-openapi";
import { TaskLinkType, TaskStatus } from "@sokosumi/database";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { OpenAPIHonoWithAuth } from "@/lib/hono";
import type { AuthenticationContext, AuthVariables } from "@/middleware/auth";
import type { WorkspaceVariables } from "@/middleware/workspace";

import mountGetTaskById from "./get";

const {
  prismaTransactionMock,
  taskFindFirstMock,
  taskFindUniqueMock,
  coworkerFindFirstMock,
} = vi.hoisted(() => ({
  prismaTransactionMock: vi.fn(),
  taskFindFirstMock: vi.fn(),
  taskFindUniqueMock: vi.fn(),
  coworkerFindFirstMock: vi.fn(),
}));

vi.mock("@/lib/db/prisma", () => ({
  default: {
    $transaction: prismaTransactionMock,
  },
}));

const testWorkspaceId = "11111111-1111-7111-8111-111111111111";

interface CreateAppOptions {
  actor?: "user" | "coworker";
  userId?: string;
}

function createApp(options: CreateAppOptions = {}) {
  const { actor = "user", userId = "user_123" } = options;
  const app = new OpenAPIHono<{
    Variables: AuthVariables & WorkspaceVariables;
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
            userId,
            organizationId: "org_123",
          },
    );
    c.set(
      "workspaceContext",
      actor === "user"
        ? {
            workspaceId: testWorkspaceId,
            userId: null,
            organizationId: "org_123",
          }
        : null,
    );
    return await next();
  });

  return app;
}

function createTask(
  overrides?: Partial<{
    userId: string;
    share: {
      id: string;
      token: string;
      taskId: string;
      allowSearchIndexing: boolean;
      createdAt: Date;
      updatedAt: Date;
    } | null;
    linksFrom: unknown[];
    linksTo: unknown[];
  }>,
) {
  return {
    id: "tsk_a",
    createdAt: new Date("2026-03-25T10:00:00.000Z"),
    updatedAt: new Date("2026-03-25T10:00:00.000Z"),
    userId: overrides?.userId ?? "user_123",
    organizationId: "org_123",
    coworkerId: "cow_123",
    name: "Task A",
    description: null,
    status: TaskStatus.READY,
    events: [],
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
    share: overrides?.share ?? null,
    linksFrom: overrides?.linksFrom ?? [],
    linksTo: overrides?.linksTo ?? [],
  };
}

/** Payload returned for the viewer query (`findFirst` with `include`). Access checks use a separate call. */
let viewerTaskIncludeResult = createTask();

describe("GET /tasks/{id}", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    viewerTaskIncludeResult = createTask();
    prismaTransactionMock.mockImplementation(
      async (cb: (tx: unknown) => unknown) => {
        return await cb({
          coworker: {
            findFirst: coworkerFindFirstMock,
          },
          task: {
            findFirst: taskFindFirstMock,
            findUnique: taskFindUniqueMock,
          },
        });
      },
    );
    coworkerFindFirstMock.mockResolvedValue({
      id: "cow_123",
      slug: "cow",
      baseURL: "http://coworker.test",
    });
    taskFindUniqueMock.mockResolvedValue(createTask());
    taskFindFirstMock.mockImplementation(
      async (args: { include?: unknown }) => {
        if (args.include !== undefined) {
          return viewerTaskIncludeResult;
        }
        return createTask();
      },
    );
  });

  it("filters archived peer links from user task reads", async () => {
    const app = createApp();
    mountGetTaskById(app as unknown as OpenAPIHonoWithAuth);

    const response = await app.request("http://localhost/tsk_a");

    expect(response.status).toBe(200);
    expect(taskFindFirstMock).toHaveBeenCalledWith({
      where: {
        id: "tsk_a",
        archivedAt: null,
        workspaceId: testWorkspaceId,
      },
      include: expect.objectContaining({
        share: true,
        linksFrom: {
          where: {
            toTask: {
              is: {
                workspaceId: testWorkspaceId,
                archivedAt: null,
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
                workspaceId: testWorkspaceId,
                archivedAt: null,
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

  it("keeps same-workspace peer links visible for a workspace collaborator", async () => {
    viewerTaskIncludeResult = createTask({
      userId: "user_123",
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
    });

    const app = createApp({ userId: "user_456" });
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
    expect(taskFindFirstMock).toHaveBeenCalledWith({
      where: {
        id: "tsk_a",
        archivedAt: null,
        workspaceId: testWorkspaceId,
      },
      include: expect.objectContaining({
        linksFrom: {
          where: {
            toTask: {
              is: {
                workspaceId: testWorkspaceId,
                archivedAt: null,
              },
            },
          },
          include: expect.any(Object),
          orderBy: { createdAt: "asc" },
        },
        linksTo: {
          where: {
            fromTask: {
              is: {
                workspaceId: testWorkspaceId,
                archivedAt: null,
              },
            },
          },
          include: expect.any(Object),
          orderBy: { createdAt: "asc" },
        },
      }),
    });
  });

  it("filters included links to peer tasks visible to the coworker", async () => {
    const app = createApp({ actor: "coworker" });
    mountGetTaskById(app as unknown as OpenAPIHonoWithAuth);

    const response = await app.request("http://localhost/tsk_a");

    expect(response.status).toBe(200);
    expect(taskFindFirstMock).toHaveBeenCalledWith({
      where: {
        id: "tsk_a",
      },
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

  it("returns an existing share token to a workspace collaborator", async () => {
    viewerTaskIncludeResult = createTask({
      userId: "user_123",
      share: {
        id: "share_123",
        token: "public-share-token",
        taskId: "tsk_a",
        allowSearchIndexing: true,
        createdAt: new Date("2026-03-25T10:00:00.000Z"),
        updatedAt: new Date("2026-03-25T10:00:00.000Z"),
      },
    });

    const app = createApp({ userId: "user_456" });
    mountGetTaskById(app as unknown as OpenAPIHonoWithAuth);

    const response = await app.request("http://localhost/tsk_a");

    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      data: {
        userId: string;
        share: {
          id: string;
          token: string;
          taskId: string;
          allowSearchIndexing: boolean;
        } | null;
      };
    };
    expect(body.data).toMatchObject({
      userId: "user_123",
      share: {
        id: "share_123",
        token: "public-share-token",
        taskId: "tsk_a",
        allowSearchIndexing: true,
      },
    });
    expect(taskFindFirstMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          id: "tsk_a",
          archivedAt: null,
          workspaceId: testWorkspaceId,
        },
      }),
    );
  });

  it("returns nested peerTask summaries on task detail links", async () => {
    viewerTaskIncludeResult = createTask({
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
    });

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
});
