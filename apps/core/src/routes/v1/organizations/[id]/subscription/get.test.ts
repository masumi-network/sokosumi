import { OpenAPIHono } from "@hono/zod-openapi";
import type { RequestIdVariables } from "hono/request-id";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { forbidden, notFound } from "@/helpers/error";
import { errorHandler } from "@/helpers/error-handler.js";
import { defaultValidationHook, type OpenAPIHonoWithAuth } from "@/lib/hono.js";
import type { AuthenticationContext, AuthVariables } from "@/middleware/auth";
import { TEST_VENDOR_ID } from "@/test-fixtures/vendor.js";

const {
  resolveMemberOrganizationByIdMock,
  resolveActiveSubscriptionByReferenceIdMock,
} = vi.hoisted(() => ({
  resolveMemberOrganizationByIdMock: vi.fn(),
  resolveActiveSubscriptionByReferenceIdMock: vi.fn(),
}));

vi.mock("@/lib/db/prisma", () => ({
  default: {
    $transaction: async (callback: (tx: unknown) => unknown) =>
      await callback({}),
  },
}));

vi.mock("@/helpers/organization", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/helpers/organization")>()),
  resolveMemberOrganizationById: resolveMemberOrganizationByIdMock,
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

const { default: mountGetOrganizationSubscription } = await import("./get.js");

const USER_AUTH_CONTEXT: AuthenticationContext = {
  actor: "user",
  userId: "user_1",
  organizationId: null,
  role: "user",
};

const COWORKER_AUTH_CONTEXT: AuthenticationContext = {
  actor: "coworker",
  coworkerId: "cow_1",
  vendorId: TEST_VENDOR_ID,
};

function createApp(authContext: AuthenticationContext = USER_AUTH_CONTEXT) {
  const app = new OpenAPIHono<{
    Variables: AuthVariables & RequestIdVariables;
  }>({
    defaultHook: defaultValidationHook,
  });

  app.use("*", async (c, next) => {
    c.set("requestId", "req_org_subscription_test");
    c.set("isAuthenticated", true);
    c.set("authContext", authContext);
    await next();
  });

  app.onError(errorHandler);
  mountGetOrganizationSubscription(app as unknown as OpenAPIHonoWithAuth);

  return app;
}

describe("GET /organizations/{id}/subscription", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resolveMemberOrganizationByIdMock.mockResolvedValue({
      organization: { id: "org_1" },
      member: { role: "member" },
    });
  });

  it("returns 403 for coworker authentication", async () => {
    const response = await createApp(COWORKER_AUTH_CONTEXT).request(
      "http://localhost/org_1/subscription",
    );

    expect(response.status).toBe(403);
    expect(resolveActiveSubscriptionByReferenceIdMock).not.toHaveBeenCalled();
  });

  it("rejects coworker with context headers (owner session only)", async () => {
    const response = await createApp({
      actor: "coworker",
      coworkerId: "cow_1",
      vendorId: TEST_VENDOR_ID,
      context: { userId: "user_1", organizationId: "org_1" },
    }).request("http://localhost/org_1/subscription");

    expect(response.status).toBe(403);
  });

  it("returns 404 when the organization does not exist", async () => {
    resolveMemberOrganizationByIdMock.mockRejectedValue(
      notFound("Organization not found"),
    );

    const response = await createApp().request(
      "http://localhost/missing/subscription",
    );

    expect(response.status).toBe(404);
  });

  it("returns 403 when the user is not a member", async () => {
    resolveMemberOrganizationByIdMock.mockRejectedValue(
      forbidden("You are not a member of this organization"),
    );

    const response = await createApp().request(
      "http://localhost/org_1/subscription",
    );

    expect(response.status).toBe(403);
    expect(resolveActiveSubscriptionByReferenceIdMock).not.toHaveBeenCalled();
  });

  it("returns the active subscription for a member", async () => {
    resolveActiveSubscriptionByReferenceIdMock.mockResolvedValue({
      id: "sub_1",
      plan: "pro",
      status: "active",
      cancelAtPeriodEnd: false,
      periodStart: new Date("2025-01-01T00:00:00.000Z"),
      periodEnd: new Date("2025-02-01T00:00:00.000Z"),
      seats: 5,
      referenceId: "org_1",
    });

    const response = await createApp().request(
      "http://localhost/org_1/subscription",
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.data).toEqual({
      subscription: {
        plan: "pro",
        status: "active",
        cancelAtPeriodEnd: false,
        periodStart: "2025-01-01T00:00:00.000Z",
        periodEnd: "2025-02-01T00:00:00.000Z",
        seats: 5,
      },
    });
    expect(resolveActiveSubscriptionByReferenceIdMock).toHaveBeenCalledWith(
      "org_1",
      expect.anything(),
    );
  });

  it("returns null when the organization has no active subscription", async () => {
    resolveActiveSubscriptionByReferenceIdMock.mockResolvedValue(null);

    const response = await createApp().request(
      "http://localhost/org_1/subscription",
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.data).toEqual({ subscription: null });
  });
});
