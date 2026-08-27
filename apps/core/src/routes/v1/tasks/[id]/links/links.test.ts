import { Prisma, TaskLinkType, TaskStatus } from "@sokosumi/database";
import { HTTPException } from "hono/http-exception";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { errorHandler } from "@/helpers/error-handler";
import { buildCoworkerSiblingTaskListFilter } from "@/helpers/vendor-siblings";
import { OpenAPIHonoWithAuth } from "@/lib/hono";
import type { AuthenticationContext } from "@/middleware/auth";
import { testVendor } from "@/test-fixtures/vendor";
import mountDeleteTaskLink from "./[linkId]/delete";
import mountPatchTaskLink from "./[linkId]/patch";
import mountGetTaskLinks from "./get";
import mountPostTaskLink from "./post";

vi.mock("@/middleware/auth", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/middleware/auth")>();
  const { stubAuthMiddleware } = await import(
    "@/test-fixtures/auth-middleware"
  );
  return { ...actual, authMiddleware: stubAuthMiddleware };
});

const {
  prismaTransactionMock,
  requireTaskOwnershipMock,
  requireTaskReadForRouteVarsMock,
  taskFindFirstMock,
  taskFindUniqueMock,
  taskLinkCreateMock,
  taskLinkDeleteMock,
  taskLinkFindUniqueMock,
  taskLinkUpdateMock,
} = vi.hoisted(() => ({
  prismaTransactionMock: vi.fn(),
  requireTaskOwnershipMock: vi.fn(),
  requireTaskReadForRouteVarsMock: vi.fn(),
  taskFindFirstMock: vi.fn(),
  taskFindUniqueMock: vi.fn(),
  taskLinkCreateMock: vi.fn(),
  taskLinkDeleteMock: vi.fn(),
  taskLinkFindUniqueMock: vi.fn(),
  taskLinkUpdateMock: vi.fn(),
}));

vi.mock("@/helpers/access-control", () => ({
  requireTaskOwnership: requireTaskOwnershipMock,
  requireMutableTaskOwnership: requireTaskOwnershipMock,
  requireTaskReadForRouteVars: requireTaskReadForRouteVarsMock,
}));

vi.mock("@/lib/db/prisma", () => ({
  default: {
    $transaction: prismaTransactionMock,
  },
}));

const COWORKER_ID = "cow_123";
const WORKSPACE_ID = "11111111-1111-7111-8111-111111111111";

const bareCoworkerVisiblePeerTaskWhere = {
  archivedAt: null,
  ...buildCoworkerSiblingTaskListFilter({
    coworkerId: COWORKER_ID,
    vendorId: testVendor.id,
  }),
};

const delegatedCoworkerVisiblePeerTaskWhere = {
  workspaceId: WORKSPACE_ID,
  archivedAt: null,
  ...buildCoworkerSiblingTaskListFilter({
    coworkerId: COWORKER_ID,
    vendorId: testVendor.id,
  }),
};

interface CreateUserAppOptions {
  userId?: string;
}

function createUserApp(options: CreateUserAppOptions = {}) {
  const { userId = "user_123" } = options;
  const app = new OpenAPIHonoWithAuth();

  app.onError(errorHandler);

  app.use("*", async (c, next) => {
    c.set("requestId", "req_task_links_test");
    c.set("isAuthenticated", true);
    c.set("authContext", {
      actor: "user",
      userId,
      organizationId: "org_123",
      role: "user",
    });
    c.set("workspaceContext", {
      workspaceId: "11111111-1111-7111-8111-111111111111",
      userId: null,
      organizationId: "org_123",
    });
    return await next();
  });

  return app;
}

function createCoworkerApp() {
  const app = new OpenAPIHonoWithAuth();

  app.use("*", async (c, next) => {
    c.set("isAuthenticated", true);
    c.set("authContext", {
      actor: "coworker",
      coworkerId: COWORKER_ID,
      vendorId: testVendor.id,
    } satisfies AuthenticationContext);
    c.set("workspaceContext", null);
    return await next();
  });

  return app;
}

