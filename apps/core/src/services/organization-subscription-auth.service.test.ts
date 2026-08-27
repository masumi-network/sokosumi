import { beforeEach, describe, expect, it, vi } from "vitest";

const { resolveOrganizationBillingPlanWithActiveSubscriptionMock } = vi.hoisted(
  () => ({
    resolveOrganizationBillingPlanWithActiveSubscriptionMock: vi.fn(),
  }),
);

vi.mock("@sokosumi/database/helpers", () => ({
  resolveOrganizationBillingPlanWithActiveSubscription: (...args: unknown[]) =>
    resolveOrganizationBillingPlanWithActiveSubscriptionMock(...args),
}));

vi.mock("@/lib/db/prisma", () => ({
  default: { __prisma: true },
}));

import { ensureCanAcceptOrganizationInvitation } from "@/services/organization-subscription-auth.service";

describe("ensureCanAcceptOrganizationInvitation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("allows enterprise contracts that have at least one purchased seat", async () => {
    resolveOrganizationBillingPlanWithActiveSubscriptionMock.mockResolvedValue({
      billingPlan: {
        mode: "enterprise_contract",
        isConsumable: true,
        purchasedSeats: 5,
      },
      activeSubscription: null,
    });

    await expect(
      ensureCanAcceptOrganizationInvitation("org-1"),
    ).resolves.toBeUndefined();
  });

  it("rejects enterprise contracts without any purchased seats", async () => {
    resolveOrganizationBillingPlanWithActiveSubscriptionMock.mockResolvedValue({
      billingPlan: {
        mode: "enterprise_contract",
        isConsumable: true,
        purchasedSeats: 0,
      },
      activeSubscription: null,
    });

    await expect(
      ensureCanAcceptOrganizationInvitation("org-1"),
    ).rejects.toMatchObject({
      status: "BAD_REQUEST",
      body: {
        message:
          "Enterprise contract has no purchased seats configured for this organization.",
      },
    });
  });

  it("allows self-serve organizations that have an active subscription", async () => {
    resolveOrganizationBillingPlanWithActiveSubscriptionMock.mockResolvedValue({
      billingPlan: {
        mode: "self_serve",
        isConsumable: false,
        purchasedSeats: 1,
      },
      activeSubscription: {
        id: "sub-1",
        createdAt: new Date(),
        periodEnd: new Date(),
        periodStart: new Date(),
        seats: 1,
        stripeSubscriptionId: "sub_stripe_1",
      },
    });

    await expect(
      ensureCanAcceptOrganizationInvitation("org-1"),
    ).resolves.toBeUndefined();

    expect(
      resolveOrganizationBillingPlanWithActiveSubscriptionMock,
    ).toHaveBeenCalledWith("org-1", { __prisma: true });
  });

  it("rejects self-serve organizations without an active subscription", async () => {
    resolveOrganizationBillingPlanWithActiveSubscriptionMock.mockResolvedValue({
      billingPlan: {
        mode: "self_serve",
        isConsumable: false,
        purchasedSeats: 1,
      },
      activeSubscription: null,
    });

    await expect(
      ensureCanAcceptOrganizationInvitation("org-1"),
    ).rejects.toMatchObject({
      status: "BAD_REQUEST",
      body: {
        message:
          "An active organization subscription is required before adding members.",
      },
    });
  });
});
