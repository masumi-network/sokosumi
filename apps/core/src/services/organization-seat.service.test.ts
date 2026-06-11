import { buildOrganizationSeatAssignmentSubscriptionReferenceId } from "@sokosumi/database/helpers";
import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  countOrganizationSubscriptionPeriodSeatGrantsMock,
  hasOrganizationMemberSubscriptionPeriodGrantMock,
  resolveActiveSubscriptionByReferenceIdMock,
} = vi.hoisted(() => ({
  countOrganizationSubscriptionPeriodSeatGrantsMock: vi.fn(),
  hasOrganizationMemberSubscriptionPeriodGrantMock: vi.fn(),
  resolveActiveSubscriptionByReferenceIdMock: vi.fn(),
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

const SEAT_CREDITS_BY_PLAN = {
  pro: 10000,
  standard: 4000,
  starter: 100,
};

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
    tx.creditBucket.findUnique.mockResolvedValue(null);
    tx.task.findMany.mockResolvedValue([]);
    tx.transaction.create.mockResolvedValue({});
  });

  it("grants one seat of subscription credits when unused slots remain", async () => {
    const { grantUnusedSeatSubscriptionCreditsIfEligible } = await import(
      "./organization-seat.service"
    );

    const result = await grantUnusedSeatSubscriptionCreditsIfEligible(
      "org-1",
      "user-2",
      SEAT_CREDITS_BY_PLAN,
      tx as never,
    );

    expect(result).toEqual({
      creditsGranted: 100,
      granted: true,
    });
    expect(tx.transaction.create).toHaveBeenCalledOnce();
    expect(
      tx.transaction.create.mock.calls[0]?.[0]?.data.sourceCreditBucket,
    ).toMatchObject({
      create: expect.objectContaining({
        referenceId: buildOrganizationSeatAssignmentSubscriptionReferenceId(
          "user-2",
          "org-1",
          periodEnd,
        ),
        userId: "user-2",
        organizationId: "org-1",
        expiresAt: periodEnd,
      }),
    });
  });

  it("skips grant when no seat credits are provided", async () => {
    const { grantUnusedSeatSubscriptionCreditsIfEligible } = await import(
      "./organization-seat.service"
    );

    const result = await grantUnusedSeatSubscriptionCreditsIfEligible(
      "org-1",
      "user-2",
      undefined,
      tx as never,
    );

    expect(result).toEqual({
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
      SEAT_CREDITS_BY_PLAN,
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
      SEAT_CREDITS_BY_PLAN,
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
      SEAT_CREDITS_BY_PLAN,
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
