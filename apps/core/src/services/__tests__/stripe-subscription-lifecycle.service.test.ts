import { beforeEach, describe, expect, it, vi } from "vitest";

const transitionToNextLocalFreeSubscriptionPeriodMock = vi.fn();
const getSubscriptionByStripeSubscriptionIdMock = vi.fn();
const resolveActiveSubscriptionByReferenceIdMock = vi.fn();
const subscriptionUpdateManyMock = vi.fn();

const transactionMock = vi.fn(async (callback: (tx: unknown) => unknown) =>
  callback({
    subscription: {
      updateMany: (...args: unknown[]) => subscriptionUpdateManyMock(...args),
    },
  }),
);

vi.mock("@sokosumi/database/helpers", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@sokosumi/database/helpers")>();
  return {
    ...actual,
    transitionToNextLocalFreeSubscriptionPeriod: (...args: unknown[]) =>
      transitionToNextLocalFreeSubscriptionPeriodMock(...args),
  };
});

vi.mock("@sokosumi/database/repositories", () => ({
  subscriptionRepository: {
    resolveActiveSubscriptionByReferenceId: (...args: unknown[]) =>
      resolveActiveSubscriptionByReferenceIdMock(...args),
    getSubscriptionByStripeSubscriptionId: (...args: unknown[]) =>
      getSubscriptionByStripeSubscriptionIdMock(...args),
  },
}));

vi.mock("@/lib/db/prisma", () => ({
  __esModule: true,
  default: {
    $transaction: (callback: (tx: unknown) => unknown) =>
      transactionMock(callback),
  },
}));

describe("reconcileActiveStripeBackedSubscription", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    subscriptionUpdateManyMock.mockResolvedValue({ count: 2 });
  });

  it("cancels active local free rows for the same reference when a Stripe-backed subscription is active", async () => {
    const { reconcileActiveStripeBackedSubscription } = await import(
      "../stripe-subscription-lifecycle.service"
    );

    await reconcileActiveStripeBackedSubscription({
      id: "sub_local_paid",
      plan: "pro",
      referenceId: "org-enterprise",
      status: "active",
      stripeSubscriptionId: "sub_enterprise",
    });

    expect(subscriptionUpdateManyMock).toHaveBeenCalledWith({
      where: {
        id: {
          not: "sub_local_paid",
        },
        plan: "free",
        referenceId: "org-enterprise",
        status: {
          in: ["active", "trialing", "past_due", "unpaid"],
        },
        stripeSubscriptionId: null,
      },
      data: {
        canceledAt: expect.any(Date),
        endedAt: expect.any(Date),
        status: "canceled",
      },
    });
  });

  it("does not cancel local free rows for non-active local subscription statuses", async () => {
    const { reconcileActiveStripeBackedSubscription } = await import(
      "../stripe-subscription-lifecycle.service"
    );

    await reconcileActiveStripeBackedSubscription({
      id: "sub_local_paid",
      plan: "pro",
      referenceId: "org-enterprise",
      status: "incomplete",
      stripeSubscriptionId: "sub_enterprise",
    });

    expect(subscriptionUpdateManyMock).not.toHaveBeenCalled();
  });

  it("does not cancel local free rows when the Stripe-backed local row is still free", async () => {
    const { reconcileActiveStripeBackedSubscription } = await import(
      "../stripe-subscription-lifecycle.service"
    );

    await reconcileActiveStripeBackedSubscription({
      id: "sub_local_free",
      plan: "free",
      referenceId: "org-enterprise",
      status: "active",
      stripeSubscriptionId: "sub_free",
    });

    expect(subscriptionUpdateManyMock).not.toHaveBeenCalled();
  });
});

describe("handleSubscriptionDeletedEvent", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    transitionToNextLocalFreeSubscriptionPeriodMock.mockResolvedValue(
      undefined,
    );
    resolveActiveSubscriptionByReferenceIdMock.mockResolvedValue(null);
    getSubscriptionByStripeSubscriptionIdMock.mockResolvedValue({
      canceledAt: new Date("2026-04-09T07:39:30.188Z"),
      createdAt: new Date("2026-03-09T07:39:30.188Z"),
      endedAt: null,
      id: "sub_local_1",
      periodEnd: new Date("2026-04-09T07:40:10.000Z"),
      plan: "free",
      referenceId: "user-1",
      stripeCustomerId: "cus_123",
      stripeSubscriptionId: "sub_123",
    });
  });

  it("creates the first local free successor when a Stripe free subscription ends", async () => {
    const { handleSubscriptionDeletedEvent } = await import(
      "../stripe-subscription-lifecycle.service"
    );

    await handleSubscriptionDeletedEvent({
      id: "sub_123",
    } as never);

    expect(getSubscriptionByStripeSubscriptionIdMock).toHaveBeenCalledWith(
      "sub_123",
      expect.anything(),
    );
    expect(resolveActiveSubscriptionByReferenceIdMock).toHaveBeenCalledWith(
      "user-1",
      expect.anything(),
    );
    expect(
      transitionToNextLocalFreeSubscriptionPeriodMock,
    ).toHaveBeenCalledWith(
      {
        setCanceledAt: true,
        subscription: {
          canceledAt: new Date("2026-04-09T07:39:30.188Z"),
          createdAt: new Date("2026-03-09T07:39:30.188Z"),
          endedAt: null,
          id: "sub_local_1",
          periodEnd: new Date("2026-04-09T07:40:10.000Z"),
          referenceId: "user-1",
          stripeCustomerId: "cus_123",
          stripeSubscriptionId: "sub_123",
        },
      },
      expect.anything(),
    );
  });

  it("creates the first local free successor when a Stripe paid subscription ends", async () => {
    getSubscriptionByStripeSubscriptionIdMock.mockResolvedValue({
      canceledAt: new Date("2026-04-09T07:39:30.188Z"),
      createdAt: new Date("2026-03-09T07:39:30.188Z"),
      endedAt: null,
      id: "sub_paid_1",
      periodEnd: new Date("2026-04-09T07:40:10.000Z"),
      plan: "starter",
      referenceId: "user-1",
      stripeCustomerId: "cus_123",
      stripeSubscriptionId: "sub_paid_stripe_1",
    });

    const { handleSubscriptionDeletedEvent } = await import(
      "../stripe-subscription-lifecycle.service"
    );

    await handleSubscriptionDeletedEvent({
      id: "sub_paid_stripe_1",
    } as never);

    expect(
      transitionToNextLocalFreeSubscriptionPeriodMock,
    ).toHaveBeenCalledWith(
      {
        setCanceledAt: true,
        subscription: {
          canceledAt: new Date("2026-04-09T07:39:30.188Z"),
          createdAt: new Date("2026-03-09T07:39:30.188Z"),
          endedAt: null,
          id: "sub_paid_1",
          periodEnd: new Date("2026-04-09T07:40:10.000Z"),
          referenceId: "user-1",
          stripeCustomerId: "cus_123",
          stripeSubscriptionId: "sub_paid_stripe_1",
        },
      },
      expect.anything(),
    );
  });

  it("skips the free fallback when another paid subscription is still active", async () => {
    resolveActiveSubscriptionByReferenceIdMock.mockResolvedValue({
      id: "sub_active_paid_2",
      plan: "pro",
    });

    const { handleSubscriptionDeletedEvent } = await import(
      "../stripe-subscription-lifecycle.service"
    );

    await handleSubscriptionDeletedEvent({
      id: "sub_123",
    } as never);

    expect(
      transitionToNextLocalFreeSubscriptionPeriodMock,
    ).not.toHaveBeenCalled();
  });
});
