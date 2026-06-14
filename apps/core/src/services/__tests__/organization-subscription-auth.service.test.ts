import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  resolveOrganizationBillingPlanWithActiveSubscriptionMock,
  resolvePurchasedSeatsMock,
  ensureLocalFreeSubscriptionPeriodMock,
  grantFreeOrganizationMemberSubscriptionCreditsMock,
  resolveActiveSubscriptionByReferenceIdMock,
  getUnassignedMemberUserIdsMock,
  getOrganizationMemberUserIdsMock,
} = vi.hoisted(() => ({
  resolveOrganizationBillingPlanWithActiveSubscriptionMock: vi.fn(),
  resolvePurchasedSeatsMock: vi.fn(),
  ensureLocalFreeSubscriptionPeriodMock: vi.fn(),
  grantFreeOrganizationMemberSubscriptionCreditsMock: vi.fn(),
  resolveActiveSubscriptionByReferenceIdMock: vi.fn(),
  getUnassignedMemberUserIdsMock: vi.fn(),
  getOrganizationMemberUserIdsMock: vi.fn(),
}));

vi.mock("@sokosumi/database/helpers", () => ({
  resolveOrganizationBillingPlanWithActiveSubscription: (...args: unknown[]) =>
    resolveOrganizationBillingPlanWithActiveSubscriptionMock(...args),
  resolvePurchasedSeats: (...args: unknown[]) =>
    resolvePurchasedSeatsMock(...args),
  ensureLocalFreeSubscriptionPeriod: (...args: unknown[]) =>
    ensureLocalFreeSubscriptionPeriodMock(...args),
  grantFreeOrganizationMemberSubscriptionCredits: (...args: unknown[]) =>
    grantFreeOrganizationMemberSubscriptionCreditsMock(...args),
}));

vi.mock("@sokosumi/database/repositories", () => ({
  subscriptionRepository: {
    resolveActiveSubscriptionByReferenceId: (...args: unknown[]) =>
      resolveActiveSubscriptionByReferenceIdMock(...args),
  },
  memberRepository: {
    getUnassignedMemberUserIds: (...args: unknown[]) =>
      getUnassignedMemberUserIdsMock(...args),
    getOrganizationMemberUserIds: (...args: unknown[]) =>
      getOrganizationMemberUserIdsMock(...args),
  },
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

    // Enterprise contracts must not require a separate active-subscription lookup.
    expect(resolveActiveSubscriptionByReferenceIdMock).not.toHaveBeenCalled();
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
