import { OpenAPIHono } from "@hono/zod-openapi";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { OpenAPIHonoWithAuth } from "@/lib/hono";
import type { AuthenticationContext, AuthVariables } from "@/middleware/auth";
import type { WorkspaceVariables } from "@/middleware/workspace";

import mountListProjects from "./get.js";

const { listProjectsByWorkspaceMock } = vi.hoisted(() => ({
  listProjectsByWorkspaceMock: vi.fn(),
}));

vi.mock("@/lib/repository", () => ({
  listProjectsByWorkspace: listProjectsByWorkspaceMock,
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

function createApp(
  authContext: AuthenticationContext = USER_AUTH_CONTEXT,
  workspaceContext:
    | WorkspaceVariables["workspaceContext"]
    | null = WORKSPACE_CONTEXT,
) {
  const app = new OpenAPIHono<{
    Variables: AuthVariables & WorkspaceVariables & { requestId: string };
  }>();

  app.use("*", async (c, next) => {
    c.set("requestId", "req_123");
    c.set("isAuthenticated", true);
    c.set("authContext", authContext);
    c.set("workspaceContext", workspaceContext);

    return await next();
  });

  mountListProjects(app as unknown as OpenAPIHonoWithAuth);
  return app;
}

describe("GET /projects", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    listProjectsByWorkspaceMock.mockResolvedValue([]);
  });

  it("returns projects for the active workspace", async () => {
    listProjectsByWorkspaceMock.mockResolvedValue([
      {
        id: "11111111-1111-4111-8111-111111111111",
        workspaceId: WORKSPACE_CONTEXT.workspaceId,
        name: "Research",
        description: "Notes",
        createdAt: new Date("2026-04-01T10:00:00.000Z"),
        updatedAt: new Date("2026-04-01T10:00:00.000Z"),
        jobs: [{ id: "job_a" }],
        tasks: [],
      },
    ]);

    const app = createApp();
    const res = await app.request("http://localhost/");

    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      data: Array<{ id: string; jobIds: string[] }>;
    };
    expect(body.data).toHaveLength(1);
    expect(body.data[0]?.id).toBe("11111111-1111-4111-8111-111111111111");
    expect(body.data[0]?.jobIds).toEqual(["job_a"]);
    expect(listProjectsByWorkspaceMock).toHaveBeenCalledWith(
      WORKSPACE_CONTEXT.workspaceId,
      expect.anything(),
    );
  });

  it("returns 403 when workspace context is missing", async () => {
    const app = createApp(USER_AUTH_CONTEXT, null);
    const res = await app.request("http://localhost/");
    expect(res.status).toBe(403);
  });

  it("returns 403 for coworker without delegation", async () => {
    const app = createApp({ actor: "coworker", coworkerId: "cow_1" }, null);
    const res = await app.request("http://localhost/");
    expect(res.status).toBe(403);
  });
});
