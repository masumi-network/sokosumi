import { OpenAPIHono } from "@hono/zod-openapi";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { OpenAPIHonoWithAuth } from "@/lib/hono";
import type { AuthenticationContext, AuthVariables } from "@/middleware/auth";
import {
  type UserRouteVariables,
  usersPathUserContextMiddleware,
} from "@/routes/v1/users/user-route-context";

const { userFindUniqueMock, resolveActiveSubscriptionByReferenceIdMock } =
  vi.hoisted(() => ({
    userFindUniqueMock: vi.fn(),
    resolveActiveSubscriptionByReferenceIdMock: vi.fn(),
  }));

vi.mock("@/lib/db/prisma", () => ({
  default: {
    user: {
      findUnique: userFindUniqueMock,
    },
  },
}));

vi.mock("@sokosumi/database/repositories", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@sokosumi/database/repositories")>();
  return {
    ...actual,
    subscriptionRepository: {
      ...actual.subscriptionRepository,
      resolveActiveSubscriptionByReferenceId:
        resolveActiveSubscriptionByReferenceIdMock,
    },
  };
});

const { default: mountGetUserSubscription } = await import("./get");

const SESSION_USER: AuthenticationContext = {
  actor: "user",
  userId: "user_123",
  organizationId: null,
  role: "user",
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
  mountGetUserSubscription(
    userByIdApp as unknown as OpenAPIHonoWithAuth<UserRouteVariables>,
  );
  app.route("/:id", userByIdApp);
  return app;
}

describe("GET /users/{id}/subscription", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it("returns 403 when the caller may not access the target user", async () => {
    const response = await createApp().request(
      "http://localhost/other_user/subscription",
    );

    expect(response.status).toBe(403);
    expect(resolveActiveSubscriptionByReferenceIdMock).not.toHaveBeenCalled();
  });

  it("returns the active personal subscription for `me`", async () => {
    userFindUniqueMock.mockResolvedValueOnce({ id: "user_123" });
    resolveActiveSubscriptionByReferenceIdMock.mockResolvedValue({
      id: "sub_1",
      plan: "starter",
      status: "active",
      cancelAtPeriodEnd: true,
      periodStart: new Date("2025-01-01T00:00:00.000Z"),
      periodEnd: new Date("2025-02-01T00:00:00.000Z"),
      seats: 1,
      referenceId: "user_123",
    });

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
        periodStart: "2025-01-01T00:00:00.000Z",
        periodEnd: "2025-02-01T00:00:00.000Z",
        seats: 1,
      },
    });
    expect(resolveActiveSubscriptionByReferenceIdMock).toHaveBeenCalledWith(
      "user_123",
      expect.anything(),
    );
  });

  it("returns null when the user has no active subscription", async () => {
    userFindUniqueMock.mockResolvedValueOnce({ id: "user_123" });
    resolveActiveSubscriptionByReferenceIdMock.mockResolvedValue(null);

    const response = await createApp().request(
      "http://localhost/user_123/subscription",
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.data).toEqual({ subscription: null });
  });
});
