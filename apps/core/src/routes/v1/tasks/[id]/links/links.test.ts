import { OpenAPIHono } from "@hono/zod-openapi";
import { Prisma, TaskLinkType, TaskStatus } from "@sokosumi/database";
import { HTTPException } from "hono/http-exception";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { OpenAPIHonoWithAuth } from "@/lib/hono";
import type { AuthenticationContext, AuthVariables } from "@/middleware/auth";

import mountDeleteTaskLink from "./[linkId]/delete";
import mountPatchTaskLink from "./[linkId]/patch";
import mountGetTaskLinks from "./get";
import mountPostTaskLink from "./post";

const {
  prismaTransactionMock,
  requireScopedTaskReadAccessMock,
  requireUserTaskAccessMock,
  taskFindFirstMock,
  taskFindUniqueMock,
  taskLinkCreateMock,
  taskLinkDeleteMock,
  taskLinkFindUniqueMock,
  taskLinkUpdateMock,
} = vi.hoisted(() => ({
  prismaTransactionMock: vi.fn(),
  requireScopedTaskReadAccessMock: vi.fn(),
  requireUserTaskAccessMock: vi.fn(),
  taskFindFirstMock: vi.fn(),
  taskFindUniqueMock: vi.fn(),
  taskLinkCreateMock: vi.fn(),
  taskLinkDeleteMock: vi.fn(),
  taskLinkFindUniqueMock: vi.fn(),
  taskLinkUpdateMock: vi.fn(),
}));

vi.mock("@/helpers/access-control", () => ({
  requireScopedTaskReadAccess: requireScopedTaskReadAccessMock,
  requireUserTaskAccess: requireUserTaskAccessMock,
}));

vi.mock("@/lib/db/prisma", () => ({
  default: {
    $transaction: prismaTransactionMock,
  },
}));

function createUserApp() {
  const app = new OpenAPIHono<{
    Variables: AuthVariables;
  }>();

  app.use("*", async (c, next) => {
    c.set("isAuthenticated", true);
    c.set("authContext", {
      actor: "user",
      userId: "user_123",
      organizationId: "org_123",
    });
    return await next();
  });

  return app;
}

function createCoworkerApp() {
  const app = new OpenAPIHono<{
    Variables: AuthVariables;
  }>();

  app.use("*", async (c, next) => {
    c.set("isAuthenticated", true);
    c.set("authContext", {
      actor: "coworker",
      coworkerId: "cow_123",
    } satisfies AuthenticationContext);
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
    requireScopedTaskReadAccessMock.mockResolvedValue(undefined);
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
    mountGetTaskLinks(app as unknown as OpenAPIHonoWithAuth);

    const response = await app.request(
      "http://localhost/tsk_a/links?scope=context",
    );

    expect(response.status).toBe(200);
    const body = (await response.json()) as { data: unknown[] };
    expect(body.data).toEqual([]);
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
          },
        },
      ],
      linksTo: [],
    });

    const app = createUserApp();
    mountGetTaskLinks(app as unknown as OpenAPIHonoWithAuth);

    const response = await app.request(
      "http://localhost/tsk_a/links?scope=context",
    );

    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      data: Array<{
        relation: string;
        peerTask: { id: string; name: string; status: TaskStatus };
      }>;
    };
    expect(body.data).toHaveLength(1);
    expect(body.data[0]).toMatchObject({
      relation: "related",
      peerTask: {
        id: "tsk_b",
        name: "Task B",
        status: TaskStatus.RUNNING,
      },
    });
  });

  it("filters linked peer tasks to those visible to the coworker", async () => {
    const app = createCoworkerApp();
    mountGetTaskLinks(app as unknown as OpenAPIHonoWithAuth);

    const response = await app.request(
      "http://localhost/tsk_a/links?scope=context",
    );

    expect(response.status).toBe(200);
    expect(taskFindUniqueMock).toHaveBeenCalledWith({
      where: { id: "tsk_a", archivedAt: null },
      select: {
        id: true,
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
      },
    });
  });

  it("keeps archived peer links visible for user-scoped link reads", async () => {
    const app = createUserApp();
    mountGetTaskLinks(app as unknown as OpenAPIHonoWithAuth);

    const response = await app.request(
      "http://localhost/tsk_a/links?scope=context",
    );

    expect(response.status).toBe(200);
    expect(taskFindUniqueMock).toHaveBeenCalledWith({
      where: { id: "tsk_a", archivedAt: null },
      select: {
        id: true,
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
      },
    });
  });

  it("returns 404 when the task is not found", async () => {
    taskFindUniqueMock.mockResolvedValue(null);

    const app = createUserApp();
    mountGetTaskLinks(app as unknown as OpenAPIHonoWithAuth);

    const response = await app.request(
      "http://localhost/tsk_a/links?scope=context",
    );

    expect(response.status).toBe(404);
  });
});

