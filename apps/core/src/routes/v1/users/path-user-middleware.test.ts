import { Hono } from "hono";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { AuthVariables, AuthenticationContext } from "@/middleware/auth";

import { usersPathUserExistsMiddleware } from "./path-user-middleware";

const { userFindUniqueMock } = vi.hoisted(() => ({
  userFindUniqueMock: vi.fn(),
}));

vi.mock("@/lib/db/prisma", () => ({
  default: {
    user: {
      findUnique: userFindUniqueMock,
    },
  },
}));

const ADMIN_AUTH_CONTEXT: AuthenticationContext = {
  actor: "user",
  userId: "admin_123",
  organizationId: null,
  role: "admin",
};

function createApp(
  authContext: AuthenticationContext = ADMIN_AUTH_CONTEXT,
) {
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
  userByIdApp.use("*", usersPathUserExistsMiddleware);
  userByIdApp.get("/", (c) => c.json({ id: c.req.param("id") }));
  userByIdApp.get("/uploads", (c) => c.json({ id: c.req.param("id") }));

  app.route("/:id", userByIdApp);

  return app;
}

describe("usersPathUserExistsMiddleware", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns 404 when an admin targets a missing user id", async () => {
    userFindUniqueMock.mockResolvedValue(null);
    const app = createApp();

    const response = await app.request("http://localhost/missing_user/uploads");

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

    const response = await app.request("http://localhost/me/uploads");

    expect(response.status).toBe(200);
    expect(userFindUniqueMock).toHaveBeenCalledWith({
      where: { id: "user_123" },
      select: { id: true },
    });
  });

});
