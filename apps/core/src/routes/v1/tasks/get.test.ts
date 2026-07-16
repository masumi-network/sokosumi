import { OpenAPIHono } from "@hono/zod-openapi";
import { TaskStatus } from "@sokosumi/database";
import { HTTPException } from "hono/http-exception";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { OpenAPIHonoWithAuth } from "@/lib/hono";
import type { AuthenticationContext, AuthVariables } from "@/middleware/auth";
import type { WorkspaceVariables } from "@/middleware/workspace";

import mountGetTasks from "./get";

const {
  requireCoworkerCapabilityMock,
  taskCountMock,
  taskFindManyMock,
  vendorGrantFindUniqueMock,
} = vi.hoisted(() => ({
  requireCoworkerCapabilityMock: vi.fn(),
  taskCountMock: vi.fn(),
  taskFindManyMock: vi.fn(),
  vendorGrantFindUniqueMock: vi.fn(),
}));

vi.mock("@/helpers/access-control", () => ({
  requireCoworkerCapability: requireCoworkerCapabilityMock,
}));

vi.mock("@/lib/db/prisma", () => ({
  default: {
    task: {
      count: taskCountMock,
      findMany: taskFindManyMock,
    },
    vendorGrant: {
      findUnique: vendorGrantFindUniqueMock,
    },
  },
}));

const USER_AUTH_CONTEXT: AuthenticationContext = {
  actor: "user",
  userId: "user_123",
  organizationId: "org_123",
  role: "user",
};

const COWORKER_AUTH_CONTEXT: AuthenticationContext = {
  actor: "coworker",
  coworkerId: "cow_123",
  vendorId: "01960001-0001-7001-8001-000000000001",
};

const DELEGATED_COWORKER_AUTH_CONTEXT: AuthenticationContext = {
  actor: "coworker",
  coworkerId: "cow_123",
  vendorId: "01960001-0001-7001-8001-000000000001",
  context: {
    userId: "user_delegate",
    organizationId: "org_delegate",
  },
};

const USER_WORKSPACE_CONTEXT = {
  workspaceId: "11111111-1111-7111-8111-111111111111",
  userId: null,
  organizationId: "org_123",
} satisfies WorkspaceVariables["workspaceContext"];

const DELEGATED_WORKSPACE_CONTEXT = {
  workspaceId: "22222222-2222-7222-8222-222222222222",
  userId: "user_delegate",
  organizationId: "org_delegate",
} satisfies WorkspaceVariables["workspaceContext"];

const DELEGATED_VENDOR_ID = "01960001-0001-7001-8001-000000000001";

const COWORKER_SIBLING_LIST_FILTER = {
  status: { not: TaskStatus.DRAFT },
  OR: [
    { coworkerId: "cow_123" },
    {
      coworkerId: { not: "cow_123" },
      coworker: {
        vendorId: DELEGATED_VENDOR_ID,
      },
    },
  ],
} as const;

function delegatedCoworkerListWhere(
  extra: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    archivedAt: null,
    workspaceId: "22222222-2222-7222-8222-222222222222",
    AND: [COWORKER_SIBLING_LIST_FILTER],
    ...extra,
  };
}

