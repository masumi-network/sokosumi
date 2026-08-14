import { OpenAPIHono } from "@hono/zod-openapi";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { OpenAPIHonoWithAuth } from "@/lib/hono";
import type { AuthenticationContext, AuthVariables } from "@/middleware/auth";
import {
  type UserRouteVariables,
  usersPathUserContextMiddleware,
} from "@/routes/v1/users/user-route-context";

import mountGetUserWorkspaceInventory from "./get";

const { loadWorkspaceInventoryMock, userFindUniqueMock } = vi.hoisted(() => ({
  loadWorkspaceInventoryMock: vi.fn(),
  userFindUniqueMock: vi.fn(),
}));

vi.mock("@/helpers/workspace-inventory", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@/helpers/workspace-inventory")>();
  return {
    ...actual,
    loadWorkspaceInventory: (...args: unknown[]) =>
      loadWorkspaceInventoryMock(...args),
  };
});

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

function createApp(authContext: AuthenticationContext = SESSION_USER) {
  const app = new OpenAPIHono<{ Variables: AuthVariables }>();
  app.use("*", async (c, next) => {
    c.set("isAuthenticated", true);
    c.set("authContext", authContext);
    return await next();
  });

  const userByIdApp = new OpenAPIHono<{
    Variables: AuthVariables & UserRouteVariables;
  }>();
  userByIdApp.use("*", usersPathUserContextMiddleware);
  mountGetUserWorkspaceInventory(
    userByIdApp as unknown as OpenAPIHonoWithAuth<UserRouteVariables>,
  );
  app.route("/:id", userByIdApp);
  return app;
}

describe("GET /users/{id}/workspace-inventory", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it("returns 403 when the caller may not access the target user", async () => {
    const response = await createApp().request(
      "http://localhost/other_user/workspace-inventory",
    );
    expect(response.status).toBe(403);
    expect(loadWorkspaceInventoryMock).not.toHaveBeenCalled();
  });

  it("returns the inventory for `me`", async () => {
    userFindUniqueMock.mockResolvedValueOnce({ id: "user_123" });
    loadWorkspaceInventoryMock.mockResolvedValueOnce({
      gate: "identity-onboarding",
      hasPersonalWorkspace: false,
      hasOrganizationMembership: false,
      hasPendingOrganizationInvites: false,
    });

    const response = await createApp().request(
      "http://localhost/me/workspace-inventory",
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(loadWorkspaceInventoryMock).toHaveBeenCalledWith(
      "user_123",
      expect.objectContaining({
        user: expect.objectContaining({ findUnique: expect.any(Function) }),
      }),
    );
    expect(body.data).toEqual({
      gate: "identity-onboarding",
      hasPersonalWorkspace: false,
      hasOrganizationMembership: false,
      hasPendingOrganizationInvites: false,
    });
  });

  it("returns ready inventory when personal workspace exists", async () => {
    userFindUniqueMock.mockResolvedValueOnce({ id: "user_123" });
    loadWorkspaceInventoryMock.mockResolvedValueOnce({
      gate: "ready",
      hasPersonalWorkspace: true,
      hasOrganizationMembership: false,
      hasPendingOrganizationInvites: true,
    });

    const response = await createApp().request(
      "http://localhost/me/workspace-inventory",
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.data.gate).toBe("ready");
    expect(body.data.hasPersonalWorkspace).toBe(true);
  });
});
