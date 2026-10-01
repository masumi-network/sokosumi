import {
  TaskLinkType,
  TaskPriority,
  TaskStatus,
  TaskVisibility,
} from "@sokosumi/database";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { buildHumanTaskVisibilityWhere } from "@/helpers/task-visibility";
import {
  buildCoworkerAuthorizedTaskWhere,
  buildCoworkerSiblingTaskListFilter,
} from "@/helpers/vendor-siblings";
import { OpenAPIHonoWithAuth } from "@/lib/hono";
import type { AuthenticationContext } from "@/middleware/auth";
import { taskLinkPeerTaskSelect } from "@/types/task-link";
import mountGetTaskById from "./get";

vi.mock("@/middleware/auth", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/middleware/auth")>();
  const { stubAuthMiddleware } = await import(
    "@/test-fixtures/auth-middleware"
  );
  return { ...actual, authMiddleware: stubAuthMiddleware };
});

const {
  taskFindFirstMock,
  taskFindUniqueMock,
  projectFindUniqueMock,
  aliasFindUniqueMock,
  coworkerFindFirstMock,
} = vi.hoisted(() => ({
  taskFindFirstMock: vi.fn(),
  taskFindUniqueMock: vi.fn(),
  projectFindUniqueMock: vi.fn(),
  aliasFindUniqueMock: vi.fn(),
  coworkerFindFirstMock: vi.fn(),
}));

vi.mock("@/lib/db/prisma", () => ({
  default: {
    coworker: {
      findFirst: coworkerFindFirstMock,
    },
    task: {
      findFirst: taskFindFirstMock,
      findUnique: taskFindUniqueMock,
    },
    project: { findUnique: projectFindUniqueMock },
    taskIdentifierAlias: { findUnique: aliasFindUniqueMock },
  },
}));

const testWorkspaceId = "11111111-1111-7111-8111-111111111111";

interface CreateAppOptions {
  actor?: "user" | "coworker";
  userId?: string;
  context?: {
    userId: string;
    organizationId: string | null;
  };
}

