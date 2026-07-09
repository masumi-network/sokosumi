import { OpenAPIHono } from "@hono/zod-openapi";
import { TaskStatus } from "@sokosumi/utils";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { OpenAPIHonoWithAuth } from "@/lib/hono";
import type { AuthVariables } from "@/middleware/auth";
import type { WorkspaceVariables } from "@/middleware/workspace";

import mountPatchTask, { patchTaskRequestSchema } from "./patch";

const {
  mapTaskMock,
  prismaTransactionMock,
  projectFindFirstMock,
  requireTaskAssignableCoworkerMock,
  requireTaskOwnershipMock,
  taskUpdateMock,
} = vi.hoisted(() => ({
  mapTaskMock: vi.fn(),
  prismaTransactionMock: vi.fn(),
  projectFindFirstMock: vi.fn(),
  requireTaskAssignableCoworkerMock: vi.fn(),
  requireTaskOwnershipMock: vi.fn(),
  taskUpdateMock: vi.fn(),
}));

vi.mock("@/helpers/access-control", () => ({
  requireTaskAssignableCoworker: requireTaskAssignableCoworkerMock,
  requireTaskOwnership: requireTaskOwnershipMock,
}));

vi.mock("@/helpers/task", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/helpers/task")>();

  return {
    ...actual,
    mapTask: mapTaskMock,
  };
});

vi.mock("@/lib/db/prisma", () => ({
  default: {
    $transaction: prismaTransactionMock,
  },
}));

const WORKSPACE_ID = "11111111-1111-7111-8111-111111111111";
const PROJECT_ID = "aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa";
const OTHER_PROJECT_ID = "bbbbbbbb-bbbb-4bbb-bbbb-bbbbbbbbbbbb";

function createTaskApi(projectId: string | null = null) {
  return {
    id: "tsk_123",
    createdAt: "2026-04-02T08:00:00.000Z",
    updatedAt: "2026-04-02T08:00:00.000Z",
    userId: "user_123",
    organizationId: "org_123",
    projectId,
    user: {
      id: "user_123",
      name: "Ada Lovelace",
      image: null,
    },
    organization: {
      id: "org_123",
      name: "Acme Labs",
      slug: "acme-labs",
    },
    coworkerId: null,
    coworker: null,
    name: "Updated Task",
    description: null,
    status: TaskStatus.DRAFT,
    metadata: null,
    nextRunAt: null,
    pendingVendorGrantId: null,
    awaitingVendorApproval: false,
    credits: 0,
    events: [],
    jobs: [],
    workspace: {
      id: WORKSPACE_ID,
      organizationId: "org_123",
      organization: {
        id: "org_123",
        name: "Acme Labs",
        slug: "acme-labs",
      },
    },
    share: null,
    links: [],
  };
}

function createApp() {
  const app = new OpenAPIHono<{
    Variables: AuthVariables & WorkspaceVariables;
  }>();

  app.use("*", async (c, next) => {
    c.set("isAuthenticated", true);
    c.set("authContext", {
      actor: "user",
      userId: "user_123",
      organizationId: "org_123",
      role: "user",
    });
    c.set("workspaceContext", {
      workspaceId: WORKSPACE_ID,
      userId: null,
      organizationId: "org_123",
    });

    return await next();
  });

  mountPatchTask(app as unknown as OpenAPIHonoWithAuth);

  return app;
}

describe("patchTaskRequestSchema", () => {
  it("accepts projectId as the only patch field", () => {
    const result = patchTaskRequestSchema.parse({
      projectId: PROJECT_ID,
    });

    expect(result.projectId).toBe(PROJECT_ID);
  });
});

describe("PATCH /tasks/{id}", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    requireTaskOwnershipMock.mockResolvedValue({
      id: "tsk_123",
      status: TaskStatus.DRAFT,
      coworkerId: null,
      projectId: null,
      workspaceId: WORKSPACE_ID,
    });
    projectFindFirstMock.mockResolvedValue({ id: PROJECT_ID });
    taskUpdateMock.mockResolvedValue(createTaskApi(PROJECT_ID));
    mapTaskMock.mockImplementation((task) => createTaskApi(task.projectId));
    prismaTransactionMock.mockImplementation(async (callback) => {
      return await callback({
        project: {
          findFirst: projectFindFirstMock,
        },
        task: {
          update: taskUpdateMock,
        },
      });
    });
  });

  it("assigns a task to a workspace project", async () => {
    const app = createApp();

    const response = await app.request("http://localhost/tsk_123", {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        projectId: PROJECT_ID,
      }),
    });

    expect(response.status).toBe(200);
    expect(projectFindFirstMock).toHaveBeenCalledWith({
      where: {
        id: PROJECT_ID,
        workspaceId: WORKSPACE_ID,
      },
      select: { id: true },
    });
    expect(taskUpdateMock).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          projectId: PROJECT_ID,
        }),
      }),
    );
  });

  it("unassigns a task from its project", async () => {
    const app = createApp();
    requireTaskOwnershipMock.mockResolvedValue({
      id: "tsk_123",
      status: TaskStatus.DRAFT,
      coworkerId: null,
      projectId: PROJECT_ID,
      workspaceId: WORKSPACE_ID,
    });
    taskUpdateMock.mockResolvedValue(createTaskApi(null));

    const response = await app.request("http://localhost/tsk_123", {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        projectId: null,
      }),
    });

    expect(response.status).toBe(200);
    expect(projectFindFirstMock).not.toHaveBeenCalled();
    expect(taskUpdateMock).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          projectId: null,
        }),
      }),
    );
  });

  it("rejects assignment to a project outside the task workspace", async () => {
    const app = createApp();
    projectFindFirstMock.mockResolvedValue(null);

    const response = await app.request("http://localhost/tsk_123", {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        projectId: PROJECT_ID,
      }),
    });

    expect(response.status).toBe(404);
    expect(taskUpdateMock).not.toHaveBeenCalled();
  });

  it("moves a task directly between projects", async () => {
    const app = createApp();
    requireTaskOwnershipMock.mockResolvedValue({
      id: "tsk_123",
      status: TaskStatus.DRAFT,
      coworkerId: null,
      projectId: OTHER_PROJECT_ID,
      workspaceId: WORKSPACE_ID,
    });

    const response = await app.request("http://localhost/tsk_123", {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        projectId: PROJECT_ID,
      }),
    });

    expect(response.status).toBe(200);
    expect(taskUpdateMock).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          projectId: PROJECT_ID,
        }),
      }),
    );
  });

  it("updates metadata for a queued task", async () => {
    const app = createApp();
    requireTaskOwnershipMock.mockResolvedValue({
      id: "tsk_123",
      status: TaskStatus.QUEUED,
      coworkerId: "cow_123",
      projectId: null,
      workspaceId: WORKSPACE_ID,
    });
    taskUpdateMock.mockResolvedValue({
      ...createTaskApi(null),
      status: TaskStatus.QUEUED,
      name: "Updated queued task",
    });

    const response = await app.request("http://localhost/tsk_123", {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        name: "Updated queued task",
      }),
    });

    expect(response.status).toBe(200);
    expect(taskUpdateMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          status: {
            in: [TaskStatus.DRAFT, TaskStatus.QUEUED, TaskStatus.READY],
          },
        }),
        data: expect.objectContaining({
          name: "Updated queued task",
        }),
      }),
    );
  });
});
