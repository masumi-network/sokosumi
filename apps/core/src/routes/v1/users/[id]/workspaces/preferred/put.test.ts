import { beforeEach, describe, expect, it, vi } from "vitest";

import { forbidden } from "@/helpers/error";
import { errorHandler } from "@/helpers/error-handler.js";
import { OpenAPIHonoWithAuth } from "@/lib/hono";
import type { AuthenticationContext } from "@/middleware/auth";
import {
  type UserRouteVariables,
  usersPathUserContextMiddleware,
} from "@/routes/v1/users/user-route-context";

import mountPutUserPreferredWorkspace from "./put";

vi.mock("@/middleware/auth", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/middleware/auth")>();
  const { stubAuthMiddleware } = await import(
    "@/test-fixtures/auth-middleware"
  );
  return { ...actual, authMiddleware: stubAuthMiddleware };
});

const {
  getUserWorkspaceMock,
  setPreferredOrganizationIdMock,
  userFindUniqueMock,
  workspaceFindUniqueMock,
} = vi.hoisted(() => ({
  getUserWorkspaceMock: vi.fn(),
  setPreferredOrganizationIdMock: vi.fn(),
  userFindUniqueMock: vi.fn(),
  workspaceFindUniqueMock: vi.fn(),
}));

vi.mock("@/helpers/user-workspaces", () => ({
  getUserWorkspace: getUserWorkspaceMock,
}));

vi.mock("@/services/preferred-organization.service", () => ({
  setPreferredOrganizationId: setPreferredOrganizationIdMock,
}));

vi.mock("@/lib/db/prisma", () => ({
  default: {
    user: { findUnique: userFindUniqueMock },
    workspace: { findUnique: workspaceFindUniqueMock },
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
  userByIdApp.use("*", usersPathUserContextMiddleware);
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
  });

  it("prefers the caller's personal workspace", async () => {
    workspaceFindUniqueMock.mockResolvedValue({
      userId: "user_123",
      organizationId: null,
    });
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
    expect(setPreferredOrganizationIdMock).toHaveBeenCalledWith(
      "user_123",
      null,
    );
  });

  it("prefers an organization workspace", async () => {
    workspaceFindUniqueMock.mockResolvedValue({
      userId: null,
      organizationId: "org_1",
    });
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
    expect(setPreferredOrganizationIdMock).toHaveBeenCalledWith(
      "user_123",
      "org_1",
    );
  });

  it("returns 403 for an organization the caller is not a member of", async () => {
    workspaceFindUniqueMock.mockResolvedValue({
      userId: null,
      organizationId: "org_1",
    });
    setPreferredOrganizationIdMock.mockRejectedValue(
      forbidden("The user is not a member of the organization"),
    );

    const response = await put({ workspaceId: WORKSPACE_ID });

    expect(response.status).toBe(403);
  });

  it.each([
    ["an unknown workspace", null],
    [
      "another user's personal workspace",
      { userId: "user_456", organizationId: null },
    ],
  ])("returns 404 for %s", async (_label, workspace) => {
    workspaceFindUniqueMock.mockResolvedValue(workspace);

    const response = await put({ workspaceId: WORKSPACE_ID });

    expect(response.status).toBe(404);
    expect(setPreferredOrganizationIdMock).not.toHaveBeenCalled();
  });

  it("returns 422 for a body without a workspace id", async () => {
    const response = await put({});

    expect(response.status).toBe(422);
  });
});
