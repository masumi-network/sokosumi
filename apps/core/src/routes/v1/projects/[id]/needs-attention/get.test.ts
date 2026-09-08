import { TaskStatus } from "@sokosumi/database";
import { SokosumiJobStatus } from "@sokosumi/utils";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { OpenAPIHonoWithAuth } from "@/lib/hono";
import type { AuthenticationContext } from "@/middleware/auth";
import type { WorkspaceVariables } from "@/middleware/workspace";

import mountGetProjectNeedsAttention from "./get";

vi.mock("@/middleware/auth", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/middleware/auth")>();
  const { stubAuthMiddleware } = await import(
    "@/test-fixtures/auth-middleware"
  );
  return { ...actual, authMiddleware: stubAuthMiddleware };
});

const { getProjectNeedsAttentionMock } = vi.hoisted(() => ({
  getProjectNeedsAttentionMock: vi.fn(),
}));

vi.mock("@/helpers/project-needs-attention", () => ({
  getProjectNeedsAttention: getProjectNeedsAttentionMock,
}));

const USER_AUTH_CONTEXT: AuthenticationContext = {
  actor: "user",
  userId: "user_123",
  organizationId: null,
  role: "user",
};

const WORKSPACE_ID = "aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa";
const PROJECT_ID = "11111111-1111-4111-8111-111111111111";

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

  mountGetProjectNeedsAttention(app);
  return app;
}

describe("GET /v1/projects/{id}/needs-attention", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns 200 with counts and ranked items", async () => {
    getProjectNeedsAttentionMock.mockResolvedValue({
      taskCount: 2,
      jobCount: 1,
      items: [
        {
          kind: "task",
          id: "task-1",
          title: "Blocked task",
          description: null,
          status: TaskStatus.INPUT_REQUIRED,
          updatedAt: "2026-09-01T00:00:00.000Z",
          archivedAt: null,
          credits: null,
          projectId: PROJECT_ID,
          coworkerId: null,
          sokoBotId: null,
          owner: null,
        },
        {
          kind: "job",
          id: "job-1",
          title: "Running job",
          description: null,
          status: SokosumiJobStatus.PROCESSING,
          updatedAt: "2026-08-01T00:00:00.000Z",
          archivedAt: null,
          credits: null,
          projectId: PROJECT_ID,
          agentId: "agent-1",
          agentName: "Agent",
          agentIcon: null,
          owner: null,
        },
      ],
    });

    const app = createApp();
    const response = await app.request(
      `http://localhost/${PROJECT_ID}/needs-attention`,
      { method: "GET" },
    );

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.data.taskCount).toBe(2);
    expect(body.data.jobCount).toBe(1);
    expect(body.data.items).toHaveLength(2);
    expect(getProjectNeedsAttentionMock).toHaveBeenCalledWith({
      workspaceId: WORKSPACE_ID,
      projectId: PROJECT_ID,
    });
  });

  it("returns 404 when the project is missing", async () => {
    getProjectNeedsAttentionMock.mockResolvedValue(null);

    const app = createApp();
    const response = await app.request(
      `http://localhost/${PROJECT_ID}/needs-attention`,
      { method: "GET" },
    );

    expect(response.status).toBe(404);
  });
});
