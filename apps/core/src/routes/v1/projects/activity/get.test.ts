import { beforeEach, describe, expect, it, vi } from "vitest";

import { OpenAPIHonoWithAuth } from "@/lib/hono";
import type { AuthenticationContext } from "@/middleware/auth";
import type { WorkspaceVariables } from "@/middleware/workspace";

import mountGetProjectActivity from "./get";

vi.mock("@/middleware/auth", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/middleware/auth")>();
  const { stubAuthMiddleware } = await import(
    "@/test-fixtures/auth-middleware"
  );
  return { ...actual, authMiddleware: stubAuthMiddleware };
});

const { queryRawMock, projectFindManyMock, agentFindManyMock } = vi.hoisted(
  () => ({
    queryRawMock: vi.fn(),
    projectFindManyMock: vi.fn(),
    agentFindManyMock: vi.fn(),
  }),
);

vi.mock("@/lib/db/prisma", () => ({
  default: {
    $queryRaw: queryRawMock,
    project: { findMany: projectFindManyMock },
    agent: { findMany: agentFindManyMock },
  },
}));

const WORKSPACE_ID = "aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa";
const PROJECT_ID = "11111111-1111-4111-8111-111111111111";
const GONE_PROJECT_ID = "22222222-2222-4222-8222-222222222222";
const AT = new Date("2026-10-29T10:00:00.000Z");

function createApp() {
  const app = new OpenAPIHonoWithAuth();
  app.use("*", async (c, next) => {
    c.set("requestId", "req_123");
    c.set("isAuthenticated", true);
    c.set("authContext", {
      actor: "user",
      userId: "user_123",
      organizationId: null,
      role: "user",
    } satisfies AuthenticationContext);
    c.set("workspaceContext", {
      workspaceId: WORKSPACE_ID,
      userId: "user_123",
      organizationId: null,
    } satisfies WorkspaceVariables["workspaceContext"]);
    return await next();
  });
  mountGetProjectActivity(app);
  return app;
}

const project = {
  id: PROJECT_ID,
  name: "Launch",
  identifier: "LAU",
  logo: null,
};

describe("GET /v1/projects/activity", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    projectFindManyMock.mockResolvedValue([project]);
    agentFindManyMock.mockResolvedValue([
      { id: "agent_1", name: "Researcher", icon: null, metadataOverride: null },
    ]);
  });

  it("maps task, job and project events and drops rows without a project", async () => {
    queryRawMock.mockResolvedValue([
      {
        kind: "task",
        id: "ev_task",
        at: AT,
        projectId: PROJECT_ID,
        entityId: "task_1",
        title: "Draft the post",
        status: "COMPLETED",
        agentId: null,
      },
      {
        kind: "job",
        id: "ev_job",
        at: AT,
        projectId: PROJECT_ID,
        entityId: "job_1",
        title: null,
        status: "AWAITING_INPUT",
        agentId: "agent_1",
      },
      {
        kind: "project",
        id: "ev_project",
        at: AT,
        projectId: PROJECT_ID,
        entityId: PROJECT_ID,
        title: "Launch",
        status: "CLOSE_REQUESTED",
        agentId: null,
      },
      {
        kind: "task",
        id: "ev_gone",
        at: AT,
        projectId: GONE_PROJECT_ID,
        entityId: "task_2",
        title: "Elsewhere",
        status: null,
        agentId: null,
      },
    ]);

    const response = await createApp().request(
      "http://localhost/activity?limit=5",
    );

    expect(response.status).toBe(200);
    const body = await response.json();
    const createdAt = AT.toISOString();
    expect(body.data).toEqual([
      {
        id: "ev_task",
        createdAt,
        project,
        kind: "task",
        taskId: "task_1",
        title: "Draft the post",
        status: "COMPLETED",
      },
      {
        id: "ev_job",
        createdAt,
        project,
        kind: "job",
        jobId: "job_1",
        agentId: "agent_1",
        title: "Researcher",
        status: "AWAITING_INPUT",
      },
      {
        id: "ev_project",
        createdAt,
        project,
        kind: "project",
        event: "CLOSE_REQUESTED",
      },
    ]);
    expect(projectFindManyMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          workspaceId: WORKSPACE_ID,
          id: { in: [PROJECT_ID, GONE_PROJECT_ID] },
        },
      }),
    );
  });

  it("drops the reader's Hidden projects from every source", async () => {
    queryRawMock.mockResolvedValue([]);

    await createApp().request("http://localhost/activity");

    const [sql] = queryRawMock.mock.calls[0];
    // Tasks, jobs and project events each join project p.
    expect(
      sql.sql.match(/NOT EXISTS \(SELECT 1 FROM project_hide h/g),
    ).toHaveLength(3);
    expect(sql.values).toContain("user_123");
  });

  it("rejects a limit above 20", async () => {
    const response = await createApp().request(
      "http://localhost/activity?limit=21",
    );

    expect(response.status).toBe(422);
    expect(queryRawMock).not.toHaveBeenCalled();
  });
});