function createApp(
  authContext: AuthenticationContext = USER_AUTH_CONTEXT,
  workspaceContext: WorkspaceVariables["workspaceContext"] = USER_WORKSPACE_CONTEXT,
) {
  const app = new OpenAPIHono<{
    Variables: AuthVariables & WorkspaceVariables;
  }>();

  app.use("*", async (c, next) => {
    c.set("isAuthenticated", true);
    c.set("authContext", authContext);
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
    user: { id: "user_123", name: "Task Owner", image: null },
    organizationId: "org_123",
    projectId: null,
    organization: {
      id: "org_123",
      name: "Workspace Org",
      slug: "workspace-org",
    },
    coworkerId: "cow_123",
    coworker: {
      id: "cow_123",
      name: "Coworker",
      image: null,
      slug: "cow-worker",
    },
    name: "Task A",
    description: null,
    status: TaskStatus.READY,
    _count: {
      events: 0,
      jobs: 0,
    },
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
    vendorGrantFindUniqueMock.mockResolvedValue(null);
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
          userId: "user_123",
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
          userId: "user_123",
          workspaceId: "11111111-1111-7111-8111-111111111111",
          name: {
            contains: "review",
            mode: "insensitive",
          },
        },
      }),
    );
  });

  it("scopes owned task lists to the authenticated user", async () => {
    const app = createApp();
    const response = await app.request("http://localhost/");

    expect(response.status).toBe(200);
    expect(taskFindManyMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          archivedAt: null,
          userId: "user_123",
          workspaceId: "11111111-1111-7111-8111-111111111111",
        },
      }),
    );
  });

  it("omits the authenticated user filter when scope=workspace is provided", async () => {
    const app = createApp();
    const response = await app.request("http://localhost/?scope=workspace");

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

  it("filters tasks by projectId", async () => {
    const app = createApp();
    const projectId = "33333333-3333-4333-8333-333333333333";
    const response = await app.request(
      `http://localhost/?projectId=${projectId}`,
    );

    expect(response.status).toBe(200);
    expect(taskFindManyMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          archivedAt: null,
          userId: "user_123",
          workspaceId: "11111111-1111-7111-8111-111111111111",
          projectId,
        },
      }),
    );
  });

  it("filters tasks unassigned to a project with projectId=null", async () => {
    const app = createApp();
    const response = await app.request("http://localhost/?projectId=null");

    expect(response.status).toBe(200);
    expect(taskFindManyMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          archivedAt: null,
          userId: "user_123",
          workspaceId: "11111111-1111-7111-8111-111111111111",
          projectId: null,
        },
      }),
    );
  });

  it("uses relation counts instead of loading task detail graphs", async () => {
    const app = createApp();

    const response = await app.request("http://localhost/");

    expect(response.status).toBe(200);
    const include = taskFindManyMock.mock.calls[0]?.[0]?.include;
    expect(include).not.toHaveProperty("events");
    expect(include).not.toHaveProperty("jobs");
    expect(include).not.toHaveProperty("linksFrom");
    expect(include).not.toHaveProperty("linksTo");
    expect(include).toMatchObject({
      _count: {
        select: {
          events: { where: { comment: { not: null } } },
          jobs: true,
        },
      },
    });
  });

  it("does not include task links for coworker-scoped task list reads", async () => {
    const app = createApp(COWORKER_AUTH_CONTEXT, null);

    const response = await app.request("http://localhost/");

    expect(response.status).toBe(200);
    const include = taskFindManyMock.mock.calls[0]?.[0]?.include;
    expect(include).not.toHaveProperty("linksFrom");
    expect(include).not.toHaveProperty("linksTo");
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
    expect(body.data[0]).not.toHaveProperty("events");
    expect(body.data[0]).not.toHaveProperty("jobs");
    expect(body.data[0]).toMatchObject({
      commentsCount: 0,
      jobsCount: 0,
    });
  });

  it("rejects coworker requests that include DRAFT", async () => {
    const app = createApp(COWORKER_AUTH_CONTEXT, null);
    const response = await app.request("http://localhost/?status=DRAFT,READY");

    expect(response.status).toBe(400);
    expect(taskFindManyMock).not.toHaveBeenCalled();
    expect(taskCountMock).not.toHaveBeenCalled();
  });

  it("allows coworker requests that filter by QUEUED", async () => {
    const app = createApp(COWORKER_AUTH_CONTEXT, null);
    const response = await app.request("http://localhost/?status=QUEUED");

    expect(response.status).toBe(200);
    expect(taskFindManyMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          archivedAt: null,
          AND: [COWORKER_SIBLING_LIST_FILTER],
          status: {
            in: [TaskStatus.QUEUED],
          },
        },
      }),
    );
  });

  it("rejects coworker requests when tasks capability is unavailable", async () => {
    requireCoworkerCapabilityMock.mockRejectedValue(
      new HTTPException(403, {
        message: "Coworker is not allowed to use tasks",
      }),
    );

    const app = createApp(COWORKER_AUTH_CONTEXT, null);
    const response = await app.request("http://localhost/");

    expect(response.status).toBe(403);
    expect(taskFindManyMock).not.toHaveBeenCalled();
    expect(taskCountMock).not.toHaveBeenCalled();
  });

  it("uses delegated user and workspace for delegated coworker owned scope", async () => {
    const app = createApp(
      DELEGATED_COWORKER_AUTH_CONTEXT,
      DELEGATED_WORKSPACE_CONTEXT,
    );
    const response = await app.request("http://localhost/");

    expect(response.status).toBe(200);
    expect(taskFindManyMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: delegatedCoworkerListWhere({
          userId: "user_delegate",
        }),
      }),
    );
  });

  it("uses delegated workspace scope for delegated coworker workspace queries", async () => {
    const app = createApp(
      DELEGATED_COWORKER_AUTH_CONTEXT,
      DELEGATED_WORKSPACE_CONTEXT,
    );
    const response = await app.request(
      "http://localhost/?scope=workspace&coworkerId=cow_999",
    );

    expect(response.status).toBe(200);
    expect(taskFindManyMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: delegatedCoworkerListWhere({
          coworkerId: "cow_999",
        }),
      }),
    );
  });

  it("filters tasks by status list only", async () => {
    const app = createApp();
    const response = await app.request(
      `http://localhost/?status=${TaskStatus.READY},${TaskStatus.CREDITS_TOPPED_UP}`,
    );

    expect(response.status).toBe(200);
    expect(taskFindManyMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          status: { in: [TaskStatus.READY, TaskStatus.CREDITS_TOPPED_UP] },
        }),
      }),
    );
  });

  it("filters grant-pending tasks by status", async () => {
    const app = createApp();
    const response = await app.request(
      `http://localhost/?status=${TaskStatus.GRANT_PENDING}`,
    );

    expect(response.status).toBe(200);
    expect(taskFindManyMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          status: { in: [TaskStatus.GRANT_PENDING] },
        }),
      }),
    );
  });
});