function createDelegatedCoworkerApp() {
  const app = new OpenAPIHonoWithAuth();

  app.use("*", async (c, next) => {
    c.set("isAuthenticated", true);
    c.set("authContext", {
      actor: "coworker",
      coworkerId: COWORKER_ID,
      vendorId: testVendor.id,
      context: {
        userId: "user_delegate",
        organizationId: "org_123",
      },
    } satisfies AuthenticationContext);
    c.set("workspaceContext", {
      workspaceId: WORKSPACE_ID,
      userId: null,
      organizationId: "org_123",
    });
    return await next();
  });

  return app;
}

function mockTx() {
  return {
    task: {
      findFirst: taskFindFirstMock,
      findUnique: taskFindUniqueMock,
    },
    taskLink: {
      create: taskLinkCreateMock,
      findUnique: taskLinkFindUniqueMock,
      delete: taskLinkDeleteMock,
      update: taskLinkUpdateMock,
    },
  };
}

describe("GET /tasks/{id}/links", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    requireTaskReadForRouteVarsMock.mockResolvedValue(undefined);
    prismaTransactionMock.mockImplementation(
      async (cb: (tx: unknown) => unknown) => {
        return await cb(mockTx());
      },
    );
    taskFindUniqueMock.mockResolvedValue({
      id: "tsk_a",
      linksFrom: [],
      linksTo: [],
    });
  });

  it("returns 200 with an empty link list", async () => {
    const app = createUserApp();
    mountGetTaskLinks(app);

    const response = await app.request("http://localhost/tsk_a/links");

    expect(response.status).toBe(200);
    const body = (await response.json()) as { data: unknown[] };
    expect(body.data).toEqual([]);
    expect(requireTaskReadForRouteVarsMock).toHaveBeenCalledWith(
      expect.objectContaining({
        isAuthenticated: true,
        authContext: {
          actor: "user",
          userId: "user_123",
          organizationId: "org_123",
          role: "user",
        },
        workspaceContext: {
          workspaceId: "11111111-1111-7111-8111-111111111111",
          userId: null,
          organizationId: "org_123",
        },
      }),
      "tsk_a",
      expect.any(Object),
    );
  });

  it("returns nested peerTask summaries for visible links", async () => {
    taskFindUniqueMock.mockResolvedValue({
      id: "tsk_a",
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
      linksTo: [],
    });

    const app = createUserApp();
    mountGetTaskLinks(app);

    const response = await app.request("http://localhost/tsk_a/links");

    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      data: Array<{
        relation: string;
        peerTask: {
          id: string;
          name: string;
          status: TaskStatus;
          archivedAt: string | null;
        };
      }>;
    };
    expect(body.data).toHaveLength(1);
    expect(body.data[0]).toMatchObject({
      relation: "related",
      peerTask: {
        id: "tsk_b",
        name: "Task B",
        status: TaskStatus.RUNNING,
        archivedAt: null,
      },
    });
    expect(requireTaskReadForRouteVarsMock).toHaveBeenCalledWith(
      expect.objectContaining({
        isAuthenticated: true,
        authContext: {
          actor: "user",
          userId: "user_123",
          organizationId: "org_123",
          role: "user",
        },
        workspaceContext: {
          workspaceId: "11111111-1111-7111-8111-111111111111",
          userId: null,
          organizationId: "org_123",
        },
      }),
      "tsk_a",
      expect.any(Object),
    );
  });

  it("filters linked peer tasks to those visible to the coworker", async () => {
    const app = createCoworkerApp();
    mountGetTaskLinks(app);

    const response = await app.request("http://localhost/tsk_a/links");

    expect(response.status).toBe(200);
    expect(requireTaskReadForRouteVarsMock).toHaveBeenCalledWith(
      expect.objectContaining({
        isAuthenticated: true,
        authContext: {
          actor: "coworker",
          coworkerId: COWORKER_ID,
          vendorId: testVendor.id,
        },
        workspaceContext: null,
      }),
      "tsk_a",
      expect.any(Object),
    );
    expect(taskFindUniqueMock).toHaveBeenCalledWith({
      where: { id: "tsk_a", archivedAt: null },
      select: {
        id: true,
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
      },
    });
  });

  it("filters delegated coworker linked peers to assignee or same-vendor siblings", async () => {
    const app = createDelegatedCoworkerApp();
    mountGetTaskLinks(app);

    const response = await app.request("http://localhost/tsk_a/links");

    expect(response.status).toBe(200);
    expect(requireTaskReadForRouteVarsMock).toHaveBeenCalledWith(
      expect.objectContaining({
        isAuthenticated: true,
        authContext: {
          actor: "coworker",
          coworkerId: COWORKER_ID,
          vendorId: testVendor.id,
          context: {
            userId: "user_delegate",
            organizationId: "org_123",
          },
        },
        workspaceContext: {
          workspaceId: WORKSPACE_ID,
          userId: null,
          organizationId: "org_123",
        },
      }),
      "tsk_a",
      expect.any(Object),
    );
    expect(taskFindUniqueMock).toHaveBeenCalledWith({
      where: { id: "tsk_a", archivedAt: null },
      select: {
        id: true,
        linksFrom: {
          where: {
            toTask: {
              is: delegatedCoworkerVisiblePeerTaskWhere,
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
              is: delegatedCoworkerVisiblePeerTaskWhere,
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
      },
    });
  });

  it("filters archived peer links from user link reads", async () => {
    const app = createUserApp();
    mountGetTaskLinks(app);

    const response = await app.request("http://localhost/tsk_a/links");

    expect(response.status).toBe(200);
    expect(taskFindUniqueMock).toHaveBeenCalledWith({
      where: { id: "tsk_a", archivedAt: null },
      select: {
        id: true,
        linksFrom: {
          where: {
            toTask: {
              is: {
                workspaceId: "11111111-1111-7111-8111-111111111111",
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
                workspaceId: "11111111-1111-7111-8111-111111111111",
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
      },
    });
  });

  it("returns same-workspace peer links for a collaborator", async () => {
    taskFindUniqueMock.mockResolvedValueOnce({
      id: "tsk_a",
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
      linksTo: [],
    });

    const app = createUserApp({ userId: "user_456" });
    mountGetTaskLinks(app);

    const response = await app.request("http://localhost/tsk_a/links");

    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      data: Array<{
        relation: string;
        peerTask: {
          id: string;
          name: string;
          status: TaskStatus;
          archivedAt: string | null;
        };
      }>;
    };
    expect(body.data).toHaveLength(1);
    expect(taskFindUniqueMock).toHaveBeenCalledWith({
      where: { id: "tsk_a", archivedAt: null },
      select: {
        id: true,
        linksFrom: {
          where: {
            toTask: {
              is: {
                workspaceId: "11111111-1111-7111-8111-111111111111",
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
                workspaceId: "11111111-1111-7111-8111-111111111111",
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
      },
    });
  });

  it("returns 404 when the task is not found", async () => {
    taskFindUniqueMock.mockResolvedValue(null);

    const app = createUserApp();
    mountGetTaskLinks(app);

    const response = await app.request("http://localhost/tsk_a/links");

    expect(response.status).toBe(404);
  });
});

describe("POST /tasks/{id}/links", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    requireTaskOwnershipMock.mockImplementation(
      async (_auth, taskId: string) => ({
        id: taskId,
        ownerId: "user_123",
        organizationId: "org_123",
        archivedAt: null,
        status: TaskStatus.READY,
        assigneeId: null,
        name: "Task A",
        description: null,
      }),
    );
    taskFindFirstMock.mockResolvedValue({
      id: "tsk_b",
      name: "Task B",
      status: TaskStatus.RUNNING,
    });
    prismaTransactionMock.mockImplementation(
      async (cb: (tx: unknown) => unknown) => {
        return await cb(mockTx());
      },
    );
    taskLinkCreateMock.mockResolvedValue({
      id: "tl_1",
      createdAt: new Date("2026-03-25T10:00:00.000Z"),
      updatedAt: new Date("2026-03-25T10:00:00.000Z"),
      fromTaskId: "tsk_a",
      toTaskId: "tsk_b",
      type: TaskLinkType.RELATES,
      note: null,
    });
  });

  it("returns 201 when a link is created", async () => {
    const app = createUserApp();
    mountPostTaskLink(app);

    const response = await app.request("http://localhost/tsk_a/links", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        toTaskId: "tsk_b",
        relation: "related",
      }),
    });

    expect(response.status).toBe(201);
    expect(taskLinkCreateMock).toHaveBeenCalledWith({
      data: {
        fromTaskId: "tsk_a",
        toTaskId: "tsk_b",
        type: TaskLinkType.RELATES,
        note: null,
      },
    });
    expect(taskFindFirstMock).toHaveBeenCalledWith({
      where: {
        id: "tsk_b",
        ownerId: "user_123",
        workspaceId: "11111111-1111-7111-8111-111111111111",
      },
      select: {
        id: true,
        name: true,
        status: true,
        archivedAt: true,
      },
    });
    const body = (await response.json()) as {
      data: {
        relation: string;
        peerTask: {
          id: string;
          name: string;
          status: TaskStatus;
          archivedAt: string | null;
        };
      };
    };
    expect(body.data).toMatchObject({
      relation: "related",
      peerTask: {
        id: "tsk_b",
        name: "Task B",
        status: TaskStatus.RUNNING,
        archivedAt: null,
      },
    });
  });

  it("returns 403 for coworker authentication", async () => {
    const app = createCoworkerApp();
    mountPostTaskLink(app);

    const response = await app.request("http://localhost/tsk_a/links", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        toTaskId: "tsk_b",
        relation: "related",
      }),
    });

    expect(response.status).toBe(403);
    expect(taskLinkCreateMock).not.toHaveBeenCalled();
  });

  it("returns 404 when the target task is not accessible", async () => {
    taskFindFirstMock.mockResolvedValue(null);

    const app = createUserApp();
    mountPostTaskLink(app);

    const response = await app.request("http://localhost/tsk_a/links", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        toTaskId: "tsk_b",
        relation: "related",
      }),
    });

    expect(response.status).toBe(404);
    expect(taskLinkCreateMock).not.toHaveBeenCalled();
  });

  it("returns 403 when the active workspace is missing", async () => {
    const app = createUserApp();
    app.use("*", async (c, next) => {
      c.set("workspaceContext", null);
      return await next();
    });
    mountPostTaskLink(app);

    const response = await app.request("http://localhost/tsk_a/links", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        toTaskId: "tsk_b",
        relation: "related",
      }),
    });

    expect(response.status).toBe(403);
    expect(taskLinkCreateMock).not.toHaveBeenCalled();
  });

  it("returns 409 when a duplicate link already exists", async () => {
    taskLinkCreateMock.mockRejectedValue(
      Object.assign(new Error("Unique constraint failed"), { code: "P2002" }),
    );

    const app = createUserApp();
    mountPostTaskLink(app);

    const response = await app.request("http://localhost/tsk_a/links", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        toTaskId: "tsk_b",
        relation: "related",
      }),
    });

    expect(response.status).toBe(409);
  });

  it("uses a serializable transaction and returns 409 on transaction conflict", async () => {
    prismaTransactionMock.mockRejectedValue(
      Object.assign(new Error("Transaction failed"), { code: "P2034" }),
    );

    const app = createUserApp();
    mountPostTaskLink(app);

    const response = await app.request("http://localhost/tsk_a/links", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        toTaskId: "tsk_b",
        relation: "related",
      }),
    });

    expect(response.status).toBe(409);
    expect(prismaTransactionMock).toHaveBeenCalledWith(expect.any(Function), {
      isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
    });
  });

  it("returns 400 when a task is linked to itself", async () => {
    const app = createUserApp();
    mountPostTaskLink(app);

    const response = await app.request("http://localhost/tsk_a/links", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        toTaskId: "tsk_a",
        relation: "blocks",
      }),
    });

    expect(response.status).toBe(400);
    expect(taskLinkCreateMock).not.toHaveBeenCalled();
  });

  it("returns 403 for delegated coworker context on owner link mutations", async () => {
    const app = createDelegatedCoworkerApp();
    mountPostTaskLink(app);

    const response = await app.request("http://localhost/tsk_a/links", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        toTaskId: "tsk_b",
        relation: "blocks",
      }),
    });

    expect(response.status).toBe(403);
    expect(requireTaskOwnershipMock).not.toHaveBeenCalled();
    expect(taskLinkCreateMock).not.toHaveBeenCalled();
  });

  it("returns 403 for delegated coworker context on owner link patch", async () => {
    const app = createDelegatedCoworkerApp();
    mountPatchTaskLink(app);

    const response = await app.request("http://localhost/tsk_a/links/tl_1", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        relation: "blocks",
      }),
    });

    expect(response.status).toBe(403);
    expect(requireTaskOwnershipMock).not.toHaveBeenCalled();
    expect(taskLinkUpdateMock).not.toHaveBeenCalled();
  });

  it("returns 403 for delegated coworker context on owner link delete", async () => {
    const app = createDelegatedCoworkerApp();
    mountDeleteTaskLink(app);

    const response = await app.request("http://localhost/tsk_a/links/tl_1", {
      method: "DELETE",
    });

    expect(response.status).toBe(403);
    expect(requireTaskOwnershipMock).not.toHaveBeenCalled();
    expect(taskLinkDeleteMock).not.toHaveBeenCalled();
  });

  it("creates reversed directional links from task-relative relations", async () => {
    taskLinkCreateMock.mockResolvedValue({
      id: "tl_1",
      createdAt: new Date("2026-03-25T10:00:00.000Z"),
      updatedAt: new Date("2026-03-25T10:00:00.000Z"),
      fromTaskId: "tsk_b",
      toTaskId: "tsk_a",
      type: TaskLinkType.BLOCKS,
      note: null,
    });

    const app = createUserApp();
    mountPostTaskLink(app);

    const response = await app.request("http://localhost/tsk_a/links", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        toTaskId: "tsk_b",
        relation: "blocked_by",
      }),
    });

    expect(response.status).toBe(201);
    expect(taskLinkCreateMock).toHaveBeenCalledWith({
      data: {
        fromTaskId: "tsk_b",
        toTaskId: "tsk_a",
        type: TaskLinkType.BLOCKS,
        note: null,
      },
    });
    const body = (await response.json()) as {
      data: {
        relation: string;
      };
    };
    expect(body.data.relation).toBe("blocked_by");
  });
});

