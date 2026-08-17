import { OpenAPIHono } from "@hono/zod-openapi";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { errorHandler } from "@/helpers/error-handler.js";
import type { OpenAPIHonoWithAuth } from "@/lib/hono";
import type { AuthenticationContext, AuthVariables } from "@/middleware/auth";
import {
  type UserRouteVariables,
  usersPathUserContextMiddleware,
} from "@/routes/v1/users/user-route-context";

import mountPostUserPersonalWorkspace from "./post";

const {
  ensureServiceplanWorkspaceGrantOnCreateMock,
  transactionMock,
  userFindUniqueMock,
  workspaceFindUniqueMock,
  workspaceCreateMock,
  userUpdateMock,
} = vi.hoisted(() => ({
  ensureServiceplanWorkspaceGrantOnCreateMock: vi.fn(),
  transactionMock: vi.fn(),
  userFindUniqueMock: vi.fn(),
  workspaceFindUniqueMock: vi.fn(),
  workspaceCreateMock: vi.fn(),
  userUpdateMock: vi.fn(),
}));

vi.mock("@sokosumi/database/repositories", () => ({
  vendorGrantRepository: {
    ensureServiceplanWorkspaceGrantOnCreate:
      ensureServiceplanWorkspaceGrantOnCreateMock,
  },
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
    create: workspaceCreateMock,
  },
  user: {
    update: userUpdateMock,
  },
};

function createApp(authContext: AuthenticationContext = SESSION_USER) {
  const app = new OpenAPIHono<{
    Variables: AuthVariables & { requestId: string };
  }>();

  app.onError(errorHandler);

  app.use("*", async (c, next) => {
    c.set("requestId", "req_123");
    c.set("isAuthenticated", true);
    c.set("authContext", authContext);
    return await next();
  });

  const userByIdApp = new OpenAPIHono<{
    Variables: AuthVariables & UserRouteVariables;
  }>();
  userByIdApp.use("*", usersPathUserContextMiddleware);
  mountPostUserPersonalWorkspace(
    userByIdApp as unknown as OpenAPIHonoWithAuth<UserRouteVariables>,
  );
  app.route("/:id", userByIdApp);
  return app;
}

function postPersonalWorkspace(
  app: ReturnType<typeof createApp>,
  pathId: string,
) {
  return app.request(`http://localhost/${pathId}/personal-workspace`, {
    method: "POST",
  });
}

describe("POST /users/{id}/personal-workspace", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    userFindUniqueMock.mockResolvedValue({ id: "user_123" });
    transactionMock.mockImplementation(async (callback) => {
      return await callback(TX);
    });
    ensureServiceplanWorkspaceGrantOnCreateMock.mockResolvedValue(undefined);
    userUpdateMock.mockResolvedValue({ id: "user_123" });
  });

  it("returns 403 when the caller may not access the target user", async () => {
    const response = await postPersonalWorkspace(createApp(), "other_user");
    expect(response.status).toBe(403);
    expect(transactionMock).not.toHaveBeenCalled();
  });

  it("creates a personal workspace when none exists and clears preferredOrganizationId", async () => {
    workspaceFindUniqueMock.mockResolvedValueOnce(null);
    workspaceCreateMock.mockResolvedValueOnce({
      id: "11111111-1111-7111-8111-111111111111",
      userId: "user_123",
    });

    const response = await postPersonalWorkspace(createApp(), "me");
    const body = await response.json();

    expect(response.status).toBe(201);
    expect(body.data).toEqual({
      workspaceId: "11111111-1111-7111-8111-111111111111",
    });
    expect(workspaceFindUniqueMock).toHaveBeenCalledWith({
      where: { userId: "user_123" },
    });
    expect(workspaceCreateMock).toHaveBeenCalledWith({
      data: { userId: "user_123" },
    });
    expect(ensureServiceplanWorkspaceGrantOnCreateMock).toHaveBeenCalledWith({
      workspaceId: "11111111-1111-7111-8111-111111111111",
      resolvedByUserId: "user_123",
      tx: TX,
    });
    expect(userUpdateMock).toHaveBeenCalledWith({
      where: { id: "user_123" },
      data: { preferredOrganizationId: null },
    });
  });

  it("returns 409 when a personal workspace already exists", async () => {
    workspaceFindUniqueMock.mockResolvedValueOnce({
      id: "existing_ws",
      userId: "user_123",
    });

    const response = await postPersonalWorkspace(createApp(), "me");
    expect(response.status).toBe(409);
    expect(workspaceCreateMock).not.toHaveBeenCalled();
    expect(userUpdateMock).not.toHaveBeenCalled();
  });

  it("returns 409 when create races on the personal workspace unique constraint", async () => {
    workspaceFindUniqueMock.mockResolvedValueOnce(null);
    workspaceCreateMock.mockRejectedValueOnce(
      Object.assign(new Error("Unique constraint failed"), { code: "P2002" }),
    );

    const response = await postPersonalWorkspace(createApp(), "me");
    expect(response.status).toBe(409);
    expect(userUpdateMock).not.toHaveBeenCalled();
  });
});
