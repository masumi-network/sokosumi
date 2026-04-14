import { OpenAPIHono } from "@hono/zod-openapi";
import { TaskStatus } from "@sokosumi/database";
import { HTTPException } from "hono/http-exception";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { OpenAPIHonoWithAuth } from "@/lib/hono";
import type { AuthWithWorkspaceEnv } from "@/middleware/workspace";

import mountGetTasks from "./get";

const {
  prismaTransactionMock,
  requireCoworkerCapabilityMock,
  taskCountMock,
  taskFindManyMock,
} = vi.hoisted(() => ({
  prismaTransactionMock: vi.fn(),
  requireCoworkerCapabilityMock: vi.fn(),
  taskCountMock: vi.fn(),
  taskFindManyMock: vi.fn(),
}));

vi.mock("@/helpers/access-control", () => ({
  requireCoworkerCapability: requireCoworkerCapabilityMock,
}));

vi.mock("@/lib/db/prisma", () => ({
  default: {
    $transaction: prismaTransactionMock,
    task: {
      count: taskCountMock,
      findMany: taskFindManyMock,
    },
  },
}));

function createApp(
  actor: "user" | "coworker" = "user",
  organizationId: string | null = "org_123",
  workspaceContext: {
    workspaceId: string;
    userId: string | null;
    organizationId: string | null;
  } | null = organizationId
    ? {
        workspaceId: "11111111-1111-7111-8111-111111111111",
        userId: null,
        organizationId,
      }
    : {
        workspaceId: "11111111-1111-7111-8111-111111111111",
        userId: "user_123",
        organizationId: null,
      },
) {
  const app = new OpenAPIHono<AuthWithWorkspaceEnv>();

  app.use("*", async (c, next) => {
    c.set("isAuthenticated", true);
    if (actor === "coworker") {
      c.set("authContext", {
        actor: "coworker",
        coworkerId: "cow_123",
      });
    } else {
      c.set("authContext", {
        actor: "user",
        userId: "user_123",
        organizationId,
      });
    }
    c.set("workspaceContext", workspaceContext);

    return await next();
  });

  mountGetTasks(app as unknown as OpenAPIHonoWithAuth);
  return app;
}

function createTask() {
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
    events: [],
    jobs: [],
    workspace: {
      id: "11111111-1111-7111-8111-111111111111",
      organizationId: "org_123",
      organization: {
        id: "org_123",
        name: "Workspace Org",
        slug: "workspace-org",
      },
    },
  };
}