function createApp(options: CreateAppOptions = {}) {
  const { actor = "user", userId = "user_123", context } = options;
  const app = new OpenAPIHonoWithAuth();

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
    status: TaskStatus;
    runAt: Date | null;
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
    assigneeSokoBotId: null,
    assigneeSokoBot: null,
    creatorUserId: ownerId,
    creatorUser: { id: ownerId, name: "Task Owner", image: null },
    creatorCoworkerId: null,
    creatorCoworker: null,
    creatorSokoBotId: null,
    creatorSokoBot: null,
    name: "Task A",
    description: null,
    status: overrides?.status ?? TaskStatus.READY,
    visibility: TaskVisibility.PUBLIC,
    priority: TaskPriority.NONE,
    number: null,
    runAt: overrides?.runAt ?? null,
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
    mountGetTaskById(app);

    const response = await app.request("http://localhost/tsk_a");

    expect(response.status).toBe(200);
    expect(taskFindFirstMock).toHaveBeenCalledWith({
      where: {
        id: "tsk_a",
        archivedAt: null,
        workspaceId: testWorkspaceId,
        ...buildHumanTaskVisibilityWhere("user_123"),
      },
      include: expect.objectContaining({
        share: true,
        linksFrom: {
          where: {
            toTask: {
              is: expect.objectContaining({
                workspaceId: testWorkspaceId,
                archivedAt: null,
                ...buildHumanTaskVisibilityWhere("user_123"),
              }),
            },
          },
          include: {
            fromTask: {
              select: taskLinkPeerTaskSelect,
            },
            toTask: {
              select: taskLinkPeerTaskSelect,
            },
          },
          orderBy: { createdAt: "asc" },
        },
        linksTo: {
          where: {
            fromTask: {
              is: expect.objectContaining({
                workspaceId: testWorkspaceId,
                archivedAt: null,
                ...buildHumanTaskVisibilityWhere("user_123"),
              }),
            },
          },
          include: {
            fromTask: {
              select: taskLinkPeerTaskSelect,
            },
            toTask: {
              select: taskLinkPeerTaskSelect,
            },
          },
          orderBy: { createdAt: "asc" },
        },
      }),
    });
  });

  it("carries the Task's Run at", async () => {
    viewerTaskIncludeResult = createTask({
      status: TaskStatus.QUEUED,
      runAt: new Date("2030-01-07T09:00:00.000Z"),
    });

    const app = createApp();
    mountGetTaskById(app);

    const response = await app.request("http://localhost/tsk_a");

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.data.runAt).toBe("2030-01-07T09:00:00.000Z");
    expect(body.data.participants).toEqual([]);
  });

  it("lists the statuses the viewer may set by hand", async () => {
    viewerTaskIncludeResult = createTask();

    const app = createApp();
    mountGetTaskById(app);

    const response = await app.request("http://localhost/tsk_a");

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.data.selectableStatuses).toEqual([
      "DRAFT",
      "RUNNING",
      "AWAITING_EXTERNAL",
      "COMPLETED",
      "CANCELED",
    ]);
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
    mountGetTaskById(app);

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
        ...buildHumanTaskVisibilityWhere("user_456"),
      },
      include: expect.objectContaining({
        linksFrom: {
          where: {
            toTask: {
              is: expect.objectContaining({
                workspaceId: testWorkspaceId,
                archivedAt: null,
                ...buildHumanTaskVisibilityWhere("user_456"),
              }),
            },
          },
          include: expect.any(Object),
          orderBy: { createdAt: "asc" },
        },
        linksTo: {
          where: {
            fromTask: {
              is: expect.objectContaining({
                workspaceId: testWorkspaceId,
                archivedAt: null,
                ...buildHumanTaskVisibilityWhere("user_456"),
              }),
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
    mountGetTaskById(app);

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
              select: taskLinkPeerTaskSelect,
            },
            toTask: {
              select: taskLinkPeerTaskSelect,
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
              select: taskLinkPeerTaskSelect,
            },
            toTask: {
              select: taskLinkPeerTaskSelect,
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
    mountGetTaskById(app);

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
    mountGetTaskById(app);

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
    mountGetTaskById(app);

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
    mountGetTaskById(app);

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
    mountGetTaskById(app);

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
          ...buildHumanTaskVisibilityWhere("user_456"),
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
    mountGetTaskById(app);

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

describe("GET /tasks/{id} by identifier", () => {
  const PROJECT_ID = "aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa";
  const TASK_ID = "01960001-0001-7001-8001-000000000042";

  function get(ref: string) {
    const app = createApp();
    mountGetTaskById(app);
    return app.request(`http://localhost/${ref}`);
  }

  function accessWhereIds(): unknown[] {
    return taskFindFirstMock.mock.calls.map(
      ([args]) => (args as { where: { id: string } }).where.id,
    );
  }

  beforeEach(() => {
    vi.clearAllMocks();
    projectFindUniqueMock.mockResolvedValue({ id: PROJECT_ID });
    taskFindUniqueMock.mockResolvedValue({ id: TASK_ID });
    aliasFindUniqueMock.mockResolvedValue(null);
    taskFindFirstMock.mockImplementation(
      async (args: { where: { id: string }; include?: unknown }) =>
        args.where.id === TASK_ID
          ? {
              ...createTask(),
              id: TASK_ID,
              number: 12,
              projectId: PROJECT_ID,
              project: {
                id: PROJECT_ID,
                name: "Sokosumi",
                identifier: "SOK",
                logo: null,
              },
            }
          : null,
    );
  });

  it("reads a uuid without any identifier lookup", async () => {
    const response = await get(TASK_ID);

    expect(response.status).toBe(200);
    expect(projectFindUniqueMock).not.toHaveBeenCalled();
    expect(accessWhereIds()).toEqual([TASK_ID]);
  });

  it.each(["SOK-12", "sok-12", "SOK-12-some-slug"])(
    "resolves %s in the active workspace and returns the task",
    async (ref) => {
      const response = await get(ref);

      expect(response.status).toBe(200);
      const body = await response.json();
      expect(body.data).toMatchObject({ id: TASK_ID, identifier: "SOK-12" });
      expect(projectFindUniqueMock).toHaveBeenCalledWith({
        where: {
          workspaceId_identifier: {
            workspaceId: testWorkspaceId,
            identifier: "SOK",
          },
        },
        select: { id: true },
      });
      expect(taskFindUniqueMock).toHaveBeenCalledWith({
        where: { projectId_number: { projectId: PROJECT_ID, number: 12 } },
        select: { id: true },
      });
      expect(accessWhereIds()).toEqual([TASK_ID]);
    },
  );

  it("falls back to the alias of a task that moved away", async () => {
    taskFindUniqueMock.mockResolvedValue(null);
    aliasFindUniqueMock.mockResolvedValue({ taskId: TASK_ID });

    const response = await get("SOK-3");

    expect(response.status).toBe(200);
    expect(aliasFindUniqueMock).toHaveBeenCalledWith({
      where: { projectId_number: { projectId: PROJECT_ID, number: 3 } },
      select: { taskId: true },
    });
    expect(accessWhereIds()).toEqual([TASK_ID]);
  });

  it("returns the usual 404 when the workspace has no such project", async () => {
    projectFindUniqueMock.mockResolvedValue(null);

    const unknown = await get("OTH-12");
    const missing = await get("01960001-0001-7001-8001-0000000000ff");

    expect(unknown.status).toBe(404);
    expect(taskFindUniqueMock).not.toHaveBeenCalled();
    expect(await unknown.text()).toBe("Task not found");
    expect(missing.status).toBe(404);
  });

  it("returns the same 404 body for an unknown number as for a missing task", async () => {
    taskFindUniqueMock.mockResolvedValue(null);

    const unknownNumber = await get("SOK-99");
    const missingTask = await get("01960001-0001-7001-8001-0000000000ff");

    expect(unknownNumber.status).toBe(404);
    expect(await unknownNumber.text()).toBe(await missingTask.text());
  });

  it("returns 404 when the caller cannot see the resolved task", async () => {
    taskFindFirstMock.mockResolvedValue(null);

    const response = await get("SOK-12");

    expect(response.status).toBe(404);
    expect(taskFindFirstMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          id: TASK_ID,
          ...buildHumanTaskVisibilityWhere("user_123"),
        }),
      }),
    );
  });

  it("returns 404 for a malformed ref without identifier lookups", async () => {
    const response = await get("SOK-abc");

    expect(response.status).toBe(404);
    expect(projectFindUniqueMock).not.toHaveBeenCalled();
  });
});
