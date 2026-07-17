import { OpenAPIHono } from "@hono/zod-openapi";
import { TaskLinkType, TaskStatus } from "@sokosumi/database";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  buildCoworkerAuthorizedTaskWhere,
  buildCoworkerSiblingTaskListFilter,
} from "@/helpers/vendor-siblings";
import type { OpenAPIHonoWithAuth } from "@/lib/hono";
import type { AuthenticationContext, AuthVariables } from "@/middleware/auth";
import type { WorkspaceVariables } from "@/middleware/workspace";
import mountGetTaskById from "./get";

const { taskFindFirstMock, coworkerFindFirstMock } = vi.hoisted(() => ({
  taskFindFirstMock: vi.fn(),
  coworkerFindFirstMock: vi.fn(),
}));

vi.mock("@/lib/db/prisma", () => ({
  default: {
    coworker: {
      findFirst: coworkerFindFirstMock,
    },
    task: {
      findFirst: taskFindFirstMock,
    },
  },
}));

const testWorkspaceId = "11111111-1111-7111-8111-111111111111";

interface CreateAppOptions {
  actor?: "user" | "coworker" | "orchestrator";
  userId?: string;
  context?: {
    userId: string;
    organizationId: string | null;
  };
}

function createApp(options: CreateAppOptions = {}) {
  const { actor = "user", userId = "user_123", context } = options;
  const app = new OpenAPIHono<{
    Variables: AuthVariables & WorkspaceVariables;
  }>();

  app.use("*", async (c, next) => {
    c.set("isAuthenticated", true);
    const authContext: AuthenticationContext =
      actor === "coworker"
        ? {
            actor: "coworker",
            coworkerId: "cow_123",
            vendorId: "01960001-0001-7001-8001-000000000001",
            ...(context ? { context } : {}),
          }
        : actor === "orchestrator"
          ? {
              actor: "orchestrator",
              orchestratorId: "01960001-0001-7001-8001-000000000099",
              ...(context ? { context } : {}),
            }
          : {
              actor: "user",
              userId,
              organizationId: "org_123",
              role: "user",
            };
    c.set("authContext", authContext);
    c.set(
      "workspaceContext",
      actor === "user" || context
        ? {
            workspaceId: testWorkspaceId,
            userId: context?.userId ?? userId,
            organizationId: context?.organizationId ?? "org_123",
          }
        : null,
    );
    return await next();
  });

  return app;
}

