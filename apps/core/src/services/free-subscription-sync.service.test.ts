import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const {
  ensureLocalFreeSubscriptionPeriodMock,
  memberFindManyMock,
  organizationFindUniqueMock,
  subscriptionFindManyMock,
  subscriptionUpdateMock,
  transactionSubscriptionUpdateMock,
  updateSubscriptionCancelAtPeriodEndMock,
  userFindUniqueMock,
} = vi.hoisted(() => ({
  ensureLocalFreeSubscriptionPeriodMock: vi.fn(),
  memberFindManyMock: vi.fn(),
  organizationFindUniqueMock: vi.fn(),
  subscriptionFindManyMock: vi.fn(),
  subscriptionUpdateMock: vi.fn(),
  transactionSubscriptionUpdateMock: vi.fn(),
  updateSubscriptionCancelAtPeriodEndMock: vi.fn(),
  userFindUniqueMock: vi.fn(),
}));

vi.mock("@sokosumi/database", () => ({
  MemberRole: {
    OWNER: "OWNER",
  },
}));

vi.mock("@sokosumi/database/helpers", () => ({
  ACTIVE_SUBSCRIPTION_STATUSES: ["active", "trialing", "past_due", "unpaid"],
  ensureLocalFreeSubscriptionPeriod: (...args: unknown[]) =>
    ensureLocalFreeSubscriptionPeriodMock(...args),
  FREE_SUBSCRIPTION_PLAN: "free",
  getNextMonthlyPeriodEnd: (periodStart: Date) => {
    const nextPeriodEnd = new Date(periodStart.getTime());
    nextPeriodEnd.setUTCMonth(nextPeriodEnd.getUTCMonth() + 1);
    return nextPeriodEnd;
  },
}));

vi.mock("@/clients/stripe.client", () => ({
  stripeClient: {
    updateSubscriptionCancelAtPeriodEnd: (...args: unknown[]) =>
      updateSubscriptionCancelAtPeriodEndMock(...args),
  },
}));

vi.mock("@/lib/db/prisma", () => ({
  default: {
    $transaction: async (callback: (tx: unknown) => Promise<unknown>) =>
      await callback({
        member: {
          findMany: (...args: unknown[]) => memberFindManyMock(...args),
        },
        organization: {
          findUnique: (...args: unknown[]) =>
            organizationFindUniqueMock(...args),
        },
        subscription: {
          update: (...args: unknown[]) =>
            transactionSubscriptionUpdateMock(...args),
        },
        user: {
          findUnique: (...args: unknown[]) => userFindUniqueMock(...args),
        },
      }),
    subscription: {
      findMany: (...args: unknown[]) => subscriptionFindManyMock(...args),
      update: (...args: unknown[]) => subscriptionUpdateMock(...args),
    },
  },
}));

function createSyncExecutionOptions() {
  const deadlineMs = Date.now() + 60_000;

  return {
    deadlineMs,
    msRemaining: () => deadlineMs - Date.now(),
    shouldContinue: () => true,
  };
}

