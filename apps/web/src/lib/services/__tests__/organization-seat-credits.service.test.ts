import { buildOrganizationSeatAssignmentSubscriptionReferenceId } from "@sokosumi/database/helpers";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const countOrganizationSubscriptionPeriodSeatGrantsMock = vi.fn();
const hasOrganizationMemberSubscriptionPeriodGrantMock = vi.fn();
const resolveActiveSubscriptionByReferenceIdMock = vi.fn();
const getSubscriptionCatalogMock = vi.fn();
const subscriptionsRetrieveMock = vi.fn();

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

vi.mock("@/config/env.secrets", () => ({
  getEnvSecrets: () => ({
    STRIPE_SECRET_KEY: "sk_test_mock",
  }),
}));

vi.mock("@/lib/stripe/subscription-catalog", () => ({
  getSubscriptionCatalog: (...args: unknown[]) =>
    getSubscriptionCatalogMock(...args),
}));

vi.mock("stripe", () => ({
  __esModule: true,
  default: vi.fn(function MockStripe() {
    return {
      subscriptions: {
        retrieve: (...args: unknown[]) => subscriptionsRetrieveMock(...args),
      },
    };
  }),
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
    getSubscriptionCatalogMock.mockResolvedValue({
      starter: { credits: 100 },
    });
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
    tx.transaction.create.mockResolvedValue({});
  });

  it("grants one seat of subscription credits when unused slots remain", async () => {
    const { grantUnusedSeatSubscriptionCreditsIfEligible } = await import(
      "../organization-seat-credits.service"
    );

    const result = await grantUnusedSeatSubscriptionCreditsIfEligible(
      "org-1",
      "user-2",
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

  it("skips grant when all purchased seat slots already received credits", async () => {
    countOrganizationSubscriptionPeriodSeatGrantsMock.mockResolvedValue(5);

    const { grantUnusedSeatSubscriptionCreditsIfEligible } = await import(
      "../organization-seat-credits.service"
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
      "../organization-seat-credits.service"
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
      "../organization-seat-credits.service"
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