describe("GET /tasks", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    requireCoworkerCapabilityMock.mockResolvedValue(undefined);
    taskFindManyMock.mockResolvedValue([]);
    taskCountMock.mockResolvedValue(0);
    prismaTransactionMock.mockImplementation(async (operations) => {
      return await Promise.all(operations);
    });
  });

  it("parses multiple statuses into an IN filter", async () => {
    const app = createApp();
    const response = await app.request(
      "http://localhost/?status=COMPLETED,FAILED&status=COMPLETED",
    );

    expect(response.status).toBe(200);
    expect(taskFindManyMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          archivedAt: null,
          workspaceId: "11111111-1111-7111-8111-111111111111",
          status: {
            in: [TaskStatus.COMPLETED, TaskStatus.FAILED],
          },
        },
      }),
    );
  });

  it("applies a case-insensitive task name filter when q is provided", async () => {
    const app = createApp();
    const response = await app.request("http://localhost/?q=review");

    expect(response.status).toBe(200);
    expect(taskFindManyMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          archivedAt: null,
          workspaceId: "11111111-1111-7111-8111-111111111111",
          name: {
            contains: "review",
            mode: "insensitive",
          },
        },
      }),
    );
  });

  it("does not include task links for user-scoped task list reads", async () => {
    const app = createApp();

    const response = await app.request("http://localhost/");

    expect(response.status).toBe(200);
    const include = taskFindManyMock.mock.calls[0]?.[0]?.include;
    expect(include).not.toHaveProperty("linksFrom");
    expect(include).not.toHaveProperty("linksTo");
  });

  it("does not include task links for coworker-scoped task list reads", async () => {
    const app = createApp("coworker");

    const response = await app.request("http://localhost/");

    expect(response.status).toBe(200);
    const include = taskFindManyMock.mock.calls[0]?.[0]?.include;
    expect(include).not.toHaveProperty("linksFrom");
    expect(include).not.toHaveProperty("linksTo");
  });

  it("resolves the active workspace for user-scoped task lists", async () => {
    const app = createApp();

    const response = await app.request("http://localhost/");

    expect(response.status).toBe(200);
  });

  it("returns 404 when workspaceContext is null", async () => {
    const app = createApp("user", "org_123", null);

    const response = await app.request("http://localhost/");

    expect(response.status).toBe(404);
    expect(taskFindManyMock).not.toHaveBeenCalled();
    expect(taskCountMock).not.toHaveBeenCalled();
  });

  it("filters task lists by userId", async () => {
    const app = createApp();

    const response = await app.request("http://localhost/?userId=user_456");

    expect(response.status).toBe(200);
    expect(taskFindManyMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          archivedAt: null,
          workspaceId: "11111111-1111-7111-8111-111111111111",
          userId: "user_456",
        },
      }),
    );
  });

  it("defaults scope to context for user requests", async () => {
    const app = createApp();

    const response = await app.request("http://localhost/?scope=context");

    expect(response.status).toBe(200);
    expect(taskFindManyMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          archivedAt: null,
          workspaceId: "11111111-1111-7111-8111-111111111111",
        },
      }),
    );
  });

  it("filters task lists to owned tasks when scope=owned", async () => {
    const app = createApp();

    const response = await app.request("http://localhost/?scope=owned");

    expect(response.status).toBe(200);
    expect(taskFindManyMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          archivedAt: null,
          workspaceId: "11111111-1111-7111-8111-111111111111",
          userId: "user_123",
        },
      }),
    );
  });

  it("lets scope=owned override an explicit userId filter", async () => {
    const app = createApp();

    const response = await app.request(
      "http://localhost/?scope=owned&userId=user_456",
    );

    expect(response.status).toBe(200);
    expect(taskFindManyMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          archivedAt: null,
          workspaceId: "11111111-1111-7111-8111-111111111111",
          userId: "user_123",
        },
      }),
    );
  });

  it("filters coworker task lists by userId", async () => {
    const app = createApp("coworker");

    const response = await app.request("http://localhost/?userId=user_456");

    expect(response.status).toBe(200);
    expect(taskFindManyMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          archivedAt: null,
          coworkerId: "cow_123",
          userId: "user_456",
          NOT: {
            status: {
              in: [TaskStatus.DRAFT],
            },
          },
        },
      }),
    );
  });

  it("rejects scope=owned for coworker requests", async () => {
    const app = createApp("coworker");

    const response = await app.request("http://localhost/?scope=owned");

    expect(response.status).toBe(400);
    expect(taskFindManyMock).not.toHaveBeenCalled();
    expect(taskCountMock).not.toHaveBeenCalled();
  });

  it("filters task lists by associated agentId", async () => {
    const app = createApp();

    const response = await app.request("http://localhost/?agentId=agent_456");

    expect(response.status).toBe(200);
    expect(taskFindManyMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          archivedAt: null,
          workspaceId: "11111111-1111-7111-8111-111111111111",
          jobs: {
            some: {
              agentId: "agent_456",
            },
          },
        },
      }),
    );
  });

  it("filters coworker task lists by associated agentId", async () => {
    const app = createApp("coworker");

    const response = await app.request("http://localhost/?agentId=agent_456");

    expect(response.status).toBe(200);
    expect(taskFindManyMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          archivedAt: null,
          coworkerId: "cow_123",
          jobs: {
            some: {
              agentId: "agent_456",
            },
          },
          NOT: {
            status: {
              in: [TaskStatus.DRAFT],
            },
          },
        },
      }),
    );
  });

  it("ignores unknown memberId query params", async () => {
    const app = createApp();

    const response = await app.request("http://localhost/?memberId=user_999");

    expect(response.status).toBe(200);
    expect(taskFindManyMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          archivedAt: null,
          workspaceId: "11111111-1111-7111-8111-111111111111",
        },
      }),
    );
  });

  it("returns 404 for missing personal workspaceContext even when userId is provided", async () => {
    const app = createApp("user", null);

    const response = await app.request("http://localhost/?userId=user_456");

    expect(response.status).toBe(200);
    expect(taskFindManyMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          archivedAt: null,
          workspaceId: "11111111-1111-7111-8111-111111111111",
          userId: "user_456",
        },
      }),
    );
  });

  it("returns 404 when personal workspaceContext is null and userId is provided", async () => {
    const app = createApp("user", null, null);

    const response = await app.request("http://localhost/?userId=user_456");

    expect(response.status).toBe(404);
    expect(taskFindManyMock).not.toHaveBeenCalled();
    expect(taskCountMock).not.toHaveBeenCalled();
  });

  it("returns task list items without links", async () => {
    taskFindManyMock.mockResolvedValue([createTask()]);
    taskCountMock.mockResolvedValue(1);

    const app = createApp();
    const response = await app.request("http://localhost/");

    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      data: Array<Record<string, unknown>>;
    };
    expect(body.data).toHaveLength(1);
    expect(body.data[0]).not.toHaveProperty("links");
  });

  it("rejects coworker requests that include DRAFT", async () => {
    const app = createApp("coworker");
    const response = await app.request("http://localhost/?status=DRAFT,READY");

    expect(response.status).toBe(400);
    expect(taskFindManyMock).not.toHaveBeenCalled();
    expect(taskCountMock).not.toHaveBeenCalled();
  });

  it("rejects coworker requests when tasks capability is unavailable", async () => {
    requireCoworkerCapabilityMock.mockRejectedValue(
      new HTTPException(403, {
        message: "Coworker is not allowed to use tasks",
      }),
    );

    const app = createApp("coworker");
    const response = await app.request("http://localhost/");

    expect(response.status).toBe(403);
    expect(taskFindManyMock).not.toHaveBeenCalled();
    expect(taskCountMock).not.toHaveBeenCalled();
  });
});