function createTask(
  overrides?: Partial<{
    ownerId: string;
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
  const ownerId = overrides?.ownerId ?? "user_123";
  return {
    id: "tsk_a",
    createdAt: new Date("2026-03-25T10:00:00.000Z"),
    updatedAt: new Date("2026-03-25T10:00:00.000Z"),
    ownerId,
    owner: { id: ownerId, name: "Task Owner", image: null },
    organizationId: "org_123",
    projectId: null,
    organization: {
      id: "org_123",
      name: "Acme Labs",
      slug: "acme-labs",
    },
    assigneeId: "cow_123",
    assignee: {
      id: "cow_123",
      name: "Coworker",
      image: null,
      slug: "cow-worker",
    },
    creatorOrchestratorId: null,
    creatorOrchestrator: null,
    name: "Task A",
    description: null,
    status: TaskStatus.READY,
    metadata: null,
    nextRunAt: null,
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

/** Payload returned for the viewer query (`findFirst` with `include`). */
let viewerTaskIncludeResult = createTask();

const defaultVendorId = "01960001-0001-7001-8001-000000000001";
const defaultCoworkerId = "cow_123";

const bareCoworkerVisiblePeerTaskWhere = {
  archivedAt: null,
  ...buildCoworkerSiblingTaskListFilter({
    coworkerId: defaultCoworkerId,
    vendorId: defaultVendorId,
  }),
};

const delegatedCoworkerVisiblePeerTaskWhere = {
  workspaceId: testWorkspaceId,
  archivedAt: null,
  ...buildCoworkerSiblingTaskListFilter({
    coworkerId: defaultCoworkerId,
    vendorId: defaultVendorId,
  }),
};

describe("GET /tasks/{id}", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    viewerTaskIncludeResult = createTask();
    coworkerFindFirstMock.mockResolvedValue({
      id: "cow_123",
      slug: "cow",
      baseURL: "http://coworker.test",
    });
    taskFindFirstMock.mockImplementation(
      async (args: { include?: unknown }) => {
        if (args.include !== undefined) {
          return viewerTaskIncludeResult;
        }
        return {
          id: "tsk_a",
          ownerId: "user_123",
          coworkerId: "cow_123",
          status: TaskStatus.READY,
          assignee: { vendorId: defaultVendorId },
        };
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
      ownerId: "user_123",
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
      where: buildCoworkerAuthorizedTaskWhere({
        taskId: "tsk_a",
        coworkerId: "cow_123",
        vendorId: defaultVendorId,
      }),
      include: expect.objectContaining({
        share: true,
        linksFrom: {
          where: {
            toTask: {
              is: bareCoworkerVisiblePeerTaskWhere,
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
              is: bareCoworkerVisiblePeerTaskWhere,
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

  it("uses workspace-scoped reads for delegated coworkers", async () => {
    const app = createApp({
      actor: "coworker",
      context: {
        userId: "user_delegate",
        organizationId: "org_delegate",
      },
    });
    mountGetTaskById(app as unknown as OpenAPIHonoWithAuth);

    const response = await app.request("http://localhost/tsk_a");

    expect(response.status).toBe(200);
    expect(taskFindFirstMock).toHaveBeenCalledTimes(1);
    expect(taskFindFirstMock).toHaveBeenCalledWith({
      where: buildCoworkerAuthorizedTaskWhere({
        taskId: "tsk_a",
        coworkerId: "cow_123",
        vendorId: defaultVendorId,
        workspaceId: testWorkspaceId,
      }),
      include: expect.objectContaining({
        share: true,
        linksFrom: {
          where: {
            toTask: {
              is: delegatedCoworkerVisiblePeerTaskWhere,
            },
          },
          include: expect.any(Object),
          orderBy: { createdAt: "asc" },
        },
        linksTo: {
          where: {
            fromTask: {
              is: delegatedCoworkerVisiblePeerTaskWhere,
            },
          },
          include: expect.any(Object),
          orderBy: { createdAt: "asc" },
        },
      }),
    });
  });

  it("uses workspace-scoped peer links for contextual orchestrators", async () => {
    const app = createApp({
      actor: "orchestrator",
      context: {
        userId: "user_delegate",
        organizationId: "org_delegate",
      },
    });
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

  it("allows a delegated coworker to read a same-vendor sibling task", async () => {
    viewerTaskIncludeResult = createTask();
    taskFindFirstMock.mockImplementation(
      async (args: { include?: unknown }) => {
        if (args.include !== undefined) {
          return viewerTaskIncludeResult;
        }
        return {
          id: "tsk_a",
          ownerId: "user_123",
          assigneeId: "cow_sibling",
          status: TaskStatus.READY,
          assignee: { vendorId: defaultVendorId },
        };
      },
    );

    const app = createApp({
      actor: "coworker",
      context: {
        userId: "user_delegate",
        organizationId: "org_delegate",
      },
    });
    mountGetTaskById(app as unknown as OpenAPIHonoWithAuth);

    const response = await app.request("http://localhost/tsk_a");

    expect(response.status).toBe(200);
  });

  it("rejects a delegated coworker reading a cross-vendor sibling task", async () => {
    taskFindFirstMock.mockResolvedValue(null);

    const app = createApp({
      actor: "coworker",
      context: {
        userId: "user_delegate",
        organizationId: "org_delegate",
      },
    });
    mountGetTaskById(app as unknown as OpenAPIHonoWithAuth);

    const response = await app.request("http://localhost/tsk_a");

    expect(response.status).toBe(404);
    expect(taskFindFirstMock).toHaveBeenCalledTimes(2);
  });

  it("allows a bare coworker to read a same-vendor sibling task without workspace scoping", async () => {
    viewerTaskIncludeResult = createTask();
    taskFindFirstMock.mockImplementation(
      async (args: { include?: unknown }) => {
        if (args.include !== undefined) {
          return viewerTaskIncludeResult;
        }
        return {
          id: "tsk_a",
          ownerId: "user_123",
          assigneeId: "cow_sibling",
          status: TaskStatus.READY,
          assignee: { vendorId: defaultVendorId },
        };
      },
    );

    const app = createApp({ actor: "coworker" });
    mountGetTaskById(app as unknown as OpenAPIHonoWithAuth);

    const response = await app.request("http://localhost/tsk_a");

    expect(response.status).toBe(200);
    expect(taskFindFirstMock).toHaveBeenCalledWith({
      where: buildCoworkerAuthorizedTaskWhere({
        taskId: "tsk_a",
        coworkerId: "cow_123",
        vendorId: defaultVendorId,
      }),
      include: expect.objectContaining({
        share: true,
      }),
    });
  });

  it("returns an existing share token to a workspace collaborator", async () => {
    viewerTaskIncludeResult = createTask({
      ownerId: "user_123",
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
        ownerId: string;
        share: {
          id: string;
          token: string;
          taskId: string;
          allowSearchIndexing: boolean;
        } | null;
      };
    };
    expect(body.data).toMatchObject({
      ownerId: "user_123",
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
