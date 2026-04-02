import { OpenAPIHono } from "@hono/zod-openapi";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { OpenAPIHonoWithAuth } from "@/lib/hono";
import type { AuthVariables } from "@/middleware/auth";

import mountPostAgentJob from "./post";

const { createAgentJobForUserMock, flattenJobMock, resolveWorkspaceMock } =
  vi.hoisted(() => ({
    createAgentJobForUserMock: vi.fn(),
    flattenJobMock: vi.fn(),
    resolveWorkspaceMock: vi.fn(),
  }));

vi.mock("@/helpers/job", () => ({
  createAgentJobForUser: createAgentJobForUserMock,
}));

vi.mock("@sokosumi/database/helpers", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@sokosumi/database/helpers")>();

  return {
    ...actual,
    resolveWorkspaceForContext: resolveWorkspaceMock,
  };
});

vi.mock("@/types/job", () => ({
  flattenJob: flattenJobMock,
}));

describe("POST /agents/{id}/jobs", () => {
  function createApp() {
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

    mountPostAgentJob(app as unknown as OpenAPIHonoWithAuth);

    return app;
  }

  beforeEach(() => {
    vi.clearAllMocks();
    resolveWorkspaceMock.mockResolvedValue({
      id: "11111111-1111-7111-8111-111111111111",
    });
    createAgentJobForUserMock.mockResolvedValue({
      id: "job_123",
    });
    flattenJobMock.mockReturnValue({
      id: "job_123",
      createdAt: "2026-04-02T08:00:00.000Z",
      updatedAt: "2026-04-02T08:00:00.000Z",
      completedAt: null,
      agentId: "agent_123",
      userId: "user_123",
      organizationId: "org_123",
      taskId: null,
      name: null,
      jobType: "FREE",
      status: "processing",
      credits: 0,
      onChainStatus: null,
      onChainTransactionHash: null,
      result: null,
      resultHash: null,
    });
  });

  it("resolves workspace placement for standalone job creation", async () => {
    const app = createApp();

    const response = await app.request("http://localhost/agent_123/jobs", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        inputSchema: {
          input_data: [
            {
              id: "prompt",
              type: "string",
              name: "Prompt",
            },
          ],
        },
        inputData: {
          prompt: "hello",
        },
        maxCredits: 5,
      }),
    });

    expect(response.status).toBe(201);
    expect(resolveWorkspaceMock).toHaveBeenCalledWith(
      "user_123",
      "org_123",
      expect.any(Object),
    );
    expect(createAgentJobForUserMock).toHaveBeenCalledWith(
      expect.objectContaining({
        owner: {
          userId: "user_123",
          organizationId: "org_123",
          workspaceId: "11111111-1111-7111-8111-111111111111",
        },
      }),
    );
  });
});
