import { OpenAPIHono } from "@hono/zod-openapi";
import type { RequestIdVariables } from "hono/request-id";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { forbidden, notFound } from "@/helpers/error";
import { errorHandler } from "@/helpers/error-handler.js";
import { defaultValidationHook, type OpenAPIHonoWithAuth } from "@/lib/hono.js";
import type { AuthVariables } from "@/middleware/auth";

const {
  resolveMemberOrganizationByIdMock,
  resolveOrganizationBillingPlanMock,
  getEnterpriseContractBillingSummaryMock,
} = vi.hoisted(() => ({
  resolveMemberOrganizationByIdMock: vi.fn(),
  resolveOrganizationBillingPlanMock: vi.fn(),
  getEnterpriseContractBillingSummaryMock: vi.fn(),
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

vi.mock("@/helpers/enterprise-contract-summary.js", () => ({
  getEnterpriseContractBillingSummary: getEnterpriseContractBillingSummaryMock,
}));

const { default: mountSummary } = await import("./get.js");

function createApp() {
  const app = new OpenAPIHono<{
    Variables: AuthVariables & RequestIdVariables;
  }>({
    defaultHook: defaultValidationHook,
  });

  app.use("*", async (c, next) => {
    c.set("requestId", "req_summary_test");
    c.set("isAuthenticated", true);
    c.set("authContext", {
      actor: "user",
      userId: "user_1",
      organizationId: null,
      role: "user",
    });
    await next();
  });

  app.onError(errorHandler);
  mountSummary(app as unknown as OpenAPIHonoWithAuth);

  return app;
}

const ENTERPRISE_PLAN = {
  mode: "enterprise_contract" as const,
  plan: "enterprise" as const,
  isConsumable: true,
  purchasedSeats: 10,
  contractId: "contract-1",
  endsAt: new Date("2026-12-14T23:59:59.999Z"),
  activatedAt: new Date("2026-01-15T00:00:00.000Z"),
  cancelAtPeriodEnd: false as const,
  periodEnd: null,
};

const SUMMARY = {
  activatedAt: new Date("2026-01-15T00:00:00.000Z"),
  endsAt: new Date("2026-12-14T23:59:59.999Z"),
  currentPeriodEnd: new Date("2026-03-14T23:59:59.999Z"),
  isConsumable: true,
  monthlyCredits: 6000,
  nextActivationAt: new Date("2026-03-15T00:00:00.000Z"),
  poolRemainingCredits: 2500,
  purchasedSeats: 10,
};

describe("GET /organizations/{id}/enterprise-contract-summary", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resolveMemberOrganizationByIdMock.mockResolvedValue({
      organization: { id: "org_1" },
      role: "owner",
    });
    resolveOrganizationBillingPlanMock.mockResolvedValue(ENTERPRISE_PLAN);
    getEnterpriseContractBillingSummaryMock.mockResolvedValue(SUMMARY);
  });

  it("returns the billing summary for an enterprise org member", async () => {
    const app = createApp();

    const response = await app.request(
      "http://localhost/org_1/enterprise-contract-summary",
    );
    const body = (await response.json()) as {
      data: {
        purchasedSeats: number;
        monthlyCredits: number;
        poolRemainingCredits: number;
        activatedAt: string;
        currentPeriodEnd: string | null;
      };
    };

    expect(response.status).toBe(200);
    expect(getEnterpriseContractBillingSummaryMock).toHaveBeenCalledWith(
      ENTERPRISE_PLAN,
      "org_1",
      expect.anything(),
      expect.any(Date),
    );
    expect(body.data.purchasedSeats).toBe(10);
    expect(body.data.monthlyCredits).toBe(6000);
    expect(body.data.poolRemainingCredits).toBe(2500);
    expect(body.data.activatedAt).toBe("2026-01-15T00:00:00.000Z");
    expect(body.data.currentPeriodEnd).toBe("2026-03-14T23:59:59.999Z");
  });

  it("returns 404 when the organization is not on an enterprise contract", async () => {
    resolveOrganizationBillingPlanMock.mockResolvedValue({
      mode: "self_serve",
      plan: "pro",
      purchasedSeats: 3,
      subscriptionId: "sub_1",
      cancelAtPeriodEnd: false,
      periodEnd: null,
    });
    const app = createApp();

    const response = await app.request(
      "http://localhost/org_1/enterprise-contract-summary",
    );

    expect(response.status).toBe(404);
    expect(getEnterpriseContractBillingSummaryMock).not.toHaveBeenCalled();
  });

  it("returns 403 when the caller is not a member of the organization", async () => {
    resolveMemberOrganizationByIdMock.mockRejectedValue(
      forbidden("You are not a member of this organization"),
    );
    const app = createApp();

    const response = await app.request(
      "http://localhost/org_1/enterprise-contract-summary",
    );

    expect(response.status).toBe(403);
    expect(resolveOrganizationBillingPlanMock).not.toHaveBeenCalled();
  });

  it("returns 404 when the organization does not exist", async () => {
    resolveMemberOrganizationByIdMock.mockRejectedValue(
      notFound("Organization not found"),
    );
    const app = createApp();

    const response = await app.request(
      "http://localhost/org_1/enterprise-contract-summary",
    );

    expect(response.status).toBe(404);
    expect(resolveOrganizationBillingPlanMock).not.toHaveBeenCalled();
  });
});
