import { beforeEach, describe, expect, it, vi } from "vitest";

import { errorHandler } from "@/helpers/error-handler.js";
import { OpenAPIHonoWithAuth } from "@/lib/hono";
import type { AuthenticationContext } from "@/middleware/auth";
import {
  type UserRouteVariables,
  usersPathUserContextMiddleware,
} from "@/routes/v1/users/user-route-context";

import mountPatchUser from "./patch";

vi.mock("@/middleware/auth", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/middleware/auth")>();
  const { stubAuthMiddleware } = await import(
    "@/test-fixtures/auth-middleware"
  );
  return { ...actual, authMiddleware: stubAuthMiddleware };
});

const { userFindUniqueMock, userUpdateMock } = vi.hoisted(() => ({
  userFindUniqueMock: vi.fn(),
  userUpdateMock: vi.fn(),
}));

vi.mock("@/lib/db/prisma", () => ({
  default: {
    user: { findUnique: userFindUniqueMock, update: userUpdateMock },
  },
}));

const SESSION_USER: AuthenticationContext = {
  actor: "user",
  userId: "user_123",
  organizationId: null,
  role: "user",
};

const USER_RECORD = {
  id: "user_123",
  createdAt: new Date("2025-01-01T00:00:00.000Z"),
  updatedAt: new Date("2025-01-01T00:00:00.000Z"),
  name: "",
  firstName: null,
  lastName: null,
  email: "ada@example.com",
  emailVerified: true,
  image: null,
  role: "user",
};

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
  mountPatchUser(userByIdApp);
  app.route("/:id", userByIdApp);
  return app;
}

function patch(body: unknown) {
  return createApp().request("/me", {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("PATCH /users/{id}", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    userUpdateMock.mockImplementation(async ({ data }) => ({
      ...USER_RECORD,
      ...data,
    }));
  });

  it("saves first and last name and derives a missing display name", async () => {
    userFindUniqueMock.mockResolvedValue(USER_RECORD);

    const response = await patch({ firstName: " Ada ", lastName: "Lovelace" });

    expect(response.status).toBe(200);
    expect(userUpdateMock).toHaveBeenCalledWith({
      where: { id: "user_123" },
      data: { firstName: "Ada", lastName: "Lovelace", name: "Ada Lovelace" },
    });
    const body = await response.json();
    expect(body.data).toMatchObject({
      firstName: "Ada",
      lastName: "Lovelace",
      name: "Ada Lovelace",
    });
  });

  it("keeps a display name the user already has", async () => {
    userFindUniqueMock.mockResolvedValue({ ...USER_RECORD, name: "Countess" });

    const response = await patch({ firstName: "Ada", lastName: "Lovelace" });

    expect(response.status).toBe(200);
    expect(userUpdateMock).toHaveBeenCalledWith({
      where: { id: "user_123" },
      data: { firstName: "Ada", lastName: "Lovelace" },
    });
  });

  it.each([
    ["a blank first name", { firstName: " ", lastName: "Lovelace" }],
    ["a missing last name", { firstName: "Ada" }],
    [
      "a name over the limit",
      { firstName: "A".repeat(100), lastName: "B".repeat(100) },
    ],
  ])("rejects %s", async (_label, body) => {
    userFindUniqueMock.mockResolvedValue(USER_RECORD);

    const response = await patch(body);

    expect(response.status).toBe(422);
    expect(userUpdateMock).not.toHaveBeenCalled();
  });
});
