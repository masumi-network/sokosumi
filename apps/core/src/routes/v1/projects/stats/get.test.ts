import { AgentJobStatus, JobType, TaskStatus } from "@sokosumi/database";
import { SokosumiJobStatus } from "@sokosumi/utils";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { OpenAPIHonoWithAuth } from "@/lib/hono";
import type { AuthenticationContext } from "@/middleware/auth";
import type { WorkspaceVariables } from "@/middleware/workspace";

import mountGetProjectStats from "./get";

vi.mock("@/middleware/auth", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/middleware/auth")>();
  const { stubAuthMiddleware } = await import(
    "@/test-fixtures/auth-middleware"
  );
  return { ...actual, authMiddleware: stubAuthMiddleware };
});

const { jobFindManyMock, projectFindManyMock, taskGroupByMock } = vi.hoisted(
  () => ({
    jobFindManyMock: vi.fn(),
    projectFindManyMock: vi.fn(),
    taskGroupByMock: vi.fn(),
  }),
);

vi.mock("@/lib/db/prisma", () => ({
  default: {
    project: {
      findMany: projectFindManyMock,
    },
    task: {
      groupBy: taskGroupByMock,
    },
    job: {
      findMany: jobFindManyMock,
    },
  },
}));

const USER_AUTH_CONTEXT: AuthenticationContext = {
  actor: "user",
  userId: "user_123",
  organizationId: null,
  role: "user",
};

const WORKSPACE_ID = "aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa";
const PROJECT_A_ID = "11111111-1111-4111-8111-111111111111";
const PROJECT_B_ID = "22222222-2222-4222-8222-222222222222";
const UNKNOWN_PROJECT_ID = "33333333-3333-4333-8333-333333333333";

const WORKSPACE_CONTEXT = {
  workspaceId: WORKSPACE_ID,
  userId: "user_123",
  organizationId: null,
} satisfies WorkspaceVariables["workspaceContext"];

function createApp(
  authContext: AuthenticationContext = USER_AUTH_CONTEXT,
  workspaceContext:
    | WorkspaceVariables["workspaceContext"]
    | null = WORKSPACE_CONTEXT,
) {
  const app = new OpenAPIHonoWithAuth();

  app.use("*", async (c, next) => {
    c.set("requestId", "req_123");
    c.set("isAuthenticated", true);
    c.set("authContext", authContext);
    c.set("workspaceContext", workspaceContext);

    return await next();
  });

  mountGetProjectStats(app);
  return app;
}

function createFreeJob(projectId: string, status: AgentJobStatus) {
  return {
    id: `job_${projectId}_${status}`,
    projectId,
    jobType: JobType.FREE,
    events: [
      {
        status,
        input: {},
      },
    ],
  };
}

describe("GET /projects/stats", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    projectFindManyMock.mockResolvedValue([]);
    taskGroupByMock.mockResolvedValue([]);
    jobFindManyMock.mockResolvedValue([]);
  });

  it("returns stats for all projects in the active workspace when no IDs are provided", async () => {
    projectFindManyMock.mockResolvedValue([
      { id: PROJECT_A_ID },
      { id: PROJECT_B_ID },
    ]);
    taskGroupByMock.mockResolvedValue([
      {
        projectId: PROJECT_A_ID,
        status: TaskStatus.READY,
        _count: { _all: 2 },
      },
    ]);
    jobFindManyMock.mockResolvedValue([
      createFreeJob(PROJECT_B_ID, AgentJobStatus.COMPLETED),
    ]);

    const app = createApp();
    const response = await app.request("http://localhost/stats");

    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      data: {
        projects: Array<{
          projectId: string;
          tasks: { total: number };
          jobs: { total: number; byStatus: Array<{ status: string }> };
        }>;
      };
    };
    expect(body.data.projects).toEqual([
      {
        projectId: PROJECT_A_ID,
        tasks: {
          total: 2,
          byStatus: [{ status: TaskStatus.READY, count: 2 }],
        },
        jobs: { total: 0, byStatus: [] },
      },
      {
        projectId: PROJECT_B_ID,
        tasks: { total: 0, byStatus: [] },
        jobs: {
          total: 1,
          byStatus: [{ status: SokosumiJobStatus.COMPLETED, count: 1 }],
        },
      },
    ]);
    expect(projectFindManyMock).toHaveBeenCalledWith({
      where: { workspaceId: WORKSPACE_ID },
      select: { id: true },
      orderBy: [{ updatedAt: "desc" }, { id: "desc" }],
    });
  });

  it("filters by requested projectIds and ignores unknown workspace projects", async () => {
    projectFindManyMock.mockResolvedValue([{ id: PROJECT_A_ID }]);

    const app = createApp();
    const response = await app.request(
      `http://localhost/stats?projectIds=${PROJECT_A_ID},${UNKNOWN_PROJECT_ID}`,
    );

    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      data: { projects: Array<{ projectId: string }> };
    };
    expect(body.data.projects).toEqual([
      {
        projectId: PROJECT_A_ID,
        tasks: { total: 0, byStatus: [] },
        jobs: { total: 0, byStatus: [] },
      },
    ]);
    expect(projectFindManyMock).toHaveBeenCalledWith({
      where: {
        workspaceId: WORKSPACE_ID,
        id: { in: [PROJECT_A_ID, UNKNOWN_PROJECT_ID] },
      },
      select: { id: true },
      orderBy: [{ updatedAt: "desc" }, { id: "desc" }],
    });
    expect(taskGroupByMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          workspaceId: WORKSPACE_ID,
          projectId: { in: [PROJECT_A_ID] },
        }),
      }),
    );
  });

  it("returns 403 when workspace context is missing", async () => {
    const app = createApp(USER_AUTH_CONTEXT, null);
    const response = await app.request("http://localhost/stats");

    expect(response.status).toBe(403);
    expect(projectFindManyMock).not.toHaveBeenCalled();
  });
});
