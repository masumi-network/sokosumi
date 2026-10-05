import { TaskStatus, TaskVisibility } from "@sokosumi/database";
import { HTTPException } from "hono/http-exception";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { errorHandler } from "@/helpers/error-handler";
import { buildHumanTaskVisibilityWhere } from "@/helpers/task-visibility";
import { OpenAPIHonoWithAuth } from "@/lib/hono";
import type { AuthenticationContext } from "@/middleware/auth";
import type { WorkspaceVariables } from "@/middleware/workspace";
import { TEST_VENDOR_ID } from "@/test-fixtures/vendor.js";

const {
  deliverCalendarInvalidationsNowMock,
  projectFindFirstMock,
  lockCalendarScopeMock,
  lockTaskRowsMock,
  prismaTransactionMock,
  taskFindFirstMock,
  taskUpdateManyMock,
  taskUpdateMock,
} = vi.hoisted(() => ({
  deliverCalendarInvalidationsNowMock: vi.fn(),
  projectFindFirstMock: vi.fn(),
  lockCalendarScopeMock: vi.fn(),
  lockTaskRowsMock: vi.fn(),
  prismaTransactionMock: vi.fn(),
  taskFindFirstMock: vi.fn(),
  taskUpdateManyMock: vi.fn(),
  taskUpdateMock: vi.fn(),
}));

vi.mock("@/helpers/calendar-invalidation", () => ({
  deliverCalendarInvalidationsNow: deliverCalendarInvalidationsNowMock,
}));

vi.mock("@/helpers/calendar-locks", () => ({
  lockCalendarScope: lockCalendarScopeMock,
  lockTaskRows: lockTaskRowsMock,
}));

vi.mock("@/middleware/auth", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/middleware/auth")>()),
  authMiddleware: (await import("@/test-fixtures/auth-middleware"))
    .stubAuthMiddleware,
  requireOwnerUserContext: (authContext: AuthenticationContext | null) => {
    if (!authContext || authContext.actor === "coworker") {
      throw new HTTPException(403, {
        message: "Coworker authentication cannot perform this owner action",
      });
    }
    if (authContext.actor !== "user") {
      throw new HTTPException(403, { message: "User authentication required" });
    }
    return { source: "session" as const, ...authContext };
  },
}));

vi.mock("@/middleware/workspace", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/middleware/workspace")>()),
  requireWorkspaceContext: (
    workspaceContext: { workspaceId: string } | null,
  ) => {
    if (!workspaceContext) {
      throw new HTTPException(400, { message: "Workspace context required" });
    }
    return workspaceContext;
  },
}));

vi.mock("@/lib/db/prisma", () => ({
  default: {
    $transaction: prismaTransactionMock,
    project: { findFirst: projectFindFirstMock },
    task: {
      findFirst: taskFindFirstMock,
      updateMany: taskUpdateManyMock,
      update: taskUpdateMock,
    },
  },
}));

const USER_AUTH_CONTEXT: AuthenticationContext = {
  actor: "user",
  userId: "user_123",
  organizationId: null,
  role: "user",
};

const COWORKER_CONTEXT_AUTH: AuthenticationContext = {
  actor: "coworker",
  coworkerId: "cow_1",
  vendorId: TEST_VENDOR_ID,
  context: { userId: "user_123", organizationId: null },
};

const OTHER_MEMBER_AUTH_CONTEXT: AuthenticationContext = {
  ...USER_AUTH_CONTEXT,
  userId: "user_456",
};

const WORKSPACE_ID = "aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa";
const PROJECT_ID = "22222222-2222-4222-8222-222222222222";
const TASK_ID = "tsk_abc";

const WORKSPACE_CONTEXT = {
  workspaceId: WORKSPACE_ID,
  userId: "user_123",
  organizationId: null,
} satisfies WorkspaceVariables["workspaceContext"];

const sampleProject = {
  id: PROJECT_ID,
  workspaceId: WORKSPACE_ID,
  name: "P",
  websiteUrl: null,
  identifier: null,
  logo: null,
  designMdUrl: null,
  designMdExtractionId: null,
  briefing: null,
  briefingUrl: null,
  contextMd: null,
  contextMdUrl: null,
  contextMdUpdatedAt: null,
  contextMdModel: null,
  contextMdUpdatingSince: null,
  contextMdVersion: 0,
  latestUpdateMd: null,
  latestUpdateMdUpdatedAt: null,
  createdAt: new Date("2026-04-03T08:00:00.000Z"),
  updatedAt: new Date("2026-04-03T08:00:00.000Z"),
};

type StoredTask = {
  visibility: TaskVisibility;
  ownerId: string;
};

// Applies the route's visibility OR clauses to one stored row, so the tests
// exercise the real human visibility rule instead of a hand-picked null.
function findFirstVisibleTask(task: StoredTask) {
  return async ({ where }: { where: { OR: Partial<StoredTask>[] } }) =>
    where.OR.some((clause) =>
      Object.entries(clause).every(
        ([key, value]) => task[key as keyof StoredTask] === value,
      ),
    )
      ? {
          ...task,
          projectId: null,
          pendingVendorGrantId: null,
          status: TaskStatus.READY,
          workspaceId: WORKSPACE_ID,
        }
      : null;
}

let mountPostProjectTask: (app: OpenAPIHonoWithAuth) => void;

function createApp(authContext: AuthenticationContext = USER_AUTH_CONTEXT) {
  const app = new OpenAPIHonoWithAuth();
  app.onError(errorHandler);

  app.use("*", async (c, next) => {
    c.set("requestId", "req_123");
    c.set("isAuthenticated", true);
    c.set("authContext", authContext);
    c.set("workspaceContext", WORKSPACE_CONTEXT);
    return await next();
  });

  mountPostProjectTask(app);
  return app;
}

