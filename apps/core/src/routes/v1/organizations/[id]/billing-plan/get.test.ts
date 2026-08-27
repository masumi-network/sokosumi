import { beforeEach, describe, expect, it, vi } from "vitest";
import { forbidden, notFound } from "@/helpers/error";
import { errorHandler } from "@/helpers/error-handler.js";
import { OpenAPIHonoWithAuth } from "@/lib/hono.js";
import type { AuthenticationContext } from "@/middleware/auth";
import { TEST_VENDOR_ID } from "@/test-fixtures/vendor.js";

vi.mock("@/middleware/auth", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/middleware/auth")>();
  const { stubAuthMiddleware } = await import(
    "@/test-fixtures/auth-middleware"
  );
  return { ...actual, authMiddleware: stubAuthMiddleware };
});

const {
  resolveMemberOrganizationByIdMock,
  resolveOrganizationBillingPlanMock,
} = vi.hoisted(() => ({
  resolveMemberOrganizationByIdMock: vi.fn(),
  resolveOrganizationBillingPlanMock: vi.fn(),
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

vi.mock("@sokosumi/database/helpers", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@sokosumi/database/helpers")>()),
  resolveOrganizationBillingPlan: resolveOrganizationBillingPlanMock,
}));

const { default: mountGetOrganizationBillingPlan } = await import("./get.js");

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
  const app = new OpenAPIHonoWithAuth();

  app.use("*", async (c, next) => {
    c.set("requestId", "req_billing_plan_test");
    c.set("isAuthenticated", true);
    c.set("authContext", authContext);
    await next();
  });

  app.onError(errorHandler);
  mountGetOrganizationBillingPlan(app);

  return app;
}

describe("GET /organizations/{id}/billing-plan", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resolveMemberOrganizationByIdMock.mockResolvedValue({
      organization: { id: "org_1" },
      member: { role: "member" },
    });
  });

  it("returns 403 for coworker authentication", async () => {
    const response = await createApp(COWORKER_AUTH_CONTEXT).request(
      "http://localhost/org_1/billing-plan",
    );

    expect(response.status).toBe(403);
    expect(resolveOrganizationBillingPlanMock).not.toHaveBeenCalled();
  });

  it("returns 404 when the organization does not exist", async () => {
    resolveMemberOrganizationByIdMock.mockRejectedValue(
      notFound("Organization not found"),
    );

    const response = await createApp().request(
      "http://localhost/missing/billing-plan",
    );

    expect(response.status).toBe(404);
  });

  it("returns 403 when the user is not a member", async () => {
    resolveMemberOrganizationByIdMock.mockRejectedValue(
      forbidden("You are not a member of this organization"),
    );

    const response = await createApp().request(
      "http://localhost/org_1/billing-plan",
    );

    expect(response.status).toBe(403);
    expect(resolveOrganizationBillingPlanMock).not.toHaveBeenCalled();
  });

  it("returns the self-serve billing plan for a member", async () => {
    resolveOrganizationBillingPlanMock.mockResolvedValue({
      mode: "self_serve",
      plan: "starter",
      purchasedSeats: 3,
      subscriptionId: "sub_1",
      cancelAtPeriodEnd: true,
      periodEnd: new Date("2026-03-01T00:00:00.000Z"),
    });

    const response = await createApp().request(
      "http://localhost/org_1/billing-plan",
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.data).toEqual({
      mode: "self_serve",
      plan: "starter",
      isConsumable: false,
      purchasedSeats: 3,
      cancelAtPeriodEnd: true,
      periodEnd: "2026-03-01T00:00:00.000Z",
    });
    expect(resolveOrganizationBillingPlanMock).toHaveBeenCalledWith(
      "org_1",
      expect.anything(),
    );
  });

  it("returns the enterprise billing plan with consumability", async () => {
    resolveOrganizationBillingPlanMock.mockResolvedValue({
      mode: "enterprise_contract",
      plan: "enterprise",
      isConsumable: true,
      purchasedSeats: 10,
      contractId: "contract_1",
      endsAt: new Date("2026-12-14T23:59:59.999Z"),
      activatedAt: new Date("2026-01-15T00:00:00.000Z"),
      cancelAtPeriodEnd: false,
      periodEnd: null,
    });

    const response = await createApp().request(
      "http://localhost/org_1/billing-plan",
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.data).toEqual({
      mode: "enterprise_contract",
      plan: "enterprise",
      isConsumable: true,
      purchasedSeats: 10,
      cancelAtPeriodEnd: false,
      periodEnd: null,
    });
  });
});
