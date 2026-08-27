import { beforeEach, describe, expect, it, vi } from "vitest";
import { OpenAPIHonoWithAuth } from "@/lib/hono";
import { TEST_VENDOR_ID } from "@/test-fixtures/vendor.js";

import mountGetAgentJobs from "./get";

vi.mock("@/middleware/auth", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/middleware/auth")>();
  const { stubAuthMiddleware } = await import(
    "@/test-fixtures/auth-middleware"
  );
  return { ...actual, authMiddleware: stubAuthMiddleware };
});

const { getUserJobsMock } = vi.hoisted(() => ({
  getUserJobsMock: vi.fn(),
}));

vi.mock("@/helpers/job", () => ({
  getUserJobs: getUserJobsMock,
}));

function createApp() {
  const app = new OpenAPIHonoWithAuth();

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

  mountGetAgentJobs(app);
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
    const app = new OpenAPIHonoWithAuth();

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

    mountGetAgentJobs(app);

    const response = await app.request("http://localhost/agent_123/jobs");

    expect(response.status).toBe(200);
    expect(getUserJobsMock).toHaveBeenCalledWith(
      expect.objectContaining({
        userContext: {
          source: "session",
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
    const app = new OpenAPIHonoWithAuth();

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

    mountGetAgentJobs(app);

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

  it("accepts delegated coworker context when workspaceContext is resolved", async () => {
    const app = new OpenAPIHonoWithAuth();

    app.use("*", async (c, next) => {
      c.set("isAuthenticated", true);
      c.set("authContext", {
        actor: "coworker",
        coworkerId: "cow_123",
        vendorId: TEST_VENDOR_ID,
        context: {
          userId: "user_123",
          organizationId: "org_123",
        },
      });
      c.set("workspaceContext", {
        workspaceId: "11111111-1111-7111-8111-111111111111",
        userId: null,
        organizationId: "org_123",
      });

      return await next();
    });

    mountGetAgentJobs(app);

    const response = await app.request("http://localhost/agent_123/jobs");

    expect(response.status).toBe(200);
    expect(getUserJobsMock).toHaveBeenCalledWith(
      {
        userContext: {
          source: "context",
          userId: "user_123",
          organizationId: "org_123",
        },
        workspaceContext: {
          workspaceId: "11111111-1111-7111-8111-111111111111",
          userId: null,
          organizationId: "org_123",
        },
      },
      {
        agentId: "agent_123",
        scope: "owned",
        coworkerId: "cow_123",
        cursor: undefined,
        take: 20,
        skip: undefined,
      },
    );
  });
});