describe("DELETE /tasks/{id}/links/{linkId}", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    requireTaskOwnershipMock.mockImplementation(
      async (_auth, taskId: string) => ({
        id: taskId,
        ownerId: "user_123",
        organizationId: "org_123",
        archivedAt: null,
        status: TaskStatus.READY,
        assigneeId: null,
        name: "T",
        description: null,
      }),
    );
    prismaTransactionMock.mockImplementation(
      async (cb: (tx: unknown) => unknown) => {
        return await cb(mockTx());
      },
    );
    taskLinkFindUniqueMock.mockResolvedValue({
      id: "tl_1",
      fromTaskId: "tsk_a",
      toTaskId: "tsk_b",
      type: TaskLinkType.BLOCKS,
      note: null,
    });
    taskLinkDeleteMock.mockResolvedValue({});
  });

  it("returns 200 when the link is deleted", async () => {
    const app = createUserApp();
    mountDeleteTaskLink(app);

    const response = await app.request("http://localhost/tsk_a/links/tl_1", {
      method: "DELETE",
    });

    expect(response.status).toBe(200);
    expect(taskLinkDeleteMock).toHaveBeenCalledWith({
      where: { id: "tl_1" },
    });
  });

  it("returns 200 when the peer task is archived but still owned by the user", async () => {
    requireTaskOwnershipMock.mockImplementation(
      async (_auth, taskId: string) => {
        if (taskId !== "tsk_a") {
          throw new HTTPException(404, { message: "Task not found" });
        }

        return {
          id: taskId,
          ownerId: "user_123",
          organizationId: "org_123",
          archivedAt: null,
          status: TaskStatus.READY,
          assigneeId: null,
          name: "T",
          description: null,
        };
      },
    );

    const app = createUserApp();
    mountDeleteTaskLink(app);

    const response = await app.request("http://localhost/tsk_a/links/tl_1", {
      method: "DELETE",
    });

    expect(response.status).toBe(200);
    expect(taskLinkDeleteMock).toHaveBeenCalledWith({
      where: { id: "tl_1" },
    });
    expect(requireTaskOwnershipMock).toHaveBeenCalledTimes(1);
    expect(taskFindUniqueMock).not.toHaveBeenCalled();
  });

  it("returns 200 when the peer task is outside the user's current workspace", async () => {
    requireTaskOwnershipMock.mockImplementation(
      async (_auth, taskId: string) => {
        if (taskId !== "tsk_a") {
          throw new HTTPException(404, { message: "Task not found" });
        }

        return {
          id: taskId,
          ownerId: "user_123",
          organizationId: "org_123",
          archivedAt: null,
          status: TaskStatus.READY,
          assigneeId: null,
          name: "T",
          description: null,
        };
      },
    );

    const app = createUserApp();
    mountDeleteTaskLink(app);

    const response = await app.request("http://localhost/tsk_a/links/tl_1", {
      method: "DELETE",
    });

    expect(response.status).toBe(200);
    expect(taskLinkDeleteMock).toHaveBeenCalledWith({
      where: { id: "tl_1" },
    });
    expect(requireTaskOwnershipMock).toHaveBeenCalledTimes(1);
    expect(taskFindUniqueMock).not.toHaveBeenCalled();
  });

  it("returns 404 when the link does not involve the path task id", async () => {
    taskLinkFindUniqueMock.mockResolvedValue({
      id: "tl_1",
      fromTaskId: "tsk_x",
      toTaskId: "tsk_y",
      type: TaskLinkType.RELATES,
      note: null,
    });

    const app = createUserApp();
    mountDeleteTaskLink(app);

    const response = await app.request("http://localhost/tsk_a/links/tl_1", {
      method: "DELETE",
    });

    expect(response.status).toBe(404);
    expect(taskLinkDeleteMock).not.toHaveBeenCalled();
  });

  it("returns 403 for coworker authentication", async () => {
    const app = createCoworkerApp();
    mountDeleteTaskLink(app);

    const response = await app.request("http://localhost/tsk_a/links/tl_1", {
      method: "DELETE",
    });

    expect(response.status).toBe(403);
    expect(taskLinkDeleteMock).not.toHaveBeenCalled();
  });

  it("returns 400 when deleting a system SCHEDULE link", async () => {
    taskLinkFindUniqueMock.mockResolvedValue({
      id: "tl_schedule",
      fromTaskId: "tsk_template",
      toTaskId: "tsk_run",
      type: TaskLinkType.SCHEDULE,
      note: null,
    });

    const app = createUserApp();
    mountDeleteTaskLink(app);

    const response = await app.request(
      "http://localhost/tsk_template/links/tl_schedule",
      {
        method: "DELETE",
      },
    );

    expect(response.status).toBe(400);
    expect(taskLinkDeleteMock).not.toHaveBeenCalled();
    const body = await response.json();
    expect(body.message).toContain("system-managed");
  });
});

