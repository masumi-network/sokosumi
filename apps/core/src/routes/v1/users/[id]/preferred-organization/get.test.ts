import { beforeEach, describe, expect, it, vi } from "vitest";

import { OpenAPIHonoWithAuth } from "@/lib/hono";
import type { AuthenticationContext } from "@/middleware/auth";
import { agentUserRouteAllowlistMiddleware } from "@/routes/v1/users/user-coworker-route-allowlist";
import {
  type UserRouteVariables,
  usersPathUserContextMiddleware,
} from "@/routes/v1/users/user-route-context";
import mountGetUserPreferredOrganization from "./get";

vi.mock("@/middleware/auth", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/middleware/auth")>();
  const { stubAuthMiddleware } = await import(
    "@/test-fixtures/auth-middleware"
  );
  return { ...actual, authMiddleware: stubAuthMiddleware };
});

const { resolveSelectionMock, userFindUniqueMock } = vi.hoisted(() => ({
  resolveSelectionMock: vi.fn(),
  userFindUniqueMock: vi.fn(),
}));

vi.mock("@/services/preferred-organization.service", () => ({
  resolveActiveOrganizationIdForSession: resolveSelectionMock,
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

function createApp(authContext: AuthenticationContext = SESSION_USER) {
  const app = new OpenAPIHonoWithAuth();
  app.use("*", async (c, next) => {
    c.set("isAuthenticated", true);
    c.set("authContext", authContext);
    return await next();
  });

  const userByIdApp = new OpenAPIHonoWithAuth<UserRouteVariables>();
  userByIdApp.use("*", usersPathUserContextMiddleware);
  userByIdApp.use("*", agentUserRouteAllowlistMiddleware);
  mountGetUserPreferredOrganization(userByIdApp);
  app.route("/:id", userByIdApp);
  return app;
}

describe("GET /users/{id}/preferred-organization", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    userFindUniqueMock.mockResolvedValue({ id: "user_123" });
  });

  it.each(["org_123", null])(
    "returns the resolved selection %s without caching",
    async (organizationId) => {
      resolveSelectionMock.mockResolvedValueOnce(organizationId);
      const response = await createApp().request(
        "http://localhost/me/preferred-organization",
      );
      expect(response.status).toBe(200);
      expect(response.headers.get("Cache-Control")).toBe("no-store");
      expect((await response.json()).data).toEqual({ organizationId });
      expect(resolveSelectionMock).toHaveBeenCalledExactlyOnceWith("user_123");
    },
  );

  it("accepts the caller's explicit user id", async () => {
    resolveSelectionMock.mockResolvedValueOnce("org_123");
    const response = await createApp().request(
      "http://localhost/user_123/preferred-organization",
    );
    expect(response.status).toBe(200);
    expect(resolveSelectionMock).toHaveBeenCalledExactlyOnceWith("user_123");
  });

  it("rejects another user's preference", async () => {
    const response = await createApp().request(
      "http://localhost/other_user/preferred-organization",
    );
    expect(response.status).toBe(403);
    expect(resolveSelectionMock).not.toHaveBeenCalled();
  });

  it("permits an administrator to resolve the target user's selection", async () => {
    resolveSelectionMock.mockResolvedValueOnce("org_target");
    const response = await createApp({
      ...SESSION_USER,
      role: "admin",
    }).request("http://localhost/other_user/preferred-organization");
    expect(response.status).toBe(200);
    expect(resolveSelectionMock).toHaveBeenCalledExactlyOnceWith("other_user");
  });

  it("rejects agent access even for the owner's preference", async () => {
    const response = await createApp({
      actor: "sokoBot",
      sokoBotId: "bot_1",
      userId: "user_123",
      workspaceId: "workspace_1",
      organizationId: null,
    }).request("http://localhost/me/preferred-organization");
    expect(response.status).toBe(403);
    expect(resolveSelectionMock).not.toHaveBeenCalled();
  });

  it("returns 404 for a missing user before resolving a workspace", async () => {
    userFindUniqueMock.mockResolvedValueOnce(null);
    const response = await createApp().request(
      "http://localhost/me/preferred-organization",
    );
    expect(response.status).toBe(404);
    expect(resolveSelectionMock).not.toHaveBeenCalled();
  });

  it("does not return a successful personal selection when resolution fails", async () => {
    resolveSelectionMock.mockRejectedValueOnce(
      new Error("Database unavailable"),
    );
    const response = await createApp().request(
      "http://localhost/me/preferred-organization",
    );
    expect(response.status).toBe(500);
  });

  it("documents the GET response and setup precondition", () => {
    const document = createApp().getOpenAPIDocument({
      openapi: "3.0.0",
      info: { title: "test", version: "1" },
    });
    const operation = document.paths?.["/{id}/preferred-organization"]?.get;
    expect(operation?.responses?.["200"]).toBeDefined();
    expect(operation?.description).toContain("Check workspace-access first");
  });
});
