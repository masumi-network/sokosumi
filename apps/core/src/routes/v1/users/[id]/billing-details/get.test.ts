import { OpenAPIHono } from "@hono/zod-openapi";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { OpenAPIHonoWithAuth } from "@/lib/hono";
import type { AuthenticationContext, AuthVariables } from "@/middleware/auth";
import {
  type UserRouteVariables,
  usersPathUserContextMiddleware,
} from "@/routes/v1/users/user-route-context";

import mountGetUserBillingDetails from "./get";

const { getUserBillingDetailsMock, userFindUniqueMock } = vi.hoisted(() => ({
  getUserBillingDetailsMock: vi.fn(),
  userFindUniqueMock: vi.fn(),
}));

vi.mock("@/lib/db/prisma", () => ({
  default: {
    user: {
      findUnique: userFindUniqueMock,
    },
  },
}));

vi.mock("@/services/stripe-customer-billing.service", () => ({
  stripeCustomerBillingService: {
    getUserBillingDetails: (...args: unknown[]) =>
      getUserBillingDetailsMock(...args),
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

const billingDetails = {
  stripeCustomerId: "cus_user",
  email: "billing@example.com",
  address: null,
  taxIds: [],
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
  mountGetUserBillingDetails(
    userByIdApp as unknown as OpenAPIHonoWithAuth<UserRouteVariables>,
  );
  app.route("/:id", userByIdApp);
  return app;
}

describe("GET /users/{id}/billing-details", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    getUserBillingDetailsMock.mockResolvedValue(billingDetails);
    userFindUniqueMock.mockResolvedValue({ id: "user_123" });
  });

  it("returns 403 when the caller may not access the target user", async () => {
    const response = await createApp().request(
      "http://localhost/other_user/billing-details",
    );

    expect(response.status).toBe(403);
    expect(getUserBillingDetailsMock).not.toHaveBeenCalled();
  });

  it("returns billing details for `me`", async () => {
    const response = await createApp().request(
      "http://localhost/me/billing-details",
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.data).toEqual(billingDetails);
    expect(getUserBillingDetailsMock).toHaveBeenCalledWith("user_123");
  });

  it("returns billing details for an admin targeting another user", async () => {
    userFindUniqueMock.mockResolvedValue({ id: "user_456" });

    const response = await createApp(ADMIN_USER).request(
      "http://localhost/user_456/billing-details",
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.data).toEqual(billingDetails);
    expect(getUserBillingDetailsMock).toHaveBeenCalledWith("user_456");
  });

  it("returns empty billing details when no stripe customer is provisioned", async () => {
    userFindUniqueMock.mockResolvedValue({ id: "user_123" });
    getUserBillingDetailsMock.mockResolvedValue({
      stripeCustomerId: null,
      email: null,
      address: null,
      taxIds: [],
    });

    const response = await createApp().request(
      "http://localhost/user_123/billing-details",
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.data).toEqual({
      stripeCustomerId: null,
      email: null,
      address: null,
      taxIds: [],
    });
  });
});
