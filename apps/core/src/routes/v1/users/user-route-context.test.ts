import { Hono } from "hono";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { AuthenticationContext, AuthVariables } from "@/middleware/auth";

import { usersPathUserContextMiddleware } from "./user-route-context";

const { userFindUniqueMock, assertCoworkerUserContextBindingMock } = vi.hoisted(
  () => ({
    userFindUniqueMock: vi.fn(),
    assertCoworkerUserContextBindingMock: vi.fn(),
  }),
);

vi.mock("@/lib/db/prisma", () => ({
  default: {
    user: {
      findUnique: userFindUniqueMock,
    },
  },
}));

vi.mock("@/helpers/coworker-user-context-binding", () => ({
  assertCoworkerUserContextBinding: (...args: unknown[]) =>
    assertCoworkerUserContextBindingMock(...args),
}));

const ADMIN_AUTH_CONTEXT: AuthenticationContext = {
  actor: "user",
  userId: "admin_123",
  organizationId: null,
  role: "admin",
};

function createApp(authContext: AuthenticationContext = ADMIN_AUTH_CONTEXT) {
  const app = new Hono<{
    Variables: AuthVariables;
  }>();

  app.use("*", async (c, next) => {
    c.set("isAuthenticated", true);
    c.set("authContext", authContext);

    return await next();
  });

  const userByIdApp = new Hono<{
    Variables: AuthVariables;
  }>();
  userByIdApp.use("*", usersPathUserContextMiddleware);
  userByIdApp.get("/", (c) => c.json({ id: c.req.param("id") }));
  userByIdApp.get("/files", (c) => c.json({ id: c.req.param("id") }));

  app.route("/:id", userByIdApp);

  return app;
}

describe("usersPathUserContextMiddleware", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    assertCoworkerUserContextBindingMock.mockResolvedValue(undefined);
  });

  it("returns 404 when an admin targets a missing user id", async () => {
    userFindUniqueMock.mockResolvedValue(null);
    const app = createApp();

    const response = await app.request("http://localhost/missing_user/files");

    expect(response.status).toBe(404);
    expect(userFindUniqueMock).toHaveBeenCalledWith({
      where: { id: "missing_user" },
      select: { id: true },
    });
  });

  it("checks the authenticated session user when the path segment is me", async () => {
    userFindUniqueMock.mockResolvedValue({ id: "user_123" });
    const app = createApp({
      actor: "user",
      userId: "user_123",
      organizationId: null,
      role: "user",
    });

    const response = await app.request("http://localhost/me/files");

    expect(response.status).toBe(200);
    expect(userFindUniqueMock).toHaveBeenCalledWith({
      where: { id: "user_123" },
      select: { id: true },
    });
  });

  // Path-resolution only — coworkerUserRouteAllowlistMiddleware is not mounted
  // here, so /files succeeding does not mean coworkers can call that route.
  it("allows coworker context for matching user id when binding passes", async () => {
    userFindUniqueMock.mockResolvedValue({ id: "user_123" });
    const app = createApp({
      actor: "coworker",
      coworkerId: "cow_123",
      vendorId: "01960001-0001-7001-8001-000000000001",
      context: { userId: "user_123", organizationId: null },
    });

    const response = await app.request("http://localhost/user_123/files");

    expect(response.status).toBe(200);
    expect(userFindUniqueMock).toHaveBeenCalledWith({
      where: { id: "user_123" },
      select: { id: true },
    });
    expect(assertCoworkerUserContextBindingMock).toHaveBeenCalled();
  });

  it("allows coworker with context headers for me when binding passes", async () => {
    userFindUniqueMock.mockResolvedValue({ id: "user_123" });
    const app = createApp({
      actor: "coworker",
      coworkerId: "cow_123",
      vendorId: "01960001-0001-7001-8001-000000000001",
      context: { userId: "user_123", organizationId: null },
    });

    const response = await app.request("http://localhost/me/files");

    expect(response.status).toBe(200);
    expect(userFindUniqueMock).toHaveBeenCalledWith({
      where: { id: "user_123" },
      select: { id: true },
    });
    expect(assertCoworkerUserContextBindingMock).toHaveBeenCalled();
  });

  it("returns 403 when coworker context binding is rejected", async () => {
    userFindUniqueMock.mockResolvedValue({ id: "user_123" });
    const { HTTPException } = await import("hono/http-exception");
    assertCoworkerUserContextBindingMock.mockRejectedValue(
      new HTTPException(403, {
        message:
          "Coworker cannot act as this user without a granted workspace access or assigned task relationship",
      }),
    );
    const app = createApp({
      actor: "coworker",
      coworkerId: "cow_123",
      vendorId: "01960001-0001-7001-8001-000000000001",
      context: { userId: "user_123", organizationId: null },
    });

    const response = await app.request("http://localhost/user_123/files");

    expect(response.status).toBe(403);
  });

  it("returns 403 when coworker context targets a different user id", async () => {
    const app = createApp({
      actor: "coworker",
      coworkerId: "cow_123",
      vendorId: "01960001-0001-7001-8001-000000000001",
      context: { userId: "user_other", organizationId: null },
    });

    const response = await app.request("http://localhost/user_123/files");

    expect(response.status).toBe(403);
    expect(userFindUniqueMock).not.toHaveBeenCalled();
    expect(assertCoworkerUserContextBindingMock).not.toHaveBeenCalled();
  });
});
