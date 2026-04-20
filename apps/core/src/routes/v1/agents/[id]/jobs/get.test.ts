import { OpenAPIHono } from "@hono/zod-openapi";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { OpenAPIHonoWithAuth } from "@/lib/hono";
import type { AuthVariables } from "@/middleware/auth";
import type { WorkspaceVariables } from "@/middleware/workspace";

import mountGetAgentJobs from "./get";

const { getUserJobsMock } = vi.hoisted(() => ({
  getUserJobsMock: vi.fn(),
}));

vi.mock("@/helpers/job", () => ({
  getUserJobs: getUserJobsMock,
}));

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
    c.set("workspaceContext", null);

    return await next();
  });

  mountGetAgentJobs(app as unknown as OpenAPIHonoWithAuth);
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

  it("returns 403 when workspaceContext is missing", async () => {
    const app = createApp();

    const response = await app.request("http://localhost/agent_123/jobs");

    expect(response.status).toBe(403);
    expect(getUserJobsMock).not.toHaveBeenCalled();
  });

  it("defaults to owned scope for agent job lists", async () => {
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
        workspaceId: "11111111-1111-7111-8111-111111111111",
        userId: null,
        organizationId: "org_123",
      });

      return await next();
    });

    mountGetAgentJobs(app as unknown as OpenAPIHonoWithAuth);

    const response = await app.request("http://localhost/agent_123/jobs");

    expect(response.status).toBe(200);
    expect(getUserJobsMock).toHaveBeenCalledWith(
      expect.objectContaining({
        authContext: {
          actor: "user",
          userId: "user_123",
          organizationId: "org_123",
          role: "user",
        },
      }),
      {
        agentId: "agent_123",
        scope: "owned",
        cursor: undefined,
        take: 20,
        skip: undefined,
      },
    );
  });

  it("passes scope=workspace for agent job lists", async () => {
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
        workspaceId: "11111111-1111-7111-8111-111111111111",
        userId: null,
        organizationId: "org_123",
      });

      return await next();
    });

    mountGetAgentJobs(app as unknown as OpenAPIHonoWithAuth);

    const response = await app.request(
      "http://localhost/agent_123/jobs?scope=workspace",
    );

    expect(response.status).toBe(200);
    expect(getUserJobsMock).toHaveBeenCalledWith(
      expect.any(Object),
      expect.objectContaining({
        agentId: "agent_123",
        scope: "workspace",
      }),
    );
  });
});