describe("freeSubscriptionSyncService", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-04-15T00:00:00.000Z"));
    vi.resetAllMocks();
    ensureLocalFreeSubscriptionPeriodMock.mockResolvedValue(undefined);
    memberFindManyMock.mockResolvedValue([
      { role: "OWNER", userId: "user-1" },
      { role: "MEMBER", userId: "user-2" },
    ]);
    organizationFindUniqueMock.mockResolvedValue({ id: "org-1" });
    subscriptionFindManyMock.mockResolvedValue([]);
    subscriptionUpdateMock.mockResolvedValue(undefined);
    transactionSubscriptionUpdateMock.mockResolvedValue(undefined);
    updateSubscriptionCancelAtPeriodEndMock.mockResolvedValue(undefined);
    userFindUniqueMock.mockResolvedValue(null);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("marks Stripe-backed free subscriptions to cancel at period end", async () => {
    subscriptionFindManyMock
      .mockResolvedValueOnce([
        {
          cancelAtPeriodEnd: false,
          canceledAt: null,
          endedAt: null,
          id: "sub-1",
          periodEnd: new Date("2026-05-01T00:00:00.000Z"),
          referenceId: "user-1",
          seats: null,
          status: "active",
          stripeCustomerId: "cus_1",
          stripeSubscriptionId: "sub_stripe_1",
        },
      ])
      .mockResolvedValueOnce([]);

    const { freeSubscriptionSyncService } = await import(
      "./free-subscription-sync.service"
    );

    await freeSubscriptionSyncService.syncLegacyStripeFreeSubscriptions(
      createSyncExecutionOptions(),
    );

    expect(subscriptionFindManyMock).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        where: expect.objectContaining({
          NOT: {
            cancelAtPeriodEnd: true,
          },
          periodEnd: {
            gt: new Date("2026-04-15T00:00:00.000Z"),
          },
          status: {
            in: expect.arrayContaining(["incomplete", "paused"]),
          },
        }),
      }),
    );
    expect(updateSubscriptionCancelAtPeriodEndMock).toHaveBeenCalledWith(
      "sub_stripe_1",
      true,
      {
        timeout: expect.any(Number),
      },
    );
    expect(subscriptionUpdateMock).toHaveBeenCalledWith({
      where: {
        id: "sub-1",
      },
      data: {
        cancelAt: new Date("2026-05-01T00:00:00.000Z"),
        cancelAtPeriodEnd: true,
      },
    });
  });

  it("migrates due Stripe-backed subscriptions to local free and preserves history", async () => {
    subscriptionFindManyMock
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([
        {
          cancelAtPeriodEnd: true,
          canceledAt: null,
          endedAt: null,
          id: "sub-2",
          periodEnd: new Date("2026-04-01T00:00:00.000Z"),
          referenceId: "org-1",
          seats: 3,
          status: "active",
          stripeCustomerId: "cus_2",
          stripeSubscriptionId: "sub_stripe_2",
        },
      ])
      .mockResolvedValueOnce([]);

    const { freeSubscriptionSyncService } = await import(
      "./free-subscription-sync.service"
    );

    await freeSubscriptionSyncService.syncLegacyStripeFreeSubscriptions(
      createSyncExecutionOptions(),
    );

    expect(subscriptionFindManyMock).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        where: expect.objectContaining({
          plan: "free",
        }),
      }),
    );
    expect(ensureLocalFreeSubscriptionPeriodMock).toHaveBeenCalledWith(
      expect.objectContaining({
        memberUserIds: ["user-1", "user-2"],
        organizationId: "org-1",
        periodStart: new Date("2026-04-01T00:00:00.000Z"),
        referenceId: "org-1",
        stripeCustomerId: "cus_2",
      }),
      expect.any(Object),
    );
    expect(transactionSubscriptionUpdateMock).toHaveBeenCalledWith({
      where: {
        id: "sub-2",
      },
      data: expect.objectContaining({
        endedAt: new Date("2026-04-01T00:00:00.000Z"),
        status: "canceled",
      }),
    });
  });

  it("migrates due Stripe-backed personal subscriptions as users, not stale org fallbacks", async () => {
    organizationFindUniqueMock.mockResolvedValue(null);
    userFindUniqueMock.mockResolvedValue({ id: "user-7" });
    subscriptionFindManyMock
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([
        {
          cancelAtPeriodEnd: true,
          canceledAt: null,
          endedAt: null,
          id: "sub-user-7",
          periodEnd: new Date("2026-04-01T00:00:00.000Z"),
          referenceId: "user-7",
          seats: 1,
          status: "active",
          stripeCustomerId: "cus_7",
          stripeSubscriptionId: "sub_stripe_7",
        },
      ])
      .mockResolvedValueOnce([]);

    const { freeSubscriptionSyncService } = await import(
      "./free-subscription-sync.service"
    );

    await freeSubscriptionSyncService.syncLegacyStripeFreeSubscriptions(
      createSyncExecutionOptions(),
    );

    expect(userFindUniqueMock).toHaveBeenCalledWith({
      where: {
        id: "user-7",
      },
      select: {
        id: true,
      },
    });
    expect(ensureLocalFreeSubscriptionPeriodMock).toHaveBeenCalledWith(
      expect.objectContaining({
        organizationId: null,
        periodStart: new Date("2026-04-01T00:00:00.000Z"),
        referenceId: "user-7",
        stripeCustomerId: "cus_7",
        userId: "user-7",
      }),
      expect.any(Object),
    );
  });

  it("marks stale Stripe-backed subscriptions canceled when neither organization nor user exists", async () => {
    organizationFindUniqueMock.mockResolvedValue(null);
    userFindUniqueMock.mockResolvedValue(null);
    subscriptionFindManyMock
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([
        {
          cancelAtPeriodEnd: true,
          canceledAt: null,
          endedAt: null,
          id: "sub-stale-1",
          periodEnd: new Date("2026-04-01T00:00:00.000Z"),
          referenceId: "stale-ref-1",
          seats: 3,
          status: "active",
          stripeCustomerId: "cus_stale_1",
          stripeSubscriptionId: "sub_stripe_stale_1",
        },
      ])
      .mockResolvedValueOnce([]);

    const { freeSubscriptionSyncService } = await import(
      "./free-subscription-sync.service"
    );

    await freeSubscriptionSyncService.syncLegacyStripeFreeSubscriptions(
      createSyncExecutionOptions(),
    );

    expect(ensureLocalFreeSubscriptionPeriodMock).not.toHaveBeenCalled();
    expect(transactionSubscriptionUpdateMock).toHaveBeenCalledWith({
      where: {
        id: "sub-stale-1",
      },
      data: expect.objectContaining({
        endedAt: new Date("2026-04-01T00:00:00.000Z"),
        status: "canceled",
      }),
    });
  });

  it("migrates Stripe-backed free subscriptions already marked canceled by webhooks", async () => {
    subscriptionFindManyMock
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([
        {
          cancelAtPeriodEnd: true,
          canceledAt: new Date("2026-04-01T00:00:00.000Z"),
          endedAt: new Date("2026-04-01T00:00:00.000Z"),
          id: "sub-3",
          periodEnd: new Date("2026-04-01T00:00:00.000Z"),
          referenceId: "org-1",
          seats: 3,
          status: "canceled",
          stripeCustomerId: "cus_3",
          stripeSubscriptionId: "sub_stripe_3",
        },
      ])
      .mockResolvedValueOnce([]);

    const { freeSubscriptionSyncService } = await import(
      "./free-subscription-sync.service"
    );

    await freeSubscriptionSyncService.syncLegacyStripeFreeSubscriptions(
      createSyncExecutionOptions(),
    );

    expect(subscriptionFindManyMock).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        where: expect.objectContaining({
          OR: expect.arrayContaining([
            {
              cancelAtPeriodEnd: true,
            },
            {
              status: "canceled",
            },
          ]),
          plan: "free",
          periodEnd: {
            lte: expect.any(Date),
          },
        }),
      }),
    );
    expect(ensureLocalFreeSubscriptionPeriodMock).toHaveBeenCalledWith(
      expect.objectContaining({
        memberUserIds: ["user-1", "user-2"],
        organizationId: "org-1",
        periodStart: new Date("2026-04-01T00:00:00.000Z"),
        referenceId: "org-1",
        stripeCustomerId: "cus_3",
      }),
      expect.any(Object),
    );
  });

  it("migrates overdue Stripe-backed subscriptions with terminal state even when cancel-at-period-end was never stored", async () => {
    subscriptionFindManyMock
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([
        {
          cancelAtPeriodEnd: null,
          canceledAt: new Date("2026-04-01T00:00:00.000Z"),
          endedAt: new Date("2026-04-01T00:00:00.000Z"),
          id: "sub-terminal-null-flag",
          periodEnd: new Date("2026-04-01T00:00:00.000Z"),
          referenceId: "org-1",
          seats: 3,
          status: "canceled",
          stripeCustomerId: "cus_terminal",
          stripeSubscriptionId: "sub_stripe_terminal",
        },
      ])
      .mockResolvedValueOnce([]);

    const { freeSubscriptionSyncService } = await import(
      "./free-subscription-sync.service"
    );

    await freeSubscriptionSyncService.syncLegacyStripeFreeSubscriptions(
      createSyncExecutionOptions(),
    );

    expect(ensureLocalFreeSubscriptionPeriodMock).toHaveBeenCalledWith(
      expect.objectContaining({
        memberUserIds: ["user-1", "user-2"],
        organizationId: "org-1",
        periodStart: new Date("2026-04-01T00:00:00.000Z"),
        referenceId: "org-1",
        stripeCustomerId: "cus_terminal",
      }),
      expect.any(Object),
    );
  });

  it("does not migrate future Stripe-backed subscriptions before they are due", async () => {
    subscriptionFindManyMock
      .mockResolvedValueOnce([
        {
          cancelAtPeriodEnd: null,
          canceledAt: null,
          endedAt: null,
          id: "sub-future-1",
          periodEnd: new Date("2026-05-01T00:00:00.000Z"),
          referenceId: "user-future",
          seats: 1,
          status: "active",
          stripeCustomerId: "cus_future",
          stripeSubscriptionId: "sub_stripe_future",
        },
      ])
      .mockResolvedValueOnce([]);

    const { freeSubscriptionSyncService } = await import(
      "./free-subscription-sync.service"
    );

    await freeSubscriptionSyncService.syncLegacyStripeFreeSubscriptions(
      createSyncExecutionOptions(),
    );

    expect(subscriptionFindManyMock).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        where: expect.objectContaining({
          periodEnd: {
            lte: new Date("2026-04-15T00:00:00.000Z"),
          },
        }),
      }),
    );
    expect(ensureLocalFreeSubscriptionPeriodMock).not.toHaveBeenCalled();
    expect(transactionSubscriptionUpdateMock).not.toHaveBeenCalled();
  });

  it("skips migration when the next local free period already exists", async () => {
    subscriptionFindManyMock
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([
        {
          cancelAtPeriodEnd: true,
          canceledAt: new Date("2026-04-01T00:00:00.000Z"),
          endedAt: new Date("2026-04-01T00:00:00.000Z"),
          id: "sub-4",
          periodEnd: new Date("2026-04-01T00:00:00.000Z"),
          referenceId: "org-1",
          seats: 3,
          status: "canceled",
          stripeCustomerId: "cus_4",
          stripeSubscriptionId: "sub_stripe_4",
        },
      ])
      .mockResolvedValueOnce([
        {
          periodEnd: new Date("2026-05-01T00:00:00.000Z"),
          periodStart: new Date("2026-04-01T00:00:00.000Z"),
          referenceId: "org-1",
        },
      ])
      .mockResolvedValueOnce([]);

    const { freeSubscriptionSyncService } = await import(
      "./free-subscription-sync.service"
    );

    await freeSubscriptionSyncService.syncLegacyStripeFreeSubscriptions(
      createSyncExecutionOptions(),
    );

    expect(subscriptionFindManyMock).toHaveBeenNthCalledWith(
      3,
      expect.objectContaining({
        where: {
          OR: [
            {
              periodEnd: new Date("2026-05-01T00:00:00.000Z"),
              periodStart: new Date("2026-04-01T00:00:00.000Z"),
              plan: "free",
              referenceId: "org-1",
              stripeSubscriptionId: null,
            },
          ],
        },
        select: {
          periodEnd: true,
          periodStart: true,
          referenceId: true,
        },
      }),
    );
    expect(ensureLocalFreeSubscriptionPeriodMock).not.toHaveBeenCalled();
    expect(transactionSubscriptionUpdateMock).not.toHaveBeenCalled();
  });

  it("renews due local free subscriptions and preserves history", async () => {
    organizationFindUniqueMock.mockResolvedValue(null);
    userFindUniqueMock.mockResolvedValue({ id: "user-5" });
    subscriptionFindManyMock
      .mockResolvedValueOnce([
        {
          cancelAtPeriodEnd: false,
          canceledAt: null,
          endedAt: null,
          id: "sub-5",
          periodEnd: new Date("2026-04-01T00:00:00.000Z"),
          referenceId: "user-5",
          seats: null,
          status: "active",
          stripeCustomerId: "cus_5",
          stripeSubscriptionId: null,
        },
      ])
      .mockResolvedValueOnce([]);

    const { freeSubscriptionSyncService } = await import(
      "./free-subscription-sync.service"
    );

    await freeSubscriptionSyncService.renewLocalFreeSubscriptions(
      createSyncExecutionOptions(),
    );

    expect(subscriptionFindManyMock).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        where: expect.objectContaining({
          plan: "free",
          status: {
            in: ["active", "trialing", "past_due", "unpaid"],
          },
          stripeSubscriptionId: null,
        }),
      }),
    );
    expect(ensureLocalFreeSubscriptionPeriodMock).toHaveBeenCalledWith(
      expect.objectContaining({
        organizationId: null,
        periodStart: new Date("2026-04-01T00:00:00.000Z"),
        referenceId: "user-5",
        stripeCustomerId: "cus_5",
        userId: "user-5",
      }),
      expect.any(Object),
    );
    expect(transactionSubscriptionUpdateMock).toHaveBeenCalledWith({
      where: {
        id: "sub-5",
      },
      data: {
        endedAt: new Date("2026-04-01T00:00:00.000Z"),
        status: "canceled",
      },
    });
  });

  it("marks stale local free subscriptions canceled when the referenced user no longer exists", async () => {
    organizationFindUniqueMock.mockResolvedValue(null);
    userFindUniqueMock.mockResolvedValue(null);
    subscriptionFindManyMock
      .mockResolvedValueOnce([
        {
          cancelAtPeriodEnd: false,
          canceledAt: null,
          endedAt: null,
          id: "sub-stale-local-1",
          periodEnd: new Date("2026-04-01T00:00:00.000Z"),
          referenceId: "stale-user-1",
          seats: null,
          status: "active",
          stripeCustomerId: "cus_stale_local_1",
          stripeSubscriptionId: null,
        },
      ])
      .mockResolvedValueOnce([]);

    const { freeSubscriptionSyncService } = await import(
      "./free-subscription-sync.service"
    );

    await freeSubscriptionSyncService.renewLocalFreeSubscriptions(
      createSyncExecutionOptions(),
    );

    expect(userFindUniqueMock).toHaveBeenCalledWith({
      where: {
        id: "stale-user-1",
      },
      select: {
        id: true,
      },
    });
    expect(ensureLocalFreeSubscriptionPeriodMock).not.toHaveBeenCalled();
    expect(transactionSubscriptionUpdateMock).toHaveBeenCalledWith({
      where: {
        id: "sub-stale-local-1",
      },
      data: expect.objectContaining({
        canceledAt: expect.any(Date),
        endedAt: new Date("2026-04-01T00:00:00.000Z"),
        status: "canceled",
      }),
    });
  });

  it("catches up overdue local free subscriptions in a single renewal run", async () => {
    organizationFindUniqueMock.mockResolvedValue(null);
    userFindUniqueMock.mockResolvedValue({ id: "user-6" });
    subscriptionFindManyMock
      .mockResolvedValueOnce([
        {
          cancelAtPeriodEnd: false,
          canceledAt: null,
          endedAt: null,
          id: "sub-6-period-1",
          periodEnd: new Date("2026-02-01T00:00:00.000Z"),
          referenceId: "user-6",
          seats: null,
          status: "active",
          stripeCustomerId: "cus_6",
          stripeSubscriptionId: null,
        },
      ])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([
        {
          cancelAtPeriodEnd: false,
          canceledAt: null,
          endedAt: null,
          id: "sub-6-period-2",
          periodEnd: new Date("2026-03-01T00:00:00.000Z"),
          referenceId: "user-6",
          seats: null,
          status: "active",
          stripeCustomerId: "cus_6",
          stripeSubscriptionId: null,
        },
      ])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([
        {
          cancelAtPeriodEnd: false,
          canceledAt: null,
          endedAt: null,
          id: "sub-6-period-3",
          periodEnd: new Date("2026-04-01T00:00:00.000Z"),
          referenceId: "user-6",
          seats: null,
          status: "active",
          stripeCustomerId: "cus_6",
          stripeSubscriptionId: null,
        },
      ])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([]);

    const { freeSubscriptionSyncService } = await import(
      "./free-subscription-sync.service"
    );

    await freeSubscriptionSyncService.renewLocalFreeSubscriptions(
      createSyncExecutionOptions(),
    );

    expect(ensureLocalFreeSubscriptionPeriodMock).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        organizationId: null,
        periodEnd: new Date("2026-03-01T00:00:00.000Z"),
        periodStart: new Date("2026-02-01T00:00:00.000Z"),
        referenceId: "user-6",
        stripeCustomerId: "cus_6",
        userId: "user-6",
      }),
      expect.any(Object),
    );
    expect(ensureLocalFreeSubscriptionPeriodMock).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        organizationId: null,
        periodEnd: new Date("2026-04-01T00:00:00.000Z"),
        periodStart: new Date("2026-03-01T00:00:00.000Z"),
        referenceId: "user-6",
        stripeCustomerId: "cus_6",
        userId: "user-6",
      }),
      expect.any(Object),
    );
    expect(ensureLocalFreeSubscriptionPeriodMock).toHaveBeenNthCalledWith(
      3,
      expect.objectContaining({
        organizationId: null,
        periodEnd: new Date("2026-05-01T00:00:00.000Z"),
        periodStart: new Date("2026-04-01T00:00:00.000Z"),
        referenceId: "user-6",
        stripeCustomerId: "cus_6",
        userId: "user-6",
      }),
      expect.any(Object),
    );
    expect(transactionSubscriptionUpdateMock).toHaveBeenCalledTimes(3);
    expect(subscriptionFindManyMock).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        where: expect.objectContaining({
          periodEnd: {
            lte: new Date("2026-04-15T00:00:00.000Z"),
          },
          stripeSubscriptionId: null,
        }),
      }),
    );
    expect(subscriptionFindManyMock).toHaveBeenNthCalledWith(
      7,
      expect.objectContaining({
        where: expect.objectContaining({
          periodEnd: {
            lte: new Date("2026-04-15T00:00:00.000Z"),
          },
          stripeSubscriptionId: null,
        }),
      }),
    );
  });
});
