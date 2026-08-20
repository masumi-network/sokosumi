import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  evaluateOrganizationDeletion,
  evaluateUserDeletion,
  throwIfOrganizationDeletionBlocked,
  throwIfUserDeletionBlocked,
} from "./deletion-evaluate";

const {
  taskPaymentClaimFindFirstMock,
  subscriptionFindFirstMock,
  enterpriseContractFindFirstMock,
  getMembersByOrganizationIdMock,
  isLastWorkspaceMock,
  captureMessageMock,
} = vi.hoisted(() => ({
  taskPaymentClaimFindFirstMock: vi.fn(),
  subscriptionFindFirstMock: vi.fn(),
  enterpriseContractFindFirstMock: vi.fn(),
  getMembersByOrganizationIdMock: vi.fn(),
  isLastWorkspaceMock: vi.fn(),
  captureMessageMock: vi.fn(),
}));

vi.mock("@sentry/node", () => ({
  captureMessage: captureMessageMock,
}));

vi.mock("@/helpers/workspace-access", () => ({
  isLastWorkspace: (...args: unknown[]) => isLastWorkspaceMock(...args),
}));

vi.mock("@sokosumi/database/repositories", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@sokosumi/database/repositories")>();
  return {
    ...actual,
    memberRepository: {
      ...actual.memberRepository,
      getMembersByOrganizationId: (...args: unknown[]) =>
        getMembersByOrganizationIdMock(...args),
    },
  };
});

function createPrisma() {
  return {
    taskPaymentClaim: {
      findFirst: taskPaymentClaimFindFirstMock,
    },
    subscription: {
      findFirst: subscriptionFindFirstMock,
    },
    enterpriseContract: {
      findFirst: enterpriseContractFindFirstMock,
    },
  };
}

const RUNNING_SUBSCRIPTION_WHERE = {
  stripeSubscriptionId: { not: null },
  status: { in: ["active", "trialing", "past_due", "unpaid"] },
};

function mockClaimLookups(options: {
  reviewRequired?: { id: string; reviewRequiredAt: Date } | null;
  pending?: { id: string } | null;
}) {
  taskPaymentClaimFindFirstMock.mockImplementation(
    async ({ where }: { where: Record<string, unknown> }) => {
      if (
        where.reviewRequiredAt &&
        typeof where.reviewRequiredAt === "object" &&
        where.reviewRequiredAt !== null &&
        "not" in where.reviewRequiredAt
      ) {
        return options.reviewRequired ?? null;
      }
      return options.pending ?? null;
    },
  );
}

