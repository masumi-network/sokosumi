import { OpenAPIHono } from "@hono/zod-openapi";
import { HTTPException } from "hono/http-exception";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { OpenAPIHonoWithAuth } from "@/lib/hono";
import type { AuthenticationContext, AuthVariables } from "@/middleware/auth";
import type { WorkspaceVariables } from "@/middleware/workspace";
import {
  type UserRouteVariables,
  usersPathUserContextMiddleware,
} from "@/routes/v1/users/user-route-context";

import mountGetUserTasksCount from "./get";

const { requireCoworkerCapabilityMock, taskCountMock, userFindUniqueMock } =
  vi.hoisted(() => ({
    requireCoworkerCapabilityMock: vi.fn(),
    taskCountMock: vi.fn(),
    userFindUniqueMock: vi.fn(),
  }));

vi.mock("@/helpers/access-control", () => ({
  requireCoworkerCapability: requireCoworkerCapabilityMock,
}));

vi.mock("@/lib/db/prisma", () => ({
  default: {
    task: {
      count: taskCountMock,
    },
    user: {
      findUnique: userFindUniqueMock,
    },
  },
}));

const USER_AUTH_CONTEXT: AuthenticationContext = {
  actor: "user",
  userId: "user_123",
  organizationId: "org_123",
  role: "user",
};

const DELEGATED_COWORKER_AUTH_CONTEXT: AuthenticationContext = {
  actor: "coworker",
  coworkerId: "cow_123",
  delegation: {
    userId: "user_123",
    organizationId: "org_123",
  },
};

const USER_WORKSPACE_CONTEXT = {
  workspaceId: "11111111-1111-7111-8111-111111111111",
  userId: null,
  organizationId: "org_123",
} satisfies WorkspaceVariables["workspaceContext"];

function createApp(
  authContext: AuthenticationContext = USER_AUTH_CONTEXT,
  workspaceContext: WorkspaceVariables["workspaceContext"] = USER_WORKSPACE_CONTEXT,
) {
  const app = new OpenAPIHono<{
    Variables: AuthVariables & WorkspaceVariables & UserRouteVariables;
  }>();

  app.use("*", async (c, next) => {
    c.set("isAuthenticated", true);
    c.set("authContext", authContext);
    c.set("workspaceContext", workspaceContext);
    return await next();
  });

  const userByIdApp = new OpenAPIHono<{
    Variables: AuthVariables & WorkspaceVariables & UserRouteVariables;
  }>();
  userByIdApp.use("*", usersPathUserContextMiddleware);
  mountGetUserTasksCount(
    userByIdApp as unknown as OpenAPIHonoWithAuth<UserRouteVariables>,
  );
  app.route("/:id", userByIdApp);
  return app;
}

describe("GET /users/{id}/tasks/count", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    requireCoworkerCapabilityMock.mockResolvedValue(undefined);
    taskCountMock.mockResolvedValue(3);
    userFindUniqueMock.mockResolvedValue({ id: "user_123" });
  });

  it("counts non-archived tasks in the active workspace for session users", async () => {
    const app = createApp();
    const response = await app.request("http://localhost/me/count");

    expect(response.status).toBe(200);
    expect(taskCountMock).toHaveBeenCalledWith({
      where: {
        archivedAt: null,
        workspaceId: "11111111-1111-7111-8111-111111111111",
        userId: "user_123",
      },
    });

    const body = (await response.json()) as { data: { count: number } };
    expect(body.data.count).toBe(3);
  });

  it("returns forbidden when workspace context is missing for session users", async () => {
    const app = createApp(USER_AUTH_CONTEXT, null);
    const response = await app.request("http://localhost/me/count");

    expect(response.status).toBe(403);
    expect(taskCountMock).not.toHaveBeenCalled();
  });

  it("counts non-archived tasks across all workspaces when scope=all", async () => {
    const app = createApp(USER_AUTH_CONTEXT, null);
    const response = await app.request("http://localhost/me/count?scope=all");

    expect(response.status).toBe(200);
    expect(taskCountMock).toHaveBeenCalledWith({
      where: {
        archivedAt: null,
        userId: "user_123",
      },
    });

    const body = (await response.json()) as { data: { count: number } };
    expect(body.data.count).toBe(3);
  });

  it("rejects coworker requests when tasks capability is unavailable", async () => {
    requireCoworkerCapabilityMock.mockRejectedValue(
      new HTTPException(403, {
        message: "Coworker is not allowed to use tasks",
      }),
    );

    const app = createApp(
      DELEGATED_COWORKER_AUTH_CONTEXT,
      USER_WORKSPACE_CONTEXT,
    );
    const response = await app.request("http://localhost/user_123/count");

    expect(response.status).toBe(403);
    expect(taskCountMock).not.toHaveBeenCalled();
  });

  it("counts delegated coworker tasks only in the active workspace", async () => {
    const app = createApp(
      DELEGATED_COWORKER_AUTH_CONTEXT,
      USER_WORKSPACE_CONTEXT,
    );
    const response = await app.request("http://localhost/user_123/count");

    expect(response.status).toBe(200);
    expect(taskCountMock).toHaveBeenCalledWith({
      where: {
        archivedAt: null,
        workspaceId: "11111111-1111-7111-8111-111111111111",
        userId: "user_123",
      },
    });
  });

  it("rejects scope=all for delegated coworker API keys", async () => {
    const app = createApp(
      DELEGATED_COWORKER_AUTH_CONTEXT,
      USER_WORKSPACE_CONTEXT,
    );
    const response = await app.request(
      "http://localhost/user_123/count?scope=all",
    );

    expect(response.status).toBe(403);
    expect(taskCountMock).not.toHaveBeenCalled();
  });
});
