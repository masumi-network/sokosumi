import { OpenAPIHono } from "@hono/zod-openapi";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { OpenAPIHonoWithAuth } from "@/lib/hono";
import type { AuthenticationContext, AuthVariables } from "@/middleware/auth";
import {
  type UserRouteVariables,
  usersPathUserContextMiddleware,
} from "@/routes/v1/users/user-route-context";

import mountPostUserStripeCustomer from "./post";

const { userFindUniqueMock, provisionUserStripeCustomerMock } = vi.hoisted(
  () => ({
    userFindUniqueMock: vi.fn(),
    provisionUserStripeCustomerMock: vi.fn(),
  }),
);

vi.mock("@/lib/db/prisma", () => ({
  default: {
    user: {
      findUnique: userFindUniqueMock,
    },
  },
}));

vi.mock("@/services/stripe-customer-provision.service", () => ({
  provisionUserStripeCustomer: (...args: unknown[]) =>
    provisionUserStripeCustomerMock(...args),
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
  mountPostUserStripeCustomer(
    userByIdApp as unknown as OpenAPIHonoWithAuth<UserRouteVariables>,
  );
  app.route("/:id", userByIdApp);
  return app;
}

describe("POST /users/{id}/stripe-customer", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it("returns 403 when the caller may not access the target user", async () => {
    const response = await createApp().request(
      "http://localhost/other_user/stripe-customer",
      { method: "POST" },
    );
    expect(response.status).toBe(403);
    expect(userFindUniqueMock).not.toHaveBeenCalled();
    expect(provisionUserStripeCustomerMock).not.toHaveBeenCalled();
  });

  it("returns 404 when an admin targets a missing user", async () => {
    userFindUniqueMock.mockResolvedValue(null);
    const response = await createApp(ADMIN_USER).request(
      "http://localhost/missing_user/stripe-customer",
      { method: "POST" },
    );
    expect(response.status).toBe(404);
    expect(provisionUserStripeCustomerMock).not.toHaveBeenCalled();
  });

  it("returns the existing customer id without creating a new one", async () => {
    userFindUniqueMock.mockResolvedValue({
      id: "user_123",
      name: "Jane",
      email: "jane@example.com",
      stripeCustomerId: "cus_existing",
    });
    const response = await createApp().request(
      "http://localhost/me/stripe-customer",
      { method: "POST" },
    );
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.data).toEqual({ stripeCustomerId: "cus_existing" });
    expect(provisionUserStripeCustomerMock).not.toHaveBeenCalled();
  });

  it("creates a Stripe customer when none is provisioned", async () => {
    userFindUniqueMock.mockResolvedValue({
      id: "user_123",
      name: "Jane",
      email: "jane@example.com",
      stripeCustomerId: null,
    });
    provisionUserStripeCustomerMock.mockResolvedValue("cus_new");
    const response = await createApp().request(
      "http://localhost/me/stripe-customer",
      { method: "POST" },
    );
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.data).toEqual({ stripeCustomerId: "cus_new" });
    expect(provisionUserStripeCustomerMock).toHaveBeenCalledWith({
      email: "jane@example.com",
      name: "Jane",
      userId: "user_123",
    });
  });
});
