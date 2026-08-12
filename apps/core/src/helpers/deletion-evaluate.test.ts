import { TaskX402PaymentStatus } from "@sokosumi/database";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  evaluateOrganizationDeletion,
  evaluateUserDeletion,
  throwIfOrganizationDeletionBlocked,
  throwIfUserDeletionBlocked,
} from "./deletion-evaluate";

const {
  taskPaymentClaimFindFirstMock,
  taskX402PaymentFindFirstMock,
  getMembersByOrganizationIdMock,
  isLastWorkspaceMock,
  captureMessageMock,
} = vi.hoisted(() => ({
  taskPaymentClaimFindFirstMock: vi.fn(),
  taskX402PaymentFindFirstMock: vi.fn(),
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
    taskX402Payment: {
      findFirst: taskX402PaymentFindFirstMock,
    },
  };
}

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
    taskX402PaymentFindFirstMock.mockResolvedValue(null);
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

  it("returns TASK_X402_PAYMENT_PENDING when a pending x402 payment exists", async () => {
    mockClaimLookups({ reviewRequired: null, pending: null });
    taskX402PaymentFindFirstMock.mockResolvedValue({ id: "x402_pending" });

    await expect(
      evaluateUserDeletion("user_delete", createPrisma() as never),
    ).resolves.toEqual({
      blockers: ["TASK_X402_PAYMENT_PENDING"],
      reviewRequiredClaim: null,
    });
    expect(taskX402PaymentFindFirstMock).toHaveBeenCalledWith({
      where: {
        status: TaskX402PaymentStatus.PENDING,
        OR: [
          { transaction: { userId: "user_delete" } },
          { refundTransaction: { userId: "user_delete" } },
          { task: { ownerId: "user_delete" } },
        ],
      },
      select: { id: true },
    });
  });

  it("lists claim blockers before x402 pending when both apply", async () => {
    mockClaimLookups({
      reviewRequired: null,
      pending: { id: "claim_pending" },
    });
    taskX402PaymentFindFirstMock.mockResolvedValue({ id: "x402_pending" });

    await expect(
      evaluateUserDeletion("user_delete", createPrisma() as never),
    ).resolves.toEqual({
      blockers: ["TASK_PAYMENT_CLAIM_PENDING", "TASK_X402_PAYMENT_PENDING"],
      reviewRequiredClaim: null,
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

  it("throws TASK_X402_PAYMENT_PENDING without paging Sentry", () => {
    expect(() =>
      throwIfUserDeletionBlocked("user_delete", {
        blockers: ["TASK_X402_PAYMENT_PENDING"],
        reviewRequiredClaim: null,
      }),
    ).toThrow(
      expect.objectContaining({
        status: "BAD_REQUEST",
        body: expect.objectContaining({
          code: "TASK_X402_PAYMENT_PENDING",
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
  });

  it("returns empty when no extra members and not last workspace", async () => {
    await expect(
      evaluateOrganizationDeletion("org-1", "user-1", {} as never),
    ).resolves.toEqual({ blockers: [] });
  });

  it("returns ORGANIZATION_HAS_ADDITIONAL_MEMBERS when others remain", async () => {
    getMembersByOrganizationIdMock.mockResolvedValue([
      { userId: "user-1" },
      { userId: "user-2" },
    ]);

    await expect(
      evaluateOrganizationDeletion("org-1", "user-1", {} as never),
    ).resolves.toEqual({
      blockers: ["ORGANIZATION_HAS_ADDITIONAL_MEMBERS"],
    });
  });

  it("returns LAST_WORKSPACE when this is the actor's last workspace", async () => {
    isLastWorkspaceMock.mockResolvedValue(true);

    await expect(
      evaluateOrganizationDeletion("org-1", "user-1", {} as never),
    ).resolves.toEqual({
      blockers: ["LAST_WORKSPACE"],
    });
    expect(isLastWorkspaceMock).toHaveBeenCalledWith(
      "user-1",
      { type: "organization", organizationId: "org-1" },
      {},
    );
  });

  it("returns both organization blockers when several apply at once", async () => {
    getMembersByOrganizationIdMock.mockResolvedValue([
      { userId: "user-1" },
      { userId: "user-2" },
    ]);
    isLastWorkspaceMock.mockResolvedValue(true);

    await expect(
      evaluateOrganizationDeletion("org-1", "user-1", {} as never),
    ).resolves.toEqual({
      blockers: ["ORGANIZATION_HAS_ADDITIONAL_MEMBERS", "LAST_WORKSPACE"],
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
});