describe("evaluateUserDeletion", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    taskPaymentClaimFindFirstMock.mockResolvedValue(null);
    subscriptionFindFirstMock.mockResolvedValue(null);
    enterpriseContractFindFirstMock.mockResolvedValue(null);
  });

  it("returns empty when no payment-claim blockers apply", async () => {
    mockClaimLookups({ reviewRequired: null, pending: null });

    await expect(
      evaluateUserDeletion("user_delete", createPrisma() as never),
    ).resolves.toEqual({
      blockers: [],
      reviewRequiredClaim: null,
    });
  });

  it("returns TASK_PAYMENT_CLAIM_PENDING when a plain pending claim exists", async () => {
    mockClaimLookups({
      reviewRequired: null,
      pending: { id: "claim_pending" },
    });

    await expect(
      evaluateUserDeletion("user_delete", createPrisma() as never),
    ).resolves.toEqual({
      blockers: ["TASK_PAYMENT_CLAIM_PENDING"],
      reviewRequiredClaim: null,
    });
  });

  it("returns TASK_PAYMENT_CLAIM_REVIEW_REQUIRED when a review-required claim exists", async () => {
    const reviewRequiredAt = new Date("2026-08-04T10:00:00.000Z");
    mockClaimLookups({
      reviewRequired: { id: "claim_review", reviewRequiredAt },
    });

    await expect(
      evaluateUserDeletion("user_delete", createPrisma() as never),
    ).resolves.toEqual({
      blockers: ["TASK_PAYMENT_CLAIM_REVIEW_REQUIRED"],
      reviewRequiredClaim: {
        id: "claim_review",
        reviewRequiredAt,
      },
    });
  });

  it("returns both claim blockers when several apply at once", async () => {
    const reviewRequiredAt = new Date("2026-08-04T10:00:00.000Z");
    mockClaimLookups({
      reviewRequired: { id: "claim_review", reviewRequiredAt },
      pending: { id: "claim_pending" },
    });

    await expect(
      evaluateUserDeletion("user_delete", createPrisma() as never),
    ).resolves.toEqual({
      blockers: [
        "TASK_PAYMENT_CLAIM_REVIEW_REQUIRED",
        "TASK_PAYMENT_CLAIM_PENDING",
      ],
      reviewRequiredClaim: {
        id: "claim_review",
        reviewRequiredAt,
      },
    });
  });

  it("returns RUNNING_SUBSCRIPTION for a paid Stripe subscription in an active status", async () => {
    mockClaimLookups({ reviewRequired: null, pending: null });
    subscriptionFindFirstMock.mockResolvedValue({ id: "sub_paid" });

    await expect(
      evaluateUserDeletion("user_delete", createPrisma() as never),
    ).resolves.toEqual({
      blockers: ["RUNNING_SUBSCRIPTION"],
      reviewRequiredClaim: null,
    });
    expect(subscriptionFindFirstMock).toHaveBeenCalledWith({
      where: {
        referenceId: "user_delete",
        ...RUNNING_SUBSCRIPTION_WHERE,
      },
      select: { id: true },
    });
  });

  it("returns RUNNING_SUBSCRIPTION when cancelAtPeriodEnd is still in the paid period", async () => {
    mockClaimLookups({ reviewRequired: null, pending: null });
    subscriptionFindFirstMock.mockResolvedValue({
      id: "sub_cancel_at_period_end",
    });

    await expect(
      evaluateUserDeletion("user_delete", createPrisma() as never),
    ).resolves.toEqual({
      blockers: ["RUNNING_SUBSCRIPTION"],
      reviewRequiredClaim: null,
    });
  });

  it("does not return RUNNING_SUBSCRIPTION for a local free subscription", async () => {
    mockClaimLookups({ reviewRequired: null, pending: null });
    subscriptionFindFirstMock.mockResolvedValue(null);

    await expect(
      evaluateUserDeletion("user_delete", createPrisma() as never),
    ).resolves.toEqual({
      blockers: [],
      reviewRequiredClaim: null,
    });
    expect(subscriptionFindFirstMock).toHaveBeenCalledWith({
      where: {
        referenceId: "user_delete",
        ...RUNNING_SUBSCRIPTION_WHERE,
      },
      select: { id: true },
    });
  });

  it("does not return RUNNING_SUBSCRIPTION for a canceled or ended paid subscription", async () => {
    mockClaimLookups({ reviewRequired: null, pending: null });
    subscriptionFindFirstMock.mockResolvedValue(null);

    await expect(
      evaluateUserDeletion("user_delete", createPrisma() as never),
    ).resolves.toEqual({
      blockers: [],
      reviewRequiredClaim: null,
    });
  });

  it("returns RUNNING_SUBSCRIPTION ahead of claim blockers when several apply", async () => {
    const reviewRequiredAt = new Date("2026-08-04T10:00:00.000Z");
    mockClaimLookups({
      reviewRequired: { id: "claim_review", reviewRequiredAt },
      pending: { id: "claim_pending" },
    });
    subscriptionFindFirstMock.mockResolvedValue({ id: "sub_paid" });

    await expect(
      evaluateUserDeletion("user_delete", createPrisma() as never),
    ).resolves.toEqual({
      blockers: [
        "RUNNING_SUBSCRIPTION",
        "TASK_PAYMENT_CLAIM_REVIEW_REQUIRED",
        "TASK_PAYMENT_CLAIM_PENDING",
      ],
      reviewRequiredClaim: {
        id: "claim_review",
        reviewRequiredAt,
      },
    });
  });
});