describe("POST /tasks/{id}/links", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    requireUserTaskAccessMock.mockImplementation(
      async (_auth, taskId: string) => ({
        id: taskId,
        userId: "user_123",
        organizationId: "org_123",
        archivedAt: null,
        status: TaskStatus.READY,
        coworkerId: null,
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
    mountPostTaskLink(app as unknown as OpenAPIHonoWithAuth);

    const response = await app.request("http://localhost/tsk_a/links", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        toTaskId: "tsk_b",
        type: TaskLinkType.RELATES,
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
        archivedAt: null,
        OR: [{ userId: "user_123", organizationId: "org_123" }],
      },
      select: {
        id: true,
        name: true,
        status: true,
      },
    });
    const body = (await response.json()) as {
      data: {
        relation: string;
        peerTask: { id: string; name: string; status: TaskStatus };
      };
    };
    expect(body.data).toMatchObject({
      relation: "related",
      peerTask: {
        id: "tsk_b",
        name: "Task B",
        status: TaskStatus.RUNNING,
      },
    });
  });

  it("returns 403 for coworker authentication", async () => {
    const app = createCoworkerApp();
    mountPostTaskLink(app as unknown as OpenAPIHonoWithAuth);

    const response = await app.request("http://localhost/tsk_a/links", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        toTaskId: "tsk_b",
        type: TaskLinkType.RELATES,
      }),
    });

    expect(response.status).toBe(403);
    expect(taskLinkCreateMock).not.toHaveBeenCalled();
  });

  it("returns 404 when the target task is not accessible", async () => {
    taskFindFirstMock.mockResolvedValue(null);

    const app = createUserApp();
    mountPostTaskLink(app as unknown as OpenAPIHonoWithAuth);

    const response = await app.request("http://localhost/tsk_a/links", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        toTaskId: "tsk_b",
        type: TaskLinkType.RELATES,
      }),
    });

    expect(response.status).toBe(404);
    expect(taskLinkCreateMock).not.toHaveBeenCalled();
  });

  it("returns 409 when a duplicate link already exists", async () => {
    taskLinkCreateMock.mockRejectedValue(
      Object.assign(new Error("Unique constraint failed"), { code: "P2002" }),
    );

    const app = createUserApp();
    mountPostTaskLink(app as unknown as OpenAPIHonoWithAuth);

    const response = await app.request("http://localhost/tsk_a/links", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        toTaskId: "tsk_b",
        type: TaskLinkType.RELATES,
      }),
    });

    expect(response.status).toBe(409);
  });

  it("uses a serializable transaction and returns 409 on transaction conflict", async () => {
    prismaTransactionMock.mockRejectedValueOnce(
      Object.assign(new Error("Transaction failed"), { code: "P2034" }),
    );

    const app = createUserApp();
    mountPostTaskLink(app as unknown as OpenAPIHonoWithAuth);

    const response = await app.request("http://localhost/tsk_a/links", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        toTaskId: "tsk_b",
        type: TaskLinkType.RELATES,
      }),
    });

    expect(response.status).toBe(409);
    expect(prismaTransactionMock).toHaveBeenCalledWith(expect.any(Function), {
      isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
    });
  });

  it("returns 400 when a task is linked to itself", async () => {
    const app = createUserApp();
    mountPostTaskLink(app as unknown as OpenAPIHonoWithAuth);

    const response = await app.request("http://localhost/tsk_a/links", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        toTaskId: "tsk_a",
        type: TaskLinkType.BLOCKS,
      }),
    });

    expect(response.status).toBe(400);
    expect(taskLinkCreateMock).not.toHaveBeenCalled();
  });
});

