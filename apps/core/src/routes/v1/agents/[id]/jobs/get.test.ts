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
  });

  it("returns 404 when workspaceContext is missing", async () => {
    const app = createApp();

    const response = await app.request("http://localhost/agent_123/jobs");

    expect(response.status).toBe(404);
    expect(getUserJobsMock).not.toHaveBeenCalled();
  });
});