describe("throwIfUserDeletionBlocked", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("does nothing when evaluate is empty", () => {
    expect(() =>
      throwIfUserDeletionBlocked("user_delete", {
        blockers: [],
        reviewRequiredClaim: null,
      }),
    ).not.toThrow();
    expect(captureMessageMock).not.toHaveBeenCalled();
  });

  it("throws the first blocker and pages Sentry for review-required", () => {
    expect(() =>
      throwIfUserDeletionBlocked("user_delete", {
        blockers: [
          "TASK_PAYMENT_CLAIM_REVIEW_REQUIRED",
          "TASK_PAYMENT_CLAIM_PENDING",
        ],
        reviewRequiredClaim: {
          id: "claim_review",
          reviewRequiredAt: new Date("2026-08-04T10:00:00.000Z"),
        },
      }),
    ).toThrow(
      expect.objectContaining({
        status: "BAD_REQUEST",
        body: expect.objectContaining({
          code: "TASK_PAYMENT_CLAIM_REVIEW_REQUIRED",
        }),
      }),
    );
    expect(captureMessageMock).toHaveBeenCalledWith(
      "Account deletion blocked by a task payment claim awaiting review",
      expect.objectContaining({
        level: "error",
        extra: expect.objectContaining({
          userId: "user_delete",
          taskPaymentClaimId: "claim_review",
        }),
      }),
    );
  });

  it("throws TASK_PAYMENT_CLAIM_PENDING without paging Sentry", () => {
    expect(() =>
      throwIfUserDeletionBlocked("user_delete", {
        blockers: ["TASK_PAYMENT_CLAIM_PENDING"],
        reviewRequiredClaim: null,
      }),
    ).toThrow(
      expect.objectContaining({
        status: "BAD_REQUEST",
        body: expect.objectContaining({
          code: "TASK_PAYMENT_CLAIM_PENDING",
        }),
      }),
    );
    expect(captureMessageMock).not.toHaveBeenCalled();
  });

  it("throws RUNNING_SUBSCRIPTION without paging Sentry", () => {
    expect(() =>
      throwIfUserDeletionBlocked("user_delete", {
        blockers: ["RUNNING_SUBSCRIPTION"],
        reviewRequiredClaim: null,
      }),
    ).toThrow(
      expect.objectContaining({
        status: "BAD_REQUEST",
        body: expect.objectContaining({
          code: "RUNNING_SUBSCRIPTION",
          message:
            "Cancel your running subscription and wait until the paid period ends before deleting.",
        }),
      }),
    );
    expect(captureMessageMock).not.toHaveBeenCalled();
  });
});

