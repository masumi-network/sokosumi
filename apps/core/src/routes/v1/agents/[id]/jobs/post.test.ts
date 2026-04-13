import { OpenAPIHono } from "@hono/zod-openapi";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { OpenAPIHonoWithAuth } from "@/lib/hono";
import type { AuthWithWorkspaceEnv } from "@/middleware/workspace-context";

import mountPostAgentJob from "./post";

const { createAgentJobForUserMock, flattenJobMock } = vi.hoisted(() => ({
  createAgentJobForUserMock: vi.fn(),
  flattenJobMock: vi.fn(),
}));

vi.mock("@/helpers/job", () => ({
  createAgentJobForUser: createAgentJobForUserMock,
}));

vi.mock("@/types/job", () => ({
  flattenJob: flattenJobMock,
}));

describe("POST /agents/{id}/jobs", () => {
  function createApp(
    workspaceContext: AuthWithWorkspaceEnv["Variables"]["workspaceContext"] = {
      workspaceId: "11111111-1111-7111-8111-111111111111",
      userId: null,
      organizationId: "org_123",
    },
  ) {
    const app = new OpenAPIHono<AuthWithWorkspaceEnv>();

    app.use("*", async (c, next) => {
      c.set("isAuthenticated", true);
      c.set("authContext", {
        actor: "user",
        userId: "user_123",
        organizationId: "org_123",
      });
      c.set("workspaceContext", workspaceContext);

      return await next();
    });

    mountPostAgentJob(app as unknown as OpenAPIHonoWithAuth);

    return app;
  }

  beforeEach(() => {
    vi.clearAllMocks();
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
      workspace: {
        id: "11111111-1111-7111-8111-111111111111",
        organizationId: "org_123",
        organization: {
          id: "org_123",
          name: "Acme Labs",
          slug: "acme-labs",
        },
      },
    });
  });

  it("uses workspaceContext for standalone job creation", async () => {
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

  it("returns 404 when no active workspaceContext is available", async () => {
    const app = createApp(null);

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

    expect(response.status).toBe(404);
    expect(createAgentJobForUserMock).not.toHaveBeenCalled();
  });
});
