import { OpenAPIHono } from "@hono/zod-openapi";
import { APIError } from "better-auth/api";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { OpenAPIHonoWithAuth } from "@/lib/hono";
import type { AuthenticationContext, AuthVariables } from "@/middleware/auth";
import {
  type UserRouteVariables,
  usersPathUserContextMiddleware,
} from "@/routes/v1/users/user-route-context";

import mountPostUserPassword from "./post";

const { setPasswordMock, userFindUniqueMock } = vi.hoisted(() => ({
  setPasswordMock: vi.fn(),
  userFindUniqueMock: vi.fn(),
}));

vi.mock("@/lib/auth", () => ({
  auth: {
    api: {
      setPassword: setPasswordMock,
    },
  },
}));

vi.mock("@/lib/db/prisma", () => ({
  default: {
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

const ADMIN_USER: AuthenticationContext = {
  actor: "user",
  userId: "admin_1",
  organizationId: null,
  role: "admin",
};

function createApp(authContext: AuthenticationContext = SESSION_USER) {
  const app = new OpenAPIHono<{
    Variables: AuthVariables;
  }>();

  app.use("*", async (c, next) => {
    c.set("isAuthenticated", true);
    c.set("authContext", authContext);
    return await next();
  });

  const userByIdApp = new OpenAPIHono<{
    Variables: AuthVariables & UserRouteVariables;
  }>();
  userByIdApp.use("*", usersPathUserContextMiddleware);
  mountPostUserPassword(
    userByIdApp as unknown as OpenAPIHonoWithAuth<UserRouteVariables>,
  );
  app.route("/:id", userByIdApp);
  return app;
}

function postPassword(
  app: ReturnType<typeof createApp>,
  pathId: string,
  newPassword: string,
) {
  return app.request(`http://localhost/${pathId}/password`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ newPassword }),
  });
}

describe("POST /users/{id}/password", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    userFindUniqueMock.mockResolvedValue({ id: "user_123" });
  });

  it("sets the password for the session user", async () => {
    setPasswordMock.mockResolvedValue({ status: true });

    const response = await postPassword(createApp(), "me", "new-password-123");

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.data).toEqual({ status: true });
    expect(setPasswordMock).toHaveBeenCalledWith({
      body: { newPassword: "new-password-123" },
      headers: expect.any(Headers),
    });
  });

  it("rejects admins targeting another user", async () => {
    const response = await postPassword(
      createApp(ADMIN_USER),
      "user_123",
      "new-password-123",
    );

    expect(response.status).toBe(403);
    expect(setPasswordMock).not.toHaveBeenCalled();
  });

  it("maps a Better Auth 400 (password already set) to the error envelope", async () => {
    setPasswordMock.mockRejectedValue(
      new APIError("BAD_REQUEST", {
        message: "Password is already set for this account",
      }),
    );

    const response = await postPassword(createApp(), "me", "new-password-123");

    expect(response.status).toBe(400);
  });

  it("maps a Better Auth 401 to unauthorized", async () => {
    setPasswordMock.mockRejectedValue(
      new APIError("UNAUTHORIZED", { message: "Session required" }),
    );

    const response = await postPassword(createApp(), "me", "new-password-123");

    expect(response.status).toBe(401);
  });
});