describe("evaluateOrganizationDeletion", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getMembersByOrganizationIdMock.mockResolvedValue([{ userId: "user-1" }]);
    isLastWorkspaceMock.mockResolvedValue(false);
    subscriptionFindFirstMock.mockResolvedValue(null);
    enterpriseContractFindFirstMock.mockResolvedValue(null);
  });

  it("returns empty when no extra members and not last workspace", async () => {
    await expect(
      evaluateOrganizationDeletion("org-1", "user-1", createPrisma() as never),
    ).resolves.toEqual({ blockers: [] });
  });

  it("returns ORGANIZATION_HAS_ADDITIONAL_MEMBERS when others remain", async () => {
    getMembersByOrganizationIdMock.mockResolvedValue([
      { userId: "user-1" },
      { userId: "user-2" },
    ]);

    await expect(
      evaluateOrganizationDeletion("org-1", "user-1", createPrisma() as never),
    ).resolves.toEqual({
      blockers: ["ORGANIZATION_HAS_ADDITIONAL_MEMBERS"],
    });
  });

  it("returns LAST_WORKSPACE when this is the actor's last workspace", async () => {
    isLastWorkspaceMock.mockResolvedValue(true);
    const prisma = createPrisma();

    await expect(
      evaluateOrganizationDeletion("org-1", "user-1", prisma as never),
    ).resolves.toEqual({
      blockers: ["LAST_WORKSPACE"],
    });
    expect(isLastWorkspaceMock).toHaveBeenCalledWith(
      "user-1",
      { type: "organization", organizationId: "org-1" },
      prisma,
    );
  });

  it("returns both organization blockers when several apply at once", async () => {
    getMembersByOrganizationIdMock.mockResolvedValue([
      { userId: "user-1" },
      { userId: "user-2" },
    ]);
    isLastWorkspaceMock.mockResolvedValue(true);

    await expect(
      evaluateOrganizationDeletion("org-1", "user-1", createPrisma() as never),
    ).resolves.toEqual({
      blockers: ["ORGANIZATION_HAS_ADDITIONAL_MEMBERS", "LAST_WORKSPACE"],
    });
  });

  it("returns RUNNING_SUBSCRIPTION for a paid org Stripe subscription", async () => {
    subscriptionFindFirstMock.mockResolvedValue({ id: "sub_org_paid" });

    await expect(
      evaluateOrganizationDeletion("org-1", "user-1", createPrisma() as never),
    ).resolves.toEqual({
      blockers: ["RUNNING_SUBSCRIPTION"],
    });
    expect(subscriptionFindFirstMock).toHaveBeenCalledWith({
      where: {
        referenceId: "org-1",
        ...RUNNING_SUBSCRIPTION_WHERE,
      },
      select: { id: true },
    });
  });

  it("does not return RUNNING_SUBSCRIPTION for a local free org subscription", async () => {
    subscriptionFindFirstMock.mockResolvedValue(null);

    await expect(
      evaluateOrganizationDeletion("org-1", "user-1", createPrisma() as never),
    ).resolves.toEqual({ blockers: [] });
  });

  it("returns ENTERPRISE_CONTRACT_ACTIVE when an active enterprise contract exists", async () => {
    enterpriseContractFindFirstMock.mockResolvedValue({ id: "contract_1" });

    await expect(
      evaluateOrganizationDeletion("org-1", "user-1", createPrisma() as never),
    ).resolves.toEqual({
      blockers: ["ENTERPRISE_CONTRACT_ACTIVE"],
    });
    expect(enterpriseContractFindFirstMock).toHaveBeenCalledWith({
      where: {
        organizationId: "org-1",
        status: "active",
        activatedAt: { not: null },
      },
      select: { id: true },
    });
  });

  it("does not return ENTERPRISE_CONTRACT_ACTIVE without an active contract", async () => {
    enterpriseContractFindFirstMock.mockResolvedValue(null);

    await expect(
      evaluateOrganizationDeletion("org-1", "user-1", createPrisma() as never),
    ).resolves.toEqual({ blockers: [] });
  });

  it("returns subscription, enterprise, and existing blockers together", async () => {
    subscriptionFindFirstMock.mockResolvedValue({ id: "sub_org_paid" });
    enterpriseContractFindFirstMock.mockResolvedValue({ id: "contract_1" });
    getMembersByOrganizationIdMock.mockResolvedValue([
      { userId: "user-1" },
      { userId: "user-2" },
    ]);
    isLastWorkspaceMock.mockResolvedValue(true);

    await expect(
      evaluateOrganizationDeletion("org-1", "user-1", createPrisma() as never),
    ).resolves.toEqual({
      blockers: [
        "RUNNING_SUBSCRIPTION",
        "ENTERPRISE_CONTRACT_ACTIVE",
        "ORGANIZATION_HAS_ADDITIONAL_MEMBERS",
        "LAST_WORKSPACE",
      ],
    });
  });
});

describe("throwIfOrganizationDeletionBlocked", () => {
  it("does nothing when evaluate is empty", () => {
    expect(() =>
      throwIfOrganizationDeletionBlocked({ blockers: [] }),
    ).not.toThrow();
  });

  it("throws the first organization blocker", () => {
    expect(() =>
      throwIfOrganizationDeletionBlocked({
        blockers: ["ORGANIZATION_HAS_ADDITIONAL_MEMBERS", "LAST_WORKSPACE"],
      }),
    ).toThrow(
      expect.objectContaining({
        status: "BAD_REQUEST",
        body: expect.objectContaining({
          code: "ORGANIZATION_HAS_ADDITIONAL_MEMBERS",
          message:
            "Remove all other members before deleting this organization.",
        }),
      }),
    );
  });

  it("throws RUNNING_SUBSCRIPTION ahead of other organization blockers", () => {
    expect(() =>
      throwIfOrganizationDeletionBlocked({
        blockers: ["RUNNING_SUBSCRIPTION", "ENTERPRISE_CONTRACT_ACTIVE"],
      }),
    ).toThrow(
      expect.objectContaining({
        status: "BAD_REQUEST",
        body: expect.objectContaining({
          code: "RUNNING_SUBSCRIPTION",
          message:
            "Cancel your running subscription and wait until the paid period ends before deleting.",
        }),
      }),
    );
  });
});
