import { OpenAPIHono } from "@hono/zod-openapi";
import { TaskLinkType, TaskStatus } from "@sokosumi/database";
import { HTTPException } from "hono/http-exception";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { OpenAPIHonoWithAuth } from "@/lib/hono";
import type { AuthenticationContext, AuthVariables } from "@/middleware/auth";

import mountDeleteTaskLink from "./[linkId]/delete";
import mountGetTaskLinks from "./get";
import mountPostTaskLink from "./post";

const {
  prismaTransactionMock,
  requireScopedTaskReadAccessMock,
  requireUserTaskAccessMock,
  taskFindUniqueMock,
  taskLinkCreateMock,
  taskLinkDeleteMock,
  taskLinkFindUniqueMock,
} = vi.hoisted(() => ({
  prismaTransactionMock: vi.fn(),
  requireScopedTaskReadAccessMock: vi.fn(),
  requireUserTaskAccessMock: vi.fn(),
  taskFindUniqueMock: vi.fn(),
  taskLinkCreateMock: vi.fn(),
  taskLinkDeleteMock: vi.fn(),
  taskLinkFindUniqueMock: vi.fn(),
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
      findUnique: taskFindUniqueMock,
    },
    taskLink: {
      create: taskLinkCreateMock,
      findUnique: taskLinkFindUniqueMock,
      delete: taskLinkDeleteMock,
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
        name: "T",
        description: null,
      }),
    );
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
    requireUserTaskAccessMock.mockImplementation(
      async (_auth, taskId: string) => {
        if (taskId === "tsk_b") {
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
