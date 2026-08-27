import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  countOrganizationSubscriptionPeriodSeatGrantsMock,
  hasOrganizationMemberSubscriptionPeriodGrantMock,
  resolveActiveSubscriptionByReferenceIdMock,
  getSubscriptionSeatCreditsMock,
} = vi.hoisted(() => ({
  countOrganizationSubscriptionPeriodSeatGrantsMock: vi.fn(),
  hasOrganizationMemberSubscriptionPeriodGrantMock: vi.fn(),
  resolveActiveSubscriptionByReferenceIdMock: vi.fn(),
  getSubscriptionSeatCreditsMock: vi.fn(),
}));

vi.mock("@/services/subscription-seat-credits.service", () => ({
  getSubscriptionSeatCredits: (...args: unknown[]) =>
    getSubscriptionSeatCreditsMock(...args),
}));

vi.mock("@sokosumi/database/helpers", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@sokosumi/database/helpers")>();

  return {
    ...actual,
    countOrganizationSubscriptionPeriodSeatGrants: (...args: unknown[]) =>
      countOrganizationSubscriptionPeriodSeatGrantsMock(...args),
    hasOrganizationMemberSubscriptionPeriodGrant: (...args: unknown[]) =>
      hasOrganizationMemberSubscriptionPeriodGrantMock(...args),
  };
});

vi.mock("@sokosumi/database/repositories", () => ({
  subscriptionRepository: {
    resolveActiveSubscriptionByReferenceId: (...args: unknown[]) =>
      resolveActiveSubscriptionByReferenceIdMock(...args),
  },
}));

describe("grantUnusedSeatSubscriptionCreditsIfEligible", () => {
  const periodEnd = new Date("2099-06-01T00:00:00.000Z");
  const tx = {
    creditBucket: {
      findUnique: vi.fn(),
    },
    transaction: {
      create: vi.fn(),
    },
    task: {
      findMany: vi.fn().mockResolvedValue([]),
    },
  };

  beforeEach(() => {
    vi.clearAllMocks();
    resolveActiveSubscriptionByReferenceIdMock.mockResolvedValue({
      plan: "starter",
      periodEnd,
      seats: 5,
      status: "active",
      stripeSubscriptionId: "sub_123",
    });
    countOrganizationSubscriptionPeriodSeatGrantsMock.mockResolvedValue(3);
    hasOrganizationMemberSubscriptionPeriodGrantMock.mockResolvedValue(false);
    getSubscriptionSeatCreditsMock.mockResolvedValue({
      pro: 10000,
      standard: 4000,
      starter: 100,
    });
    tx.creditBucket.findUnique.mockResolvedValue(null);
    tx.task.findMany.mockResolvedValue([]);
    tx.transaction.create.mockResolvedValue({});
  });

  it("does not mint unused-seat credits; assignment is access only", async () => {
    const { grantUnusedSeatSubscriptionCreditsIfEligible } = await import(
      "./organization-seat.service"
    );

    const result = await grantUnusedSeatSubscriptionCreditsIfEligible(
      "org-1",
      "user-2",
      tx as never,
    );

    expect(result).toEqual({
      creditsGranted: 0,
      granted: false,
    });
    expect(tx.transaction.create).not.toHaveBeenCalled();
    expect(getSubscriptionSeatCreditsMock).not.toHaveBeenCalled();
  });

  it("does not abort assignment when the Stripe catalog is unavailable", async () => {
    getSubscriptionSeatCreditsMock.mockRejectedValue(
      new Error("Missing credits metadata for starter plan"),
    );

    const { grantUnusedSeatSubscriptionCreditsIfEligible } = await import(
      "./organization-seat.service"
    );

    await expect(
      grantUnusedSeatSubscriptionCreditsIfEligible(
        "org-1",
        "user-2",
        tx as never,
      ),
    ).resolves.toEqual({
      creditsGranted: 0,
      granted: false,
    });
    expect(tx.transaction.create).not.toHaveBeenCalled();
  });

  it("skips grant when all purchased seat slots already received credits", async () => {
    countOrganizationSubscriptionPeriodSeatGrantsMock.mockResolvedValue(5);

    const { grantUnusedSeatSubscriptionCreditsIfEligible } = await import(
      "./organization-seat.service"
    );

    const result = await grantUnusedSeatSubscriptionCreditsIfEligible(
      "org-1",
      "user-2",
      tx as never,
    );

    expect(result).toEqual({
      creditsGranted: 0,
      granted: false,
    });
    expect(tx.transaction.create).not.toHaveBeenCalled();
  });

  it("skips grant when the member already has a subscription period bucket", async () => {
    hasOrganizationMemberSubscriptionPeriodGrantMock.mockResolvedValue(true);

    const { grantUnusedSeatSubscriptionCreditsIfEligible } = await import(
      "./organization-seat.service"
    );

    const result = await grantUnusedSeatSubscriptionCreditsIfEligible(
      "org-1",
      "user-2",
      tx as never,
    );

    expect(result).toEqual({
      creditsGranted: 0,
      granted: false,
    });
    expect(tx.transaction.create).not.toHaveBeenCalled();
  });

  it("skips grant for local free subscriptions", async () => {
    resolveActiveSubscriptionByReferenceIdMock.mockResolvedValue({
      plan: "free",
      periodEnd,
      seats: 5,
      status: "active",
      stripeSubscriptionId: null,
    });

    const { grantUnusedSeatSubscriptionCreditsIfEligible } = await import(
      "./organization-seat.service"
    );

    const result = await grantUnusedSeatSubscriptionCreditsIfEligible(
      "org-1",
      "user-2",
      tx as never,
    );

    expect(result).toEqual({
      creditsGranted: 0,
      granted: false,
    });
    expect(
      countOrganizationSubscriptionPeriodSeatGrantsMock,
    ).not.toHaveBeenCalled();
  });
});
