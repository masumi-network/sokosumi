import { OpenAPIHono } from "@hono/zod-openapi";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { OpenAPIHonoWithAuth } from "@/lib/hono";
import type { AuthenticationContext, AuthVariables } from "@/middleware/auth";
import type { WorkspaceVariables } from "@/middleware/workspace";

import mountPostProject from "./post.js";

const { projectCreateMock } = vi.hoisted(() => ({
  projectCreateMock: vi.fn(),
}));

vi.mock("@/lib/db/prisma", () => ({
  default: {
    project: {
      create: projectCreateMock,
    },
  },
}));

const USER_AUTH_CONTEXT: AuthenticationContext = {
  actor: "user",
  userId: "user_123",
  organizationId: null,
  role: "user",
};

const WORKSPACE_CONTEXT = {
  workspaceId: "aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa",
  userId: "user_123",
  organizationId: null,
} satisfies WorkspaceVariables["workspaceContext"];

function createApp() {
  const app = new OpenAPIHono<{
    Variables: AuthVariables & WorkspaceVariables & { requestId: string };
  }>();

  app.use("*", async (c, next) => {
    c.set("requestId", "req_123");
    c.set("isAuthenticated", true);
    c.set("authContext", USER_AUTH_CONTEXT);
    c.set("workspaceContext", WORKSPACE_CONTEXT);

    return await next();
  });

  mountPostProject(app as unknown as OpenAPIHonoWithAuth);
  return app;
}

describe("POST /projects", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("creates a project and returns it", async () => {
    projectCreateMock.mockResolvedValue({
      id: "33333333-3333-4333-8333-333333333333",
      workspaceId: WORKSPACE_CONTEXT.workspaceId,
      name: "Alpha",
      description: null,
      createdAt: new Date("2026-04-02T12:00:00.000Z"),
      updatedAt: new Date("2026-04-02T12:00:00.000Z"),
    });

    const app = createApp();
    const res = await app.request("http://localhost/", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "Alpha" }),
    });

    expect(res.status).toBe(201);
    const body = (await res.json()) as { data: { id: string; name: string } };
    expect(body.data.id).toBe("33333333-3333-4333-8333-333333333333");
    expect(body.data.name).toBe("Alpha");
    expect(projectCreateMock).toHaveBeenCalledWith({
      data: {
        workspaceId: WORKSPACE_CONTEXT.workspaceId,
        name: "Alpha",
        description: null,
      },
    });
  });
});