describe("PATCH /tasks/{id}/links/{linkId}", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    requireTaskOwnershipMock.mockImplementation(
      async (_auth, taskId: string) => ({
        id: taskId,
        ownerId: "user_123",
        organizationId: "org_123",
        archivedAt: null,
        status: TaskStatus.READY,
        assigneeId: null,
        name: "T",
        description: null,
      }),
    );
    prismaTransactionMock.mockImplementation(
      async (cb: (tx: unknown) => unknown) => {
        return await cb(mockTx());
      },
    );
    taskLinkFindUniqueMock.mockResolvedValue({
      id: "tl_1",
      fromTaskId: "tsk_a",
      toTaskId: "tsk_b",
      type: TaskLinkType.BLOCKS,
      note: "Old note",
    });
    taskLinkUpdateMock.mockResolvedValue({
      id: "tl_1",
      createdAt: new Date("2026-03-25T10:00:00.000Z"),
      updatedAt: new Date("2026-03-25T10:05:00.000Z"),
      fromTaskId: "tsk_a",
      toTaskId: "tsk_b",
      type: TaskLinkType.PARENT,
      note: "Updated note",
    });
    taskFindFirstMock.mockResolvedValue({
      id: "tsk_b",
      name: "Task B",
      status: TaskStatus.RUNNING,
    });
  });

  it("returns 200 when the link metadata is updated", async () => {
    const app = createUserApp();
    mountPatchTaskLink(app);

    const response = await app.request("http://localhost/tsk_a/links/tl_1", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        relation: "parent",
        note: "Updated note",
      }),
    });

    expect(response.status).toBe(200);
    expect(taskLinkUpdateMock).toHaveBeenCalledWith({
      where: { id: "tl_1" },
      data: {
        type: TaskLinkType.PARENT,
        note: "Updated note",
      },
    });
    expect(taskFindFirstMock).toHaveBeenCalledWith({
      where: {
        id: "tsk_b",
        ownerId: "user_123",
        workspaceId: "11111111-1111-7111-8111-111111111111",
      },
      select: {
        id: true,
        name: true,
        status: true,
        archivedAt: true,
      },
    });
    const body = (await response.json()) as {
      data: {
        relation: string;
        peerTask: {
          id: string;
          name: string;
          status: TaskStatus;
          archivedAt: string | null;
        };
      };
    };
    expect(body.data).toMatchObject({
      relation: "parent",
      peerTask: {
        id: "tsk_b",
        name: "Task B",
        status: TaskStatus.RUNNING,
        archivedAt: null,
      },
    });
  });

  it("returns 200 when the link note is cleared", async () => {
    taskLinkUpdateMock.mockResolvedValue({
      id: "tl_1",
      createdAt: new Date("2026-03-25T10:00:00.000Z"),
      updatedAt: new Date("2026-03-25T10:05:00.000Z"),
      fromTaskId: "tsk_a",
      toTaskId: "tsk_b",
      type: TaskLinkType.BLOCKS,
      note: null,
    });

    const app = createUserApp();
    mountPatchTaskLink(app);

    const response = await app.request("http://localhost/tsk_a/links/tl_1", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        note: null,
      }),
    });

    expect(response.status).toBe(200);
    expect(taskLinkUpdateMock).toHaveBeenCalledWith({
      where: { id: "tl_1" },
      data: {
        note: null,
      },
    });
  });

  it("returns 404 when the peer task is not owned by the user", async () => {
    taskFindFirstMock.mockResolvedValueOnce(null);

    const app = createUserApp();
    mountPatchTaskLink(app);

    const response = await app.request("http://localhost/tsk_a/links/tl_1", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        relation: "parent",
      }),
    });

    expect(response.status).toBe(404);
    expect(taskLinkUpdateMock).not.toHaveBeenCalled();
  });

  it("returns 403 when the active workspace is missing", async () => {
    const app = createUserApp();
    app.use("*", async (c, next) => {
      c.set("workspaceContext", null);
      return await next();
    });
    mountPatchTaskLink(app);

    const response = await app.request("http://localhost/tsk_a/links/tl_1", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        relation: "parent",
      }),
    });

    expect(response.status).toBe(403);
    expect(taskLinkUpdateMock).not.toHaveBeenCalled();
  });

  it("returns 400 when no updatable fields are provided", async () => {
    const app = createUserApp();
    mountPatchTaskLink(app);

    const response = await app.request("http://localhost/tsk_a/links/tl_1", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });

    expect(response.status).toBe(422);
    expect(taskLinkUpdateMock).not.toHaveBeenCalled();
  });

  it("returns 404 when the link does not involve the path task id", async () => {
    taskLinkFindUniqueMock.mockResolvedValue({
      id: "tl_1",
      fromTaskId: "tsk_x",
      toTaskId: "tsk_y",
      type: TaskLinkType.RELATES,
      note: null,
    });

    const app = createUserApp();
    mountPatchTaskLink(app);

    const response = await app.request("http://localhost/tsk_a/links/tl_1", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        relation: "duplicate",
      }),
    });

    expect(response.status).toBe(404);
    expect(taskLinkUpdateMock).not.toHaveBeenCalled();
  });

  it("returns 403 for coworker authentication", async () => {
    const app = createCoworkerApp();
    mountPatchTaskLink(app);

    const response = await app.request("http://localhost/tsk_a/links/tl_1", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        relation: "duplicate",
      }),
    });

    expect(response.status).toBe(403);
    expect(taskLinkUpdateMock).not.toHaveBeenCalled();
  });

  it("patches reversed directional links from task-relative relations", async () => {
    taskLinkFindUniqueMock.mockResolvedValue({
      id: "tl_1",
      fromTaskId: "tsk_a",
      toTaskId: "tsk_b",
      type: TaskLinkType.BLOCKS,
      note: "Old note",
    });

    const app = createUserApp();
    mountPatchTaskLink(app);

    const response = await app.request("http://localhost/tsk_a/links/tl_1", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        relation: "child",
      }),
    });

    expect(response.status).toBe(400);
    expect(taskLinkUpdateMock).not.toHaveBeenCalled();
  });

  it("patches directional relations that match the existing stored edge", async () => {
    taskLinkFindUniqueMock.mockResolvedValue({
      id: "tl_1",
      fromTaskId: "tsk_b",
      toTaskId: "tsk_a",
      type: TaskLinkType.BLOCKS,
      note: "Old note",
    });
    taskLinkUpdateMock.mockResolvedValue({
      id: "tl_1",
      createdAt: new Date("2026-03-25T10:00:00.000Z"),
      updatedAt: new Date("2026-03-25T10:05:00.000Z"),
      fromTaskId: "tsk_b",
      toTaskId: "tsk_a",
      type: TaskLinkType.PARENT,
      note: "Old note",
    });
    taskFindFirstMock.mockResolvedValue({
      id: "tsk_b",
      name: "Task B",
      status: TaskStatus.RUNNING,
    });

    const app = createUserApp();
    mountPatchTaskLink(app);

    const response = await app.request("http://localhost/tsk_a/links/tl_1", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        relation: "child",
      }),
    });

    expect(response.status).toBe(200);
    expect(taskLinkUpdateMock).toHaveBeenCalledWith({
      where: { id: "tl_1" },
      data: {
        type: TaskLinkType.PARENT,
      },
    });
  });

  it("returns 400 when patching a system SCHEDULE link", async () => {
    taskLinkFindUniqueMock.mockResolvedValue({
      id: "tl_schedule",
      fromTaskId: "tsk_template",
      toTaskId: "tsk_run",
      type: TaskLinkType.SCHEDULE,
      note: null,
    });

    const app = createUserApp();
    mountPatchTaskLink(app);

    const response = await app.request(
      "http://localhost/tsk_template/links/tl_schedule",
      {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          relation: "parent",
        }),
      },
    );

    expect(response.status).toBe(400);
    expect(taskLinkUpdateMock).not.toHaveBeenCalled();
    const body = await response.json();
    expect(body.message).toContain("system-managed");
  });
});
