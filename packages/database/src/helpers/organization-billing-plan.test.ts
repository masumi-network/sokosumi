import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  type Prisma as PrismaType,
  type Subscription,
} from "../generated/prisma/client.js";

const { resolveActiveSubscriptionByReferenceIdMock } = vi.hoisted(() => ({
  resolveActiveSubscriptionByReferenceIdMock: vi.fn(),
}));

vi.mock("../repositories/subscription.repository.js", () => ({
  subscriptionRepository: {
    resolveActiveSubscriptionByReferenceId: (...args: unknown[]) =>
      resolveActiveSubscriptionByReferenceIdMock(...args),
  },
}));

import {
  resolveOrganizationBillingPlan,
  resolveOrganizationBillingPlanWithActiveSubscription,
} from "./organization-billing-plan.js";

function createTx(enterpriseContract: unknown): PrismaType.TransactionClient {
  return {
    enterpriseContract: {
      findFirst: vi.fn().mockResolvedValue(enterpriseContract),
    },
  } as unknown as PrismaType.TransactionClient;
}

describe("resolveOrganizationBillingPlanWithActiveSubscription", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns the enterprise contract plan without fetching a subscription", async () => {
    const tx = createTx({
      id: "contract-1",
      activatedAt: new Date("2026-01-01T00:00:00.000Z"),
      periodCount: 12,
      seats: 5,
      status: "active",
    });

    const { billingPlan, activeSubscription } =
      await resolveOrganizationBillingPlanWithActiveSubscription(
        "org-1",
        tx,
        new Date("2026-02-01T00:00:00.000Z"),
      );

    expect(billingPlan.mode).toBe("enterprise_contract");
    expect(billingPlan.purchasedSeats).toBe(5);
    expect(activeSubscription).toBeNull();
    // Enterprise path must not query the subscription row at all.
    expect(resolveActiveSubscriptionByReferenceIdMock).not.toHaveBeenCalled();
  });

  it("returns the self-serve plan and hands back the subscription it fetched", async () => {
    const subscription = {
      id: "sub-1",
      status: "active",
      plan: "free",
      seats: 3,
      cancelAtPeriodEnd: false,
      periodEnd: new Date("2026-03-01T00:00:00.000Z"),
    } as unknown as Subscription;
    resolveActiveSubscriptionByReferenceIdMock.mockResolvedValue(subscription);
    const tx = createTx(null);

    const { billingPlan, activeSubscription } =
      await resolveOrganizationBillingPlanWithActiveSubscription("org-1", tx);

    expect(billingPlan.mode).toBe("self_serve");
    if (billingPlan.mode === "self_serve") {
      expect(billingPlan.subscriptionId).toBe("sub-1");
    }
    // The fetched subscription is returned so callers don't query the same row twice.
    expect(activeSubscription).toBe(subscription);
    expect(resolveActiveSubscriptionByReferenceIdMock).toHaveBeenCalledWith(
      "org-1",
      tx,
    );
  });

  it("returns a free self-serve plan with no subscription", async () => {
    resolveActiveSubscriptionByReferenceIdMock.mockResolvedValue(null);
    const tx = createTx(null);

    const { billingPlan, activeSubscription } =
      await resolveOrganizationBillingPlanWithActiveSubscription("org-1", tx);

    expect(billingPlan.mode).toBe("self_serve");
    if (billingPlan.mode === "self_serve") {
      expect(billingPlan.plan).toBe("free");
      expect(billingPlan.purchasedSeats).toBe(0);
      expect(billingPlan.subscriptionId).toBeNull();
    }
    expect(activeSubscription).toBeNull();
  });
});

describe("resolveOrganizationBillingPlan", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("delegates to the combined helper and returns only the billing plan", async () => {
    resolveActiveSubscriptionByReferenceIdMock.mockResolvedValue(null);
    const tx = createTx(null);

    const billingPlan = await resolveOrganizationBillingPlan("org-1", tx);

    expect(billingPlan.mode).toBe("self_serve");
    if (billingPlan.mode === "self_serve") {
      expect(billingPlan.plan).toBe("free");
    }
  });
});
