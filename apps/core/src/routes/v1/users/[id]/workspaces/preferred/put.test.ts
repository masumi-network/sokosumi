import { beforeEach, describe, expect, it, vi } from "vitest";

import { forbidden, notFound } from "@/helpers/error";
import { errorHandler } from "@/helpers/error-handler.js";
import { OpenAPIHonoWithAuth } from "@/lib/hono";
import type { AuthenticationContext } from "@/middleware/auth";
import {
  applyUserRouteMiddleware,
  type UserRouteVariables,
} from "@/routes/v1/users/user-route-context";

import mountPutUserPreferredWorkspace from "./put";

vi.mock("@/middleware/auth", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/middleware/auth")>();
  const { stubAuthMiddleware } = await import(
    "@/test-fixtures/auth-middleware"
  );
  return { ...actual, authMiddleware: stubAuthMiddleware };
});

const { getUserWorkspaceMock, setPreferredWorkspaceMock, userFindUniqueMock } =
  vi.hoisted(() => ({
    getUserWorkspaceMock: vi.fn(),
    setPreferredWorkspaceMock: vi.fn(),
    userFindUniqueMock: vi.fn(),
  }));

vi.mock("@/helpers/user-workspaces", () => ({
  getUserWorkspace: getUserWorkspaceMock,
}));

vi.mock("@/services/preferred-workspace.service", () => ({
  setPreferredWorkspace: setPreferredWorkspaceMock,
}));

vi.mock("@/lib/db/prisma", () => ({
  default: {
    user: { findUnique: userFindUniqueMock },
  },
}));

const SESSION_USER: AuthenticationContext = {
  actor: "user",
  userId: "user_123",
  organizationId: null,
  role: "user",
};

const WORKSPACE_ID = "11111111-1111-7111-8111-111111111111";

function createApp() {
  const app = new OpenAPIHonoWithAuth();
  app.onError(errorHandler);
  app.use("*", async (c, next) => {
    c.set("requestId", "req_123");
    c.set("isAuthenticated", true);
    c.set("authContext", SESSION_USER);
    return await next();
  });
  const userByIdApp = new OpenAPIHonoWithAuth<UserRouteVariables>();
  applyUserRouteMiddleware(userByIdApp);
  mountPutUserPreferredWorkspace(userByIdApp);
  app.route("/:id", userByIdApp);
  return app;
}

function put(body: unknown) {
  return createApp().request("/me/workspaces/preferred", {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("PUT /users/{id}/workspaces/preferred", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    userFindUniqueMock.mockResolvedValue({ id: "user_123" });
    setPreferredWorkspaceMock.mockResolvedValue(undefined);
  });

  it("prefers the caller's personal workspace", async () => {
    const workspace = {
      id: WORKSPACE_ID,
      kind: "personal",
      name: "Ada Lovelace",
      organizationId: null,
      slug: null,
      logo: null,
      websiteUrl: null,
      preferred: true,
    };
    getUserWorkspaceMock.mockResolvedValue(workspace);

    const response = await put({ workspaceId: WORKSPACE_ID });

    expect(response.status).toBe(200);
    expect((await response.json()).data).toEqual(workspace);
    expect(setPreferredWorkspaceMock).toHaveBeenCalledWith(
      "user_123",
      WORKSPACE_ID,
    );
  });

  it("prefers an organization workspace", async () => {
    getUserWorkspaceMock.mockResolvedValue({
      id: WORKSPACE_ID,
      kind: "organization",
      name: "Acme",
      organizationId: "org_1",
      slug: "acme-x1y2z3",
      logo: null,
      websiteUrl: null,
      preferred: true,
    });

    const response = await put({ workspaceId: WORKSPACE_ID });

    expect(response.status).toBe(200);
    expect(setPreferredWorkspaceMock).toHaveBeenCalledWith(
      "user_123",
      WORKSPACE_ID,
    );
  });

  it("returns 403 for an organization the caller is not a member of", async () => {
    setPreferredWorkspaceMock.mockRejectedValue(
      forbidden("The user is not a member of the organization"),
    );

    const response = await put({ workspaceId: WORKSPACE_ID });

    expect(response.status).toBe(403);
  });

  it("returns 404 when the workspace is not the user's", async () => {
    setPreferredWorkspaceMock.mockRejectedValue(
      notFound("Workspace not found"),
    );

    const response = await put({ workspaceId: WORKSPACE_ID });

    expect(response.status).toBe(404);
  });

  it("returns 422 for a body without a workspace id", async () => {
    const response = await put({});

    expect(response.status).toBe(422);
  });
});