beforeAll(async () => {
  const module = await import("./post");
  mountPostProjectTask = module.default;
});

describe("POST /projects/{id}/tasks", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    projectFindFirstMock.mockResolvedValue(sampleProject);
    lockCalendarScopeMock.mockResolvedValue(true);
    lockTaskRowsMock.mockResolvedValue(true);
    prismaTransactionMock.mockImplementation(async (callback) =>
      callback({
        task: {
          updateMany: taskUpdateManyMock,
        },
      }),
    );
    taskUpdateManyMock.mockResolvedValue({ count: 1 });
  });

  it("links a workspace task to the project without requiring ownership", async () => {
    taskFindFirstMock.mockResolvedValue({
      projectId: null,
      pendingVendorGrantId: null,
      status: TaskStatus.DRAFT,
      workspaceId: WORKSPACE_ID,
    });

    const response = await createApp().request(
      `http://localhost/${PROJECT_ID}/tasks`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ taskId: TASK_ID }),
      },
    );

    expect(response.status).toBe(200);
    expect(deliverCalendarInvalidationsNowMock).toHaveBeenCalledWith(
      WORKSPACE_ID,
    );
    expect(taskUpdateManyMock).toHaveBeenCalledWith({
      where: {
        id: TASK_ID,
        archivedAt: null,
        workspaceId: WORKSPACE_ID,
        projectId: null,
        ...buildHumanTaskVisibilityWhere("user_123"),
      },
      data: {
        projectId: PROJECT_ID,
        workspaceId: WORKSPACE_ID,
      },
    });
  });

  it("returns 403 when the task is parked", async () => {
    taskFindFirstMock.mockResolvedValue({
      projectId: null,
      status: TaskStatus.GRANT_PENDING,
    });

    const response = await createApp().request(
      `http://localhost/${PROJECT_ID}/tasks`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ taskId: TASK_ID }),
      },
    );

    expect(response.status).toBe(403);
    expect(taskUpdateMock).not.toHaveBeenCalled();
  });

  it("adds a Queued Task with a Run at like any other Task", async () => {
    taskFindFirstMock.mockResolvedValue({
      projectId: null,
      pendingVendorGrantId: null,
      status: TaskStatus.QUEUED,
      workspaceId: WORKSPACE_ID,
    });

    const response = await createApp().request(
      `http://localhost/${PROJECT_ID}/tasks`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ taskId: TASK_ID }),
      },
    );

    expect(response.status).toBe(200);
    expect(taskUpdateManyMock).toHaveBeenCalledWith(
      expect.objectContaining({
        data: { projectId: PROJECT_ID, workspaceId: WORKSPACE_ID },
      }),
    );
  });

  it("returns 404 when project is missing", async () => {
    projectFindFirstMock.mockResolvedValue(null);

    const response = await createApp().request(
      `http://localhost/${PROJECT_ID}/tasks`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ taskId: TASK_ID }),
      },
    );

    expect(response.status).toBe(404);
    expect(taskFindFirstMock).not.toHaveBeenCalled();
  });

  it("rejects coworker context even with X-Context-User-Id", async () => {
    const response = await createApp(COWORKER_CONTEXT_AUTH).request(
      `http://localhost/${PROJECT_ID}/tasks`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ taskId: TASK_ID }),
      },
    );

    expect(response.status).toBe(403);
    expect(projectFindFirstMock).not.toHaveBeenCalled();
    expect(taskUpdateMock).not.toHaveBeenCalled();
  });

  describe("private Task visibility", () => {
    const postTask = (authContext: AuthenticationContext) =>
      createApp(authContext).request(`http://localhost/${PROJECT_ID}/tasks`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ taskId: TASK_ID }),
      });

    it("lets the owner add their private Task", async () => {
      taskFindFirstMock.mockImplementation(
        findFirstVisibleTask({
          visibility: TaskVisibility.PRIVATE,
          ownerId: "user_123",
        }),
      );

      const response = await postTask(USER_AUTH_CONTEXT);

      expect(response.status).toBe(200);
      expect(taskFindFirstMock).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            id: TASK_ID,
            archivedAt: null,
            workspaceId: WORKSPACE_ID,
            ...buildHumanTaskVisibilityWhere("user_123"),
          },
        }),
      );
      expect(taskUpdateManyMock).toHaveBeenCalledOnce();
    });

    it("returns 404 when another member adds a private Task", async () => {
      taskFindFirstMock.mockImplementation(
        findFirstVisibleTask({
          visibility: TaskVisibility.PRIVATE,
          ownerId: "user_123",
        }),
      );

      const response = await postTask(OTHER_MEMBER_AUTH_CONTEXT);

      expect(response.status).toBe(404);
      expect(await response.json()).toMatchObject({
        message: "Task not found",
      });
      expect(prismaTransactionMock).not.toHaveBeenCalled();
      expect(taskUpdateManyMock).not.toHaveBeenCalled();
    });

    it("lets any member add a public Task", async () => {
      taskFindFirstMock.mockImplementation(
        findFirstVisibleTask({
          visibility: TaskVisibility.PUBLIC,
          ownerId: "user_123",
        }),
      );

      const response = await postTask(OTHER_MEMBER_AUTH_CONTEXT);

      expect(response.status).toBe(200);
      expect(taskUpdateManyMock).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining(
            buildHumanTaskVisibilityWhere("user_456"),
          ),
        }),
      );
    });
  });
});
