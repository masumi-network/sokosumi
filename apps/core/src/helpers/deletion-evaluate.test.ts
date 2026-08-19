import { MemberRole, TaskX402PaymentStatus } from "@sokosumi/database";
import {
  finalizedAgentJobStatuses,
  finalizedOnChainJobStatuses,
} from "@sokosumi/database/types/job";
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
  taskX402PaymentFindFirstMock,
  memberFindFirstMock,
  jobFindFirstMock,
  taskFindFirstMock,
  getMembersByOrganizationIdMock,
  isLastWorkspaceMock,
  captureMessageMock,
} = vi.hoisted(() => ({
  taskPaymentClaimFindFirstMock: vi.fn(),
  subscriptionFindFirstMock: vi.fn(),
  enterpriseContractFindFirstMock: vi.fn(),
  taskX402PaymentFindFirstMock: vi.fn(),
  memberFindFirstMock: vi.fn(),
  jobFindFirstMock: vi.fn(),
  taskFindFirstMock: vi.fn(),
  getMembersByOrganizationIdMock: vi.fn(),
  isLastWorkspaceMock: vi.fn(),
  captureMessageMock: vi.fn(),
}));

vi.mock("@sentry/node", () => ({
  captureMessage: captureMessageMock,
}));

vi.mock("@/lib/blob", () => ({
  deleteTaskFileIfOwned: vi.fn(),
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
    member: {
      findFirst: memberFindFirstMock,
    },
    job: {
      findFirst: jobFindFirstMock,
    },
    task: {
      findFirst: taskFindFirstMock,
    },
    taskX402Payment: {
      findFirst: taskX402PaymentFindFirstMock,
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

function mockJobLookups(options: {
  inFlight?: { id: string } | null;
  unsettled?: { id: string } | null;
}) {
  jobFindFirstMock.mockImplementation(
    async ({ where }: { where: Record<string, unknown> }) => {
      if (where.events) {
        return options.inFlight ?? null;
      }
      if (where.purchase) {
        return options.unsettled ?? null;
      }
      return null;
    },
  );
}

const EMPTY_X402_EVALUATION = {
  pendingX402Payment: null,
  unresolvedX402Payment: null,
  foreignChargePayment: null,
} as const;

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

function mockX402Lookups(options: {
  unresolved?: { id: string; status: string } | null;
  liveAuthorization?: { id: string } | null;
  foreignCharge?: {
    id: string;
    taskId: string;
    transaction: { userId: string };
  } | null;
}) {
  taskX402PaymentFindFirstMock.mockImplementation(
    async ({ where }: { where: Record<string, unknown> }) => {
      if (
        typeof where.status === "object" &&
        where.status !== null &&
        "notIn" in where.status
      ) {
        return options.unresolved ?? null;
      }
      if (where.xPaymentHeader) {
        return options.liveAuthorization ?? null;
      }
      return options.foreignCharge ?? null;
    },
  );
}

describe("evaluateUserDeletion", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    taskPaymentClaimFindFirstMock.mockResolvedValue(null);
    subscriptionFindFirstMock.mockResolvedValue(null);
    enterpriseContractFindFirstMock.mockResolvedValue(null);
    taskX402PaymentFindFirstMock.mockResolvedValue(null);
    memberFindFirstMock.mockResolvedValue(null);
    jobFindFirstMock.mockResolvedValue(null);
    taskFindFirstMock.mockResolvedValue(null);
    mockX402Lookups({});
  });

  it("returns empty when no payment-claim blockers apply", async () => {
    mockClaimLookups({ reviewRequired: null, pending: null });

    await expect(
      evaluateUserDeletion("user_delete", createPrisma() as never),
    ).resolves.toEqual({
      blockers: [],
      reviewRequiredClaim: null,
      ...EMPTY_X402_EVALUATION,
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
      ...EMPTY_X402_EVALUATION,
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
      ...EMPTY_X402_EVALUATION,
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
      ...EMPTY_X402_EVALUATION,
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

  it("returns TASK_X402_PAYMENT_PENDING when a pending x402 payment exists", async () => {
    mockClaimLookups({ reviewRequired: null, pending: null });
    mockX402Lookups({
      unresolved: { id: "x402_pending", status: TaskX402PaymentStatus.PENDING },
    });

    await expect(
      evaluateUserDeletion("user_delete", createPrisma() as never),
    ).resolves.toEqual({
      blockers: ["TASK_X402_PAYMENT_PENDING"],
      reviewRequiredClaim: null,
      pendingX402Payment: { id: "x402_pending" },
      unresolvedX402Payment: null,
      foreignChargePayment: null,
    });
  });

  it("lists claim blockers before x402 pending when both apply", async () => {
    mockClaimLookups({
      reviewRequired: null,
      pending: { id: "claim_pending" },
    });
    mockX402Lookups({
      unresolved: { id: "x402_pending", status: TaskX402PaymentStatus.PENDING },
    });

    await expect(
      evaluateUserDeletion("user_delete", createPrisma() as never),
    ).resolves.toEqual({
      blockers: ["TASK_PAYMENT_CLAIM_PENDING", "TASK_X402_PAYMENT_PENDING"],
      reviewRequiredClaim: null,
      pendingX402Payment: { id: "x402_pending" },
      unresolvedX402Payment: null,
      foreignChargePayment: null,
    });
  });

  it("returns USER_OWNS_ORGANIZATION while the User has Member role owner", async () => {
    memberFindFirstMock.mockResolvedValue({ id: "member_owner" });

    await expect(
      evaluateUserDeletion("user_delete", createPrisma() as never),
    ).resolves.toEqual({
      blockers: ["USER_OWNS_ORGANIZATION"],
      reviewRequiredClaim: null,
    });
    expect(memberFindFirstMock).toHaveBeenCalledWith({
      where: { userId: "user_delete", role: MemberRole.OWNER },
      select: { id: true },
    });
  });

  it("does not return USER_OWNS_ORGANIZATION for member-only", async () => {
    memberFindFirstMock.mockResolvedValue(null);

    await expect(
      evaluateUserDeletion("user_delete", createPrisma() as never),
    ).resolves.toEqual({
      blockers: [],
      reviewRequiredClaim: null,
    });
  });

  it("returns USER_OWNS_ORGANIZATION when the User still has owner role among multiple owners", async () => {
    memberFindFirstMock.mockResolvedValue({ id: "member_owner_self" });
    const memberCountMock = vi.fn();

    await expect(
      evaluateUserDeletion("user_delete", {
        ...createPrisma(),
        member: {
          findFirst: memberFindFirstMock,
          count: memberCountMock,
        },
      } as never),
    ).resolves.toEqual({
      blockers: ["USER_OWNS_ORGANIZATION"],
      reviewRequiredClaim: null,
    });
    expect(memberFindFirstMock).toHaveBeenCalledWith({
      where: { userId: "user_delete", role: MemberRole.OWNER },
      select: { id: true },
    });
    expect(memberCountMock).not.toHaveBeenCalled();
  });

  it("returns IN_FLIGHT_JOB when the User owns a Job with no terminal agent event", async () => {
    mockJobLookups({ inFlight: { id: "job_running" } });

    await expect(
      evaluateUserDeletion("user_delete", createPrisma() as never),
    ).resolves.toEqual({
      blockers: ["IN_FLIGHT_JOB"],
      reviewRequiredClaim: null,
    });
    expect(jobFindFirstMock).toHaveBeenCalledWith({
      where: {
        ownerId: "user_delete",
        events: {
          none: { status: { in: finalizedAgentJobStatuses } },
        },
      },
      select: { id: true },
    });
  });

  it("returns UNSETTLED_ON_CHAIN_JOB when the User owns a Job with a non-finalized purchase", async () => {
    mockJobLookups({ unsettled: { id: "job_locked" } });

    await expect(
      evaluateUserDeletion("user_delete", createPrisma() as never),
    ).resolves.toEqual({
      blockers: ["UNSETTLED_ON_CHAIN_JOB"],
      reviewRequiredClaim: null,
    });
    expect(jobFindFirstMock).toHaveBeenCalledWith({
      where: {
        ownerId: "user_delete",
        purchase: {
          OR: [
            { onChainStatus: { notIn: finalizedOnChainJobStatuses } },
            { onChainStatus: null },
          ],
        },
      },
      select: { id: true },
    });
  });

  it("returns IN_FLIGHT_TASK when the User owns a Task that is not terminal", async () => {
    taskFindFirstMock.mockResolvedValue({ id: "task_running" });

    await expect(
      evaluateUserDeletion("user_delete", createPrisma() as never),
    ).resolves.toEqual({
      blockers: ["IN_FLIGHT_TASK"],
      reviewRequiredClaim: null,
    });
    expect(taskFindFirstMock).toHaveBeenCalledWith({
      where: {
        ownerId: "user_delete",
        status: { notIn: ["COMPLETED", "FAILED", "CANCELED"] },
      },
      select: { id: true },
    });
  });

  it("returns user-owned in-flight Job and Task blockers regardless of organizationId", async () => {
    mockJobLookups({
      inFlight: { id: "job_other_org" },
      unsettled: { id: "job_other_org_locked" },
    });
    taskFindFirstMock.mockResolvedValue({ id: "task_other_org" });

    await expect(
      evaluateUserDeletion("user_delete", createPrisma() as never),
    ).resolves.toEqual({
      blockers: ["IN_FLIGHT_JOB", "UNSETTLED_ON_CHAIN_JOB", "IN_FLIGHT_TASK"],
      reviewRequiredClaim: null,
    });
    expect(jobFindFirstMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ ownerId: "user_delete" }),
      }),
    );
    expect(jobFindFirstMock).not.toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ organizationId: expect.anything() }),
      }),
    );
    expect(taskFindFirstMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ ownerId: "user_delete" }),
      }),
    );
  });

  it("does not return work blockers when Jobs and Tasks are terminal and on-chain is finalized", async () => {
    mockJobLookups({ inFlight: null, unsettled: null });
    taskFindFirstMock.mockResolvedValue(null);

    await expect(
      evaluateUserDeletion("user_delete", createPrisma() as never),
    ).resolves.toEqual({
      blockers: [],
      reviewRequiredClaim: null,
    });
  });

  it("returns owner-role, in-flight work, and claim blockers together", async () => {
    const reviewRequiredAt = new Date("2026-08-04T10:00:00.000Z");
    memberFindFirstMock.mockResolvedValue({ id: "member_owner" });
    mockJobLookups({
      inFlight: { id: "job_running" },
      unsettled: { id: "job_locked" },
    });
    taskFindFirstMock.mockResolvedValue({ id: "task_running" });
    mockClaimLookups({
      reviewRequired: { id: "claim_review", reviewRequiredAt },
      pending: { id: "claim_pending" },
    });

    await expect(
      evaluateUserDeletion("user_delete", createPrisma() as never),
    ).resolves.toEqual({
      blockers: [
        "USER_OWNS_ORGANIZATION",
        "IN_FLIGHT_JOB",
        "UNSETTLED_ON_CHAIN_JOB",
        "IN_FLIGHT_TASK",
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
        ...EMPTY_X402_EVALUATION,
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
        ...EMPTY_X402_EVALUATION,
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
        ...EMPTY_X402_EVALUATION,
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

  it("throws TASK_X402_PAYMENT_PENDING and pages Sentry with the resolve endpoint", () => {
    expect(() =>
      throwIfUserDeletionBlocked("user_delete", {
        blockers: ["TASK_X402_PAYMENT_PENDING"],
        reviewRequiredClaim: null,
        pendingX402Payment: { id: "x402_pending" },
        unresolvedX402Payment: null,
        foreignChargePayment: null,
      }),
    ).toThrow(
      expect.objectContaining({
        status: "BAD_REQUEST",
        body: expect.objectContaining({
          code: "TASK_X402_PAYMENT_PENDING",
        }),
      }),
    );
    expect(captureMessageMock).toHaveBeenCalledWith(
      "Account deletion blocked by a pending x402 task payment",
      expect.objectContaining({
        extra: expect.objectContaining({
          taskX402PaymentId: "x402_pending",
          resolveEndpoint:
            "POST /v1/admin/task-x402-payments/x402_pending/resolve",
        }),
      }),
    );
  });

  it("throws RUNNING_SUBSCRIPTION without paging Sentry", () => {
    expect(() =>
      throwIfUserDeletionBlocked("user_delete", {
        blockers: ["RUNNING_SUBSCRIPTION"],
        reviewRequiredClaim: null,
        ...EMPTY_X402_EVALUATION,
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
    jobFindFirstMock.mockResolvedValue(null);
    taskFindFirstMock.mockResolvedValue(null);
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

  it("returns IN_FLIGHT_JOB when the Organization has a Job with no terminal agent event", async () => {
    mockJobLookups({ inFlight: { id: "job_running" } });

    await expect(
      evaluateOrganizationDeletion("org-1", "user-1", createPrisma() as never),
    ).resolves.toEqual({
      blockers: ["IN_FLIGHT_JOB"],
    });
    expect(jobFindFirstMock).toHaveBeenCalledWith({
      where: {
        organizationId: "org-1",
        events: {
          none: { status: { in: finalizedAgentJobStatuses } },
        },
      },
      select: { id: true },
    });
  });

  it("returns UNSETTLED_ON_CHAIN_JOB when the Organization has a Job with a non-finalized purchase", async () => {
    mockJobLookups({ unsettled: { id: "job_locked" } });

    await expect(
      evaluateOrganizationDeletion("org-1", "user-1", createPrisma() as never),
    ).resolves.toEqual({
      blockers: ["UNSETTLED_ON_CHAIN_JOB"],
    });
    expect(jobFindFirstMock).toHaveBeenCalledWith({
      where: {
        organizationId: "org-1",
        purchase: {
          OR: [
            { onChainStatus: { notIn: finalizedOnChainJobStatuses } },
            { onChainStatus: null },
          ],
        },
      },
      select: { id: true },
    });
  });

  it("returns IN_FLIGHT_TASK when the Organization has a Task that is not terminal", async () => {
    taskFindFirstMock.mockResolvedValue({ id: "task_running" });

    await expect(
      evaluateOrganizationDeletion("org-1", "user-1", createPrisma() as never),
    ).resolves.toEqual({
      blockers: ["IN_FLIGHT_TASK"],
    });
    expect(taskFindFirstMock).toHaveBeenCalledWith({
      where: {
        organizationId: "org-1",
        status: { notIn: ["COMPLETED", "FAILED", "CANCELED"] },
      },
      select: { id: true },
    });
  });

  it("does not return work blockers when Organization Jobs and Tasks are terminal and on-chain is finalized", async () => {
    mockJobLookups({ inFlight: null, unsettled: null });
    taskFindFirstMock.mockResolvedValue(null);

    await expect(
      evaluateOrganizationDeletion("org-1", "user-1", createPrisma() as never),
    ).resolves.toEqual({ blockers: [] });
  });

  it("returns extra-members, last-workspace, and in-flight work blockers together", async () => {
    getMembersByOrganizationIdMock.mockResolvedValue([
      { userId: "user-1" },
      { userId: "user-2" },
    ]);
    isLastWorkspaceMock.mockResolvedValue(true);
    mockJobLookups({
      inFlight: { id: "job_running" },
      unsettled: { id: "job_locked" },
    });
    taskFindFirstMock.mockResolvedValue({ id: "task_running" });

    await expect(
      evaluateOrganizationDeletion("org-1", "user-1", createPrisma() as never),
    ).resolves.toEqual({
      blockers: [
        "ORGANIZATION_HAS_ADDITIONAL_MEMBERS",
        "LAST_WORKSPACE",
        "IN_FLIGHT_JOB",
        "UNSETTLED_ON_CHAIN_JOB",
        "IN_FLIGHT_TASK",
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
});
