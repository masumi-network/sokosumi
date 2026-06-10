import { OpenAPIHono } from "@hono/zod-openapi";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { OpenAPIHonoWithAuth } from "@/lib/hono";
import type { AuthenticationContext, AuthVariables } from "@/middleware/auth";
import {
  type UserRouteVariables,
  usersPathUserContextMiddleware,
} from "@/routes/v1/users/user-route-context";

import mountGetUserDesignMd from "./get";

const { userFindUniqueMock, getUserByIdMock } = vi.hoisted(() => ({
  userFindUniqueMock: vi.fn(),
  getUserByIdMock: vi.fn(),
}));

vi.mock("@/lib/db/prisma", () => ({
  default: { user: { findUnique: userFindUniqueMock } },
}));

vi.mock("@sokosumi/database/repositories", () => ({
  userRepository: {
    getUserById: (...args: unknown[]) => getUserByIdMock(...args),
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
  mountGetUserDesignMd(
    userByIdApp as unknown as OpenAPIHonoWithAuth<UserRouteVariables>,
  );
  app.route("/:id", userByIdApp);
  return app;
}

describe("GET /users/{id}/design-md", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it("returns 403 when the caller may not access the target user", async () => {
    const response = await createApp().request(
      "http://localhost/other_user/design-md",
    );
    expect(response.status).toBe(403);
    expect(getUserByIdMock).not.toHaveBeenCalled();
  });

  it("returns the user's stored DESIGN.md", async () => {
    userFindUniqueMock.mockResolvedValueOnce({ id: "user_123" });
    getUserByIdMock.mockResolvedValueOnce({
      metadata: JSON.stringify({
        designMdUrl: "https://blob.example/user.md",
        designMdExtractionId: "7",
      }),
    });

    const response = await createApp().request("http://localhost/me/design-md");
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.data.designMd).toEqual({
      url: "https://blob.example/user.md",
      extractionId: "7",
    });
  });

  it("returns null when the user has no DESIGN.md", async () => {
    userFindUniqueMock.mockResolvedValueOnce({ id: "user_123" });
    getUserByIdMock.mockResolvedValueOnce({ metadata: JSON.stringify({}) });

    const response = await createApp().request("http://localhost/me/design-md");
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.data.designMd).toBeNull();
  });

  it("returns 404 when the user is not found", async () => {
    userFindUniqueMock.mockResolvedValueOnce({ id: "user_123" });
    getUserByIdMock.mockResolvedValueOnce(null);

    const response = await createApp().request("http://localhost/me/design-md");
    expect(response.status).toBe(404);
  });
});
