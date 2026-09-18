import { beforeEach, describe, expect, it, vi } from "vitest";

import { errorHandler } from "@/helpers/error-handler.js";
import { OpenAPIHonoWithAuth } from "@/lib/hono";
import type { AuthenticationContext } from "@/middleware/auth";
import {
  type UserRouteVariables,
  usersPathUserContextMiddleware,
} from "@/routes/v1/users/user-route-context";

import mountDeleteUserPersonalWorkspace from "./delete";

vi.mock("@/middleware/auth", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/middleware/auth")>();
  const { stubAuthMiddleware } = await import(
    "@/test-fixtures/auth-middleware"
  );
  return { ...actual, authMiddleware: stubAuthMiddleware };
});

const {
  isLastWorkspaceMock,
  transactionMock,
  userFindUniqueMock,
  workspaceFindUniqueMock,
  workspaceDeleteMock,
} = vi.hoisted(() => ({
  isLastWorkspaceMock: vi.fn(),
  transactionMock: vi.fn(),
  userFindUniqueMock: vi.fn(),
  workspaceFindUniqueMock: vi.fn(),
  workspaceDeleteMock: vi.fn(),
}));

vi.mock("@/helpers/workspace-access", () => ({
  isLastWorkspace: (...args: unknown[]) => isLastWorkspaceMock(...args),
}));

vi.mock("@/lib/db/prisma", () => ({
  default: {
    $transaction: transactionMock,
    user: {
      findUnique: userFindUniqueMock,
    },
  },
}));

const SESSION_USER: AuthenticationContext = {
  actor: "user",
  userId: "user_123",
  organizationId: null,
  role: "user",
};

const TX = {
  workspace: {
    findUnique: workspaceFindUniqueMock,
    delete: workspaceDeleteMock,
  },
  user: {
    findUnique: vi.fn().mockResolvedValue({ preferredOrganizationId: "org_1" }),
    update: vi.fn(),
  },
  member: {
    findFirst: vi.fn(),
  },
};

function createApp(authContext: AuthenticationContext = SESSION_USER) {
  const app = new OpenAPIHonoWithAuth();

  app.onError(errorHandler);

  app.use("*", async (c, next) => {
    c.set("requestId", "req_123");
    c.set("isAuthenticated", true);
    c.set("authContext", authContext);
    return await next();
  });

  const userByIdApp = new OpenAPIHonoWithAuth<UserRouteVariables>();
  userByIdApp.use("*", usersPathUserContextMiddleware);
  mountDeleteUserPersonalWorkspace(userByIdApp);
  app.route("/:id", userByIdApp);
  return app;
}

function deletePersonalWorkspace(
  app: ReturnType<typeof createApp>,
  pathId: string,
) {
  return app.request(`http://localhost/${pathId}/personal-workspace`, {
    method: "DELETE",
  });
}

describe("DELETE /users/{id}/personal-workspace", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    userFindUniqueMock.mockResolvedValue({ id: "user_123" });
    TX.user.findUnique.mockResolvedValue({ preferredOrganizationId: "org_1" });
    TX.user.update.mockResolvedValue({ id: "user_123" });
    TX.member.findFirst.mockResolvedValue({ organizationId: "org_1" });
    transactionMock.mockImplementation(async (callback) => {
      return await callback(TX);
    });
  });

  it("returns 403 when the caller may not access the target user", async () => {
    const response = await deletePersonalWorkspace(createApp(), "other_user");
    expect(response.status).toBe(403);
    expect(transactionMock).not.toHaveBeenCalled();
  });

  it("returns 404 when the personal workspace is missing", async () => {
    workspaceFindUniqueMock.mockResolvedValueOnce(null);

    const response = await deletePersonalWorkspace(createApp(), "me");
    expect(response.status).toBe(404);
    const body = await response.json();
    expect(body.kind).toBe("personal_workspace_missing");
    expect(workspaceDeleteMock).not.toHaveBeenCalled();
  });

  it("returns 409 when the personal workspace is the last workspace", async () => {
    workspaceFindUniqueMock.mockResolvedValueOnce({
      id: "11111111-1111-7111-8111-111111111111",
      userId: "user_123",
    });
    isLastWorkspaceMock.mockResolvedValueOnce(true);

    const response = await deletePersonalWorkspace(createApp(), "me");
    expect(response.status).toBe(409);
    const body = await response.json();
    expect(body.kind).toBe("last_workspace");
    expect(workspaceDeleteMock).not.toHaveBeenCalled();
  });

  it("deletes the personal workspace when an organization workspace remains", async () => {
    workspaceFindUniqueMock.mockResolvedValueOnce({
      id: "11111111-1111-7111-8111-111111111111",
      userId: "user_123",
    });
    isLastWorkspaceMock.mockResolvedValueOnce(false);
    workspaceDeleteMock.mockResolvedValueOnce({
      id: "11111111-1111-7111-8111-111111111111",
      userId: "user_123",
    });

    const response = await deletePersonalWorkspace(createApp(), "me");
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.data).toEqual({
      workspaceId: "11111111-1111-7111-8111-111111111111",
    });
    expect(isLastWorkspaceMock).toHaveBeenCalledWith(
      "user_123",
      { type: "personal" },
      TX,
    );
    expect(workspaceDeleteMock).toHaveBeenCalledWith({
      where: { id: "11111111-1111-7111-8111-111111111111" },
    });
    expect(TX.user.update).not.toHaveBeenCalled();
  });

  it("rewrites preferred to a remaining org when preferred is already personal", async () => {
    workspaceFindUniqueMock.mockResolvedValueOnce({
      id: "11111111-1111-7111-8111-111111111111",
      userId: "user_123",
    });
    isLastWorkspaceMock.mockResolvedValueOnce(false);
    TX.user.findUnique.mockResolvedValueOnce({
      preferredOrganizationId: null,
    });
    workspaceDeleteMock.mockResolvedValueOnce({
      id: "11111111-1111-7111-8111-111111111111",
      userId: "user_123",
    });

    const response = await deletePersonalWorkspace(createApp(), "me");
    expect(response.status).toBe(200);
    expect(TX.member.findFirst).toHaveBeenCalledWith({
      where: { userId: "user_123" },
      select: { organizationId: true },
    });
    expect(TX.user.update).toHaveBeenCalledWith({
      where: { id: "user_123" },
      data: { preferredOrganizationId: "org_1" },
    });
  });

  it("returns 409 workspace_has_dependents when delete hits a foreign key", async () => {
    workspaceFindUniqueMock.mockResolvedValueOnce({
      id: "11111111-1111-7111-8111-111111111111",
      userId: "user_123",
    });
    isLastWorkspaceMock.mockResolvedValueOnce(false);
    workspaceDeleteMock.mockRejectedValueOnce(
      Object.assign(new Error("Foreign key constraint failed"), {
        code: "P2003",
      }),
    );

    const response = await deletePersonalWorkspace(createApp(), "me");
    expect(response.status).toBe(409);
    const body = await response.json();
    expect(body.kind).toBe("workspace_has_dependents");
  });
});
