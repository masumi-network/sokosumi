import { beforeEach, describe, expect, it, vi } from "vitest";

import { OpenAPIHonoWithAuth } from "@/lib/hono";
import type { AuthenticationContext } from "@/middleware/auth";
import {
  type UserRouteVariables,
  usersPathUserContextMiddleware,
} from "@/routes/v1/users/user-route-context";

import mountGetUserStripeCustomer from "./get";

vi.mock("@/middleware/auth", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/middleware/auth")>();
  const { stubAuthMiddleware } = await import(
    "@/test-fixtures/auth-middleware"
  );
  return { ...actual, authMiddleware: stubAuthMiddleware };
});

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
  const app = new OpenAPIHonoWithAuth();

  app.use("*", async (c, next) => {
    c.set("isAuthenticated", true);
    c.set("authContext", authContext);
    return await next();
  });

  const userByIdApp = new OpenAPIHonoWithAuth<UserRouteVariables>();
  userByIdApp.use("*", usersPathUserContextMiddleware);
  mountGetUserStripeCustomer(userByIdApp);
  app.route("/:id", userByIdApp);
  return app;
}

describe("GET /users/{id}/stripe-customer", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it("returns 404 when an admin requests a missing user", async () => {
    // admin may target any user; middleware existence check (select id) → null
    userFindUniqueMock.mockResolvedValueOnce(null);
    const response = await createApp(ADMIN_USER).request(
      "http://localhost/missing_user/stripe-customer",
    );
    expect(response.status).toBe(404);
  });

  it("returns 403 when the caller may not access the target user", async () => {
    const response = await createApp().request(
      "http://localhost/other_user/stripe-customer",
    );
    expect(response.status).toBe(403);
    expect(userFindUniqueMock).not.toHaveBeenCalled();
  });

  it("returns the stripe customer id for `me`", async () => {
    // 1: middleware existence check; 2: route stripeCustomerId read
    userFindUniqueMock
      .mockResolvedValueOnce({ id: "user_123" })
      .mockResolvedValueOnce({ stripeCustomerId: "cus_user" });

    const response = await createApp().request(
      "http://localhost/me/stripe-customer",
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.data).toEqual({ stripeCustomerId: "cus_user" });
  });

  it("returns null when no stripe customer is provisioned", async () => {
    userFindUniqueMock
      .mockResolvedValueOnce({ id: "user_123" })
      .mockResolvedValueOnce({ stripeCustomerId: null });

    const response = await createApp().request(
      "http://localhost/user_123/stripe-customer",
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.data).toEqual({ stripeCustomerId: null });
  });
});