describe("DELETE /tasks/{id}/links/{linkId}", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    requireUserTaskAccessMock.mockImplementation(
      async (_auth, taskId: string) => ({
        id: taskId,
        userId: "user_123",
        organizationId: "org_123",
        archivedAt: null,
        status: TaskStatus.READY,
        coworkerId: null,
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
    mountDeleteTaskLink(app as unknown as OpenAPIHonoWithAuth);

    const response = await app.request("http://localhost/tsk_a/links/tl_1", {
      method: "DELETE",
    });

    expect(response.status).toBe(200);
    expect(taskLinkDeleteMock).toHaveBeenCalledWith({
      where: { id: "tl_1" },
    });
  });

  it("returns 200 when the peer task is archived but still owned by the user", async () => {
    requireUserTaskAccessMock.mockImplementation(
      async (_auth, taskId: string) => {
        if (taskId !== "tsk_a") {
          throw new HTTPException(404, { message: "Task not found" });
        }

        return {
          id: taskId,
          userId: "user_123",
          organizationId: "org_123",
          archivedAt: null,
          status: TaskStatus.READY,
          coworkerId: null,
          name: "T",
          description: null,
        };
      },
    );

    const app = createUserApp();
    mountDeleteTaskLink(app as unknown as OpenAPIHonoWithAuth);

    const response = await app.request("http://localhost/tsk_a/links/tl_1", {
      method: "DELETE",
    });

    expect(response.status).toBe(200);
    expect(taskLinkDeleteMock).toHaveBeenCalledWith({
      where: { id: "tl_1" },
    });
    expect(requireUserTaskAccessMock).toHaveBeenCalledTimes(1);
    expect(taskFindUniqueMock).not.toHaveBeenCalled();
  });

  it("returns 200 when the peer task is outside the user's current access scope", async () => {
    requireUserTaskAccessMock.mockImplementation(
      async (_auth, taskId: string) => {
        if (taskId !== "tsk_a") {
          throw new HTTPException(404, { message: "Task not found" });
        }

        return {
          id: taskId,
          userId: "user_123",
          organizationId: "org_123",
          archivedAt: null,
          status: TaskStatus.READY,
          coworkerId: null,
          name: "T",
          description: null,
        };
      },
    );

    const app = createUserApp();
    mountDeleteTaskLink(app as unknown as OpenAPIHonoWithAuth);

    const response = await app.request("http://localhost/tsk_a/links/tl_1", {
      method: "DELETE",
    });

    expect(response.status).toBe(200);
    expect(taskLinkDeleteMock).toHaveBeenCalledWith({
      where: { id: "tl_1" },
    });
    expect(requireUserTaskAccessMock).toHaveBeenCalledTimes(1);
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
    mountDeleteTaskLink(app as unknown as OpenAPIHonoWithAuth);

    const response = await app.request("http://localhost/tsk_a/links/tl_1", {
      method: "DELETE",
    });

    expect(response.status).toBe(404);
    expect(taskLinkDeleteMock).not.toHaveBeenCalled();
  });

  it("returns 403 for coworker authentication", async () => {
    const app = createCoworkerApp();
    mountDeleteTaskLink(app as unknown as OpenAPIHonoWithAuth);

    const response = await app.request("http://localhost/tsk_a/links/tl_1", {
      method: "DELETE",
    });

    expect(response.status).toBe(403);
    expect(taskLinkDeleteMock).not.toHaveBeenCalled();
  });
});

describe("PATCH /tasks/{id}/links/{linkId}", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    requireUserTaskAccessMock.mockImplementation(
      async (_auth, taskId: string) => ({
        id: taskId,
        userId: "user_123",
        organizationId: "org_123",
        archivedAt: null,
        status: TaskStatus.READY,
        coworkerId: null,
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
    mountPatchTaskLink(app as unknown as OpenAPIHonoWithAuth);

    const response = await app.request("http://localhost/tsk_a/links/tl_1", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        type: TaskLinkType.PARENT,
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
        OR: [{ userId: "user_123", organizationId: "org_123" }],
      },
      select: {
        id: true,
        name: true,
        status: true,
      },
    });
    const body = (await response.json()) as {
      data: {
        relation: string;
        peerTask: { id: string; name: string; status: TaskStatus };
      };
    };
    expect(body.data).toMatchObject({
      relation: "parent",
      peerTask: {
        id: "tsk_b",
        name: "Task B",
        status: TaskStatus.RUNNING,
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
    mountPatchTaskLink(app as unknown as OpenAPIHonoWithAuth);

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

  it("returns 404 when the peer task is outside the default read scope", async () => {
    taskFindFirstMock.mockResolvedValueOnce(null);

    const app = createUserApp();
    mountPatchTaskLink(app as unknown as OpenAPIHonoWithAuth);

    const response = await app.request("http://localhost/tsk_a/links/tl_1", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        type: TaskLinkType.PARENT,
      }),
    });

    expect(response.status).toBe(404);
    expect(taskLinkUpdateMock).not.toHaveBeenCalled();
  });

  it("returns 400 when no updatable fields are provided", async () => {
    const app = createUserApp();
    mountPatchTaskLink(app as unknown as OpenAPIHonoWithAuth);

    const response = await app.request("http://localhost/tsk_a/links/tl_1", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });

    expect(response.status).toBe(400);
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
    mountPatchTaskLink(app as unknown as OpenAPIHonoWithAuth);

    const response = await app.request("http://localhost/tsk_a/links/tl_1", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        type: TaskLinkType.DUPLICATE,
      }),
    });

    expect(response.status).toBe(404);
    expect(taskLinkUpdateMock).not.toHaveBeenCalled();
  });

  it("returns 403 for coworker authentication", async () => {
    const app = createCoworkerApp();
    mountPatchTaskLink(app as unknown as OpenAPIHonoWithAuth);

    const response = await app.request("http://localhost/tsk_a/links/tl_1", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        type: TaskLinkType.DUPLICATE,
      }),
    });

    expect(response.status).toBe(403);
    expect(taskLinkUpdateMock).not.toHaveBeenCalled();
  });
});
