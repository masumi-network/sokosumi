import { beforeEach, describe, expect, it, vi } from "vitest";

import { OpenAPIHonoWithAuth } from "@/lib/hono";
import type { AuthenticationContext } from "@/middleware/auth";
import {
  applyUserRouteMiddleware,
  type UserRouteVariables,
} from "@/routes/v1/users/user-route-context";

vi.mock("@/middleware/auth", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/middleware/auth")>();
  const { stubAuthMiddleware } = await import(
    "@/test-fixtures/auth-middleware"
  );
  return { ...actual, authMiddleware: stubAuthMiddleware };
});

const {
  userFindUniqueMock,
  subscriptionFindFirstMock,
  subscriptionFindManyMock,
} = vi.hoisted(() => ({
  userFindUniqueMock: vi.fn(),
  subscriptionFindFirstMock: vi.fn(),
  subscriptionFindManyMock: vi.fn(),
}));

vi.mock("@/lib/db/prisma", () => ({
  default: {
    user: {
      findUnique: userFindUniqueMock,
    },
    subscription: {
      findFirst: subscriptionFindFirstMock,
      findMany: subscriptionFindManyMock,
    },
  },
}));

const { default: mountGetUserSubscription } = await import("./get");

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
  applyUserRouteMiddleware(userByIdApp);
  mountGetUserSubscription(userByIdApp);
  app.route("/:id", userByIdApp);
  return app;
}

describe("GET /users/{id}/subscription", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    subscriptionFindManyMock.mockResolvedValue([]);
  });

  it("returns 403 when the caller may not access the target user", async () => {
    const response = await createApp().request(
      "http://localhost/other_user/subscription",
    );

    expect(response.status).toBe(403);
    expect(subscriptionFindFirstMock).not.toHaveBeenCalled();
  });

  it("returns the active personal subscription for `me`", async () => {
    userFindUniqueMock.mockResolvedValueOnce({ id: "user_123" });
    subscriptionFindManyMock.mockResolvedValue([
      {
        id: "sub_1",
        plan: "starter",
        status: "active",
        cancelAtPeriodEnd: true,
        cancelAt: new Date("2025-02-01T00:00:00.000Z"),
        periodStart: new Date("2025-01-01T00:00:00.000Z"),
        periodEnd: new Date("2025-02-01T00:00:00.000Z"),
        seats: 1,
        referenceId: "user_123",
      },
    ]);

    const response = await createApp().request(
      "http://localhost/me/subscription",
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.data).toEqual({
      subscription: {
        plan: "starter",
        status: "active",
        cancelAtPeriodEnd: true,
        cancelAt: "2025-02-01T00:00:00.000Z",
        periodStart: "2025-01-01T00:00:00.000Z",
        periodEnd: "2025-02-01T00:00:00.000Z",
        seats: 1,
      },
    });
    expect(subscriptionFindManyMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          referenceId: "user_123",
          status: { in: ["active", "trialing", "past_due", "unpaid"] },
          periodStart: { lte: expect.any(Date) },
          periodEnd: { gt: expect.any(Date) },
        }),
        orderBy: [{ updatedAt: "desc" }],
      }),
    );
  });

  it("prefers a Stripe-backed in-period row over a free row", async () => {
    userFindUniqueMock.mockResolvedValueOnce({ id: "user_123" });
    subscriptionFindManyMock.mockResolvedValue([
      {
        id: "sub_free",
        plan: "free",
        status: "active",
        stripeSubscriptionId: null,
        cancelAtPeriodEnd: false,
        periodStart: new Date("2025-01-01T00:00:00.000Z"),
        periodEnd: new Date("2025-02-01T00:00:00.000Z"),
        seats: 1,
      },
      {
        id: "sub_paid",
        plan: "starter",
        status: "active",
        stripeSubscriptionId: "sub_stripe",
        cancelAtPeriodEnd: false,
        periodStart: new Date("2025-01-01T00:00:00.000Z"),
        periodEnd: new Date("2025-02-01T00:00:00.000Z"),
        seats: 1,
      },
    ]);

    const response = await createApp().request(
      "http://localhost/me/subscription",
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.data.subscription.plan).toBe("starter");
    expect(subscriptionFindFirstMock).not.toHaveBeenCalled();
  });

  it("falls back to the latest started active subscription outside the current period", async () => {
    userFindUniqueMock.mockResolvedValueOnce({ id: "user_123" });
    subscriptionFindFirstMock.mockResolvedValue({
      id: "sub_fallback",
      plan: "starter",
      status: "past_due",
      cancelAtPeriodEnd: false,
      periodStart: new Date("2025-01-01T00:00:00.000Z"),
      periodEnd: new Date("2025-02-01T00:00:00.000Z"),
      seats: 1,
    });

    const response = await createApp().request(
      "http://localhost/me/subscription",
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.data.subscription).toEqual({
      plan: "starter",
      status: "past_due",
      cancelAtPeriodEnd: false,
      periodStart: "2025-01-01T00:00:00.000Z",
      periodEnd: "2025-02-01T00:00:00.000Z",
      seats: 1,
    });
    expect(subscriptionFindFirstMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          referenceId: "user_123",
          status: { in: ["active", "trialing", "past_due", "unpaid"] },
          OR: [
            { periodStart: null },
            { periodStart: { lte: expect.any(Date) } },
          ],
        }),
        orderBy: [
          { periodEnd: { sort: "desc", nulls: "last" } },
          { updatedAt: "desc" },
        ],
      }),
    );
  });

  it("returns null when the user has no active subscription", async () => {
    userFindUniqueMock.mockResolvedValueOnce({ id: "user_123" });
    subscriptionFindFirstMock.mockResolvedValue(null);

    const response = await createApp().request(
      "http://localhost/user_123/subscription",
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.data).toEqual({ subscription: null });
  });
});
