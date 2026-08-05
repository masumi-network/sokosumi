import { OpenAPIHono } from "@hono/zod-openapi";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { OpenAPIHonoWithAuth } from "@/lib/hono";
import type { AuthVariables } from "@/middleware/auth";
import type { WorkspaceVariables } from "@/middleware/workspace";
import { TEST_VENDOR_ID } from "@/test-fixtures/vendor.js";

import mountGetJobs from "./get";

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

  mountGetJobs(app as unknown as OpenAPIHonoWithAuth);
  return app;
}

describe("GET /jobs", () => {
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

    const response = await app.request("http://localhost/");

    expect(response.status).toBe(403);
    expect(getUserJobsMock).not.toHaveBeenCalled();
  });

  it("defaults to owned scope when the query parameter is omitted", async () => {
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

    mountGetJobs(app as unknown as OpenAPIHonoWithAuth);

    const response = await app.request("http://localhost/?status=COMPLETED");

    expect(response.status).toBe(200);
    expect(getUserJobsMock).toHaveBeenCalledWith(
      {
        userContext: {
          source: "session",
          actor: "user",
          userId: "user_123",
          organizationId: "org_123",
          role: "user",
        },
        workspaceContext: {
          workspaceId: "11111111-1111-7111-8111-111111111111",
          userId: null,
          organizationId: "org_123",
        },
      },
      {
        agentId: undefined,
        projectId: undefined,
        status: "COMPLETED",
        scope: "owned",
        cursor: undefined,
        take: 20,
        skip: undefined,
      },
    );
  });

  it("passes scope=workspace through to the job helper", async () => {
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

    mountGetJobs(app as unknown as OpenAPIHonoWithAuth);

    const response = await app.request("http://localhost/?scope=workspace");

    expect(response.status).toBe(200);
    expect(getUserJobsMock).toHaveBeenCalledWith(
      expect.any(Object),
      expect.objectContaining({
        scope: "workspace",
      }),
    );
  });

  it("accepts delegated coworker context when workspaceContext is resolved", async () => {
    const app = new OpenAPIHono<{
      Variables: AuthVariables & WorkspaceVariables;
    }>();

    app.use("*", async (c, next) => {
      c.set("isAuthenticated", true);
      c.set("authContext", {
        actor: "coworker",
        coworkerId: "cow_123",
        vendorId: TEST_VENDOR_ID,
        isDelegationApproved: true,
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

    mountGetJobs(app as unknown as OpenAPIHonoWithAuth);

    const response = await app.request("http://localhost/");

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
        agentId: undefined,
        projectId: undefined,
        status: undefined,
        scope: "owned",
        coworkerId: "cow_123",
        cursor: undefined,
        take: 20,
        skip: undefined,
      },
    );
  });

  it("passes projectId through to the job helper", async () => {
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

    mountGetJobs(app as unknown as OpenAPIHonoWithAuth);

    const projectId = "33333333-3333-4333-8333-333333333333";
    const response = await app.request(
      `http://localhost/?projectId=${projectId}`,
    );

    expect(response.status).toBe(200);
    expect(getUserJobsMock).toHaveBeenCalledWith(
      expect.any(Object),
      expect.objectContaining({
        projectId,
      }),
    );
  });

  it("passes projectId=null through to the job helper", async () => {
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

    mountGetJobs(app as unknown as OpenAPIHonoWithAuth);

    const response = await app.request("http://localhost/?projectId=null");

    expect(response.status).toBe(200);
    expect(getUserJobsMock).toHaveBeenCalledWith(
      expect.any(Object),
      expect.objectContaining({
        projectId: null,
      }),
    );
  });
});
