import { OpenAPIHono } from "@hono/zod-openapi";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { OpenAPIHonoWithAuth } from "@/lib/hono";
import type { AuthVariables } from "@/middleware/auth";

import mountGetJobsByAgentId from "./get";

const { getUserJobsMock } = vi.hoisted(() => ({
  getUserJobsMock: vi.fn(),
}));

vi.mock("@/helpers/job", () => ({
  getUserJobs: (...args: unknown[]) => getUserJobsMock(...args),
}));

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
    c.set("workspaceContext", {
      workspaceId: "workspace_123",
      userId: null,
      organizationId: "org_123",
    });

    return await next();
  });

  mountGetJobsByAgentId(app as unknown as OpenAPIHonoWithAuth);
  return app;
}

describe("GET /agents/{id}/jobs", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getUserJobsMock.mockResolvedValue({
      jobs: [],
      count: 0,
      hasMore: false,
    });
  });

  it("passes middleware-resolved workspaceContext to getUserJobs", async () => {
    const app = createApp();

    const response = await app.request("http://localhost/agent_123/jobs");

    expect(response.status).toBe(200);
    expect(getUserJobsMock).toHaveBeenCalledWith(
      {
        actor: "user",
        userId: "user_123",
        organizationId: "org_123",
      },
      expect.objectContaining({
        workspaceContext: {
          workspaceId: "workspace_123",
          userId: null,
          organizationId: "org_123",
        },
        agentId: "agent_123",
      }),
    );
  });
});
