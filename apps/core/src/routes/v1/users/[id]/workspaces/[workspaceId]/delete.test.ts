import { beforeEach, describe, expect, it, vi } from "vitest";

import { conflict, notFound } from "@/helpers/error";
import { errorHandler } from "@/helpers/error-handler.js";
import { OpenAPIHonoWithAuth } from "@/lib/hono";
import type { AuthenticationContext } from "@/middleware/auth";
import {
  type UserRouteVariables,
  usersPathUserContextMiddleware,
} from "@/routes/v1/users/user-route-context";

import mountDeleteUserWorkspace from "./delete";

vi.mock("@/middleware/auth", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/middleware/auth")>();
  const { stubAuthMiddleware } = await import(
    "@/test-fixtures/auth-middleware"
  );
  return { ...actual, authMiddleware: stubAuthMiddleware };
});

const {
  deletePersonalWorkspaceMock,
  getUserWorkspaceMock,
  userFindUniqueMock,
} = vi.hoisted(() => ({
  deletePersonalWorkspaceMock: vi.fn(),
  getUserWorkspaceMock: vi.fn(),
  userFindUniqueMock: vi.fn(),
}));

vi.mock("@/helpers/personal-workspace", () => ({
  deletePersonalWorkspace: deletePersonalWorkspaceMock,
}));

vi.mock("@/helpers/user-workspaces", () => ({
  getUserWorkspace: getUserWorkspaceMock,
}));

vi.mock("@/lib/db/prisma", () => ({
  default: { user: { findUnique: userFindUniqueMock } },
}));

const SESSION_USER: AuthenticationContext = {
  actor: "user",
  userId: "user_123",
  organizationId: null,
  role: "user",
};

const PERSONAL_WORKSPACE_ID = "11111111-1111-7111-8111-111111111111";
const ORG_WORKSPACE_ID = "22222222-2222-7222-8222-222222222222";

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
  mountDeleteUserWorkspace(userByIdApp);
  app.route("/:id", userByIdApp);
  return app;
}

function deleteWorkspace(pathId: string, workspaceId: string) {
  return createApp().request(`/${pathId}/workspaces/${workspaceId}`, {
    method: "DELETE",
  });
}

describe("DELETE /users/{id}/workspaces/{workspaceId}", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    userFindUniqueMock.mockResolvedValue({ id: "user_123" });
  });

  it("returns 403 when the caller may not access the target user", async () => {
    const response = await deleteWorkspace("other_user", PERSONAL_WORKSPACE_ID);

    expect(response.status).toBe(403);
    expect(deletePersonalWorkspaceMock).not.toHaveBeenCalled();
  });

  it("returns 404 for a workspace the user cannot act in", async () => {
    getUserWorkspaceMock.mockRejectedValue(notFound("Workspace not found"));

    const response = await deleteWorkspace("me", PERSONAL_WORKSPACE_ID);

    expect(response.status).toBe(404);
    expect(getUserWorkspaceMock).toHaveBeenCalledWith("user_123", {
      id: PERSONAL_WORKSPACE_ID,
    });
    expect(deletePersonalWorkspaceMock).not.toHaveBeenCalled();
  });

  it("refuses an organization workspace", async () => {
    getUserWorkspaceMock.mockResolvedValue({
      id: ORG_WORKSPACE_ID,
      kind: "organization",
    });

    const response = await deleteWorkspace("me", ORG_WORKSPACE_ID);

    expect(response.status).toBe(409);
    const body = await response.json();
    expect(body.message).toBe("Only a personal workspace can be deleted here");
    expect(deletePersonalWorkspaceMock).not.toHaveBeenCalled();
  });

  it("deletes the user's personal workspace", async () => {
    getUserWorkspaceMock.mockResolvedValue({
      id: PERSONAL_WORKSPACE_ID,
      kind: "personal",
    });
    deletePersonalWorkspaceMock.mockResolvedValue({
      id: PERSONAL_WORKSPACE_ID,
    });

    const response = await deleteWorkspace("me", PERSONAL_WORKSPACE_ID);

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.data).toEqual({ workspaceId: PERSONAL_WORKSPACE_ID });
    expect(deletePersonalWorkspaceMock).toHaveBeenCalledWith("user_123");
  });

  it("passes on the personal workspace rules, such as the last workspace", async () => {
    getUserWorkspaceMock.mockResolvedValue({
      id: PERSONAL_WORKSPACE_ID,
      kind: "personal",
    });
    deletePersonalWorkspaceMock.mockRejectedValue(
      conflict("Cannot delete the user's last workspace", {
        kind: "last_workspace",
      }),
    );

    const response = await deleteWorkspace("me", PERSONAL_WORKSPACE_ID);

    expect(response.status).toBe(409);
    const body = await response.json();
    expect(body.kind).toBe("last_workspace");
  });

  it("rejects a workspace id that is not a uuid", async () => {
    const response = await deleteWorkspace("me", "not-a-uuid");

    expect(response.status).toBe(422);
    expect(getUserWorkspaceMock).not.toHaveBeenCalled();
  });
});
