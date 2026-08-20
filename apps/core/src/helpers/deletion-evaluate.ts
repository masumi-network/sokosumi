import * as Sentry from "@sentry/node";
import {
  EnterpriseContractStatus,
  TaskPaymentClaimStatus,
  TaskX402PaymentStatus,
} from "@sokosumi/database";
import type { createPrismaClient } from "@sokosumi/database/client";
import { ACTIVE_SUBSCRIPTION_STATUSES } from "@sokosumi/database/helpers";
import { memberRepository } from "@sokosumi/database/repositories";
import { APIError } from "better-auth/api";

import { isLastWorkspace } from "@/helpers/workspace-access";

type PrismaClient = ReturnType<typeof createPrismaClient>;

export const USER_DELETION_BLOCKER_CODES = [
  "RUNNING_SUBSCRIPTION",
  "TASK_PAYMENT_CLAIM_REVIEW_REQUIRED",
  "TASK_PAYMENT_CLAIM_PENDING",
  "TASK_X402_PAYMENT_PENDING",
] as const;

export type UserDeletionBlocker = (typeof USER_DELETION_BLOCKER_CODES)[number];

export const ORGANIZATION_DELETION_BLOCKER_CODES = [
  "RUNNING_SUBSCRIPTION",
  "ENTERPRISE_CONTRACT_ACTIVE",
  "ORGANIZATION_HAS_ADDITIONAL_MEMBERS",
  "LAST_WORKSPACE",
] as const;

export type OrganizationDeletionBlocker =
  (typeof ORGANIZATION_DELETION_BLOCKER_CODES)[number];

export interface UserDeletionEvaluation {
  blockers: UserDeletionBlocker[];
  reviewRequiredClaim: { id: string; reviewRequiredAt: Date } | null;
}

export interface OrganizationDeletionEvaluation {
  blockers: OrganizationDeletionBlocker[];
}

const RUNNING_SUBSCRIPTION_MESSAGE =
  "Cancel your running subscription and wait until the paid period ends before deleting.";

const USER_DELETION_MESSAGES: Record<UserDeletionBlocker, string> = {
  RUNNING_SUBSCRIPTION: RUNNING_SUBSCRIPTION_MESSAGE,
  TASK_PAYMENT_CLAIM_REVIEW_REQUIRED:
    "A task payment needs administrator review before your account can be deleted. Please contact support.",
  TASK_PAYMENT_CLAIM_PENDING:
    "Wait for pending task payments to settle before deleting your account.",
  TASK_X402_PAYMENT_PENDING:
    "Wait for pending task payments to settle before deleting your account.",
};

const ORGANIZATION_DELETION_MESSAGES: Record<
  OrganizationDeletionBlocker,
  string
> = {
  RUNNING_SUBSCRIPTION: RUNNING_SUBSCRIPTION_MESSAGE,
  ENTERPRISE_CONTRACT_ACTIVE:
    "This organization has an active enterprise contract and cannot be deleted.",
  ORGANIZATION_HAS_ADDITIONAL_MEMBERS:
    "Remove all other members before deleting this organization.",
  LAST_WORKSPACE: "Cannot delete the user's last workspace.",
};

async function hasRunningPaidSubscription(
  referenceId: string,
  prisma: PrismaClient,
): Promise<boolean> {
  const subscription = await prisma.subscription.findFirst({
    where: {
      referenceId,
      stripeSubscriptionId: { not: null },
      status: { in: [...ACTIVE_SUBSCRIPTION_STATUSES] },
    },
    select: { id: true },
  });
  return subscription != null;
}

/**
 * Current User-deletion blockers. Empty `blockers` means the existing wipe may
 * proceed. Order is throw-priority for submit-only clients.
 */
export async function evaluateUserDeletion(
  userId: string,
  prisma: PrismaClient,
): Promise<UserDeletionEvaluation> {
  const blockers: UserDeletionBlocker[] = [];

  if (await hasRunningPaidSubscription(userId, prisma)) {
    blockers.push("RUNNING_SUBSCRIPTION");
  }

  const reviewRequiredClaim = await prisma.taskPaymentClaim.findFirst({
    where: {
      status: TaskPaymentClaimStatus.PENDING,
      reviewRequiredAt: { not: null },
      transaction: { userId },
    },
    select: { id: true, reviewRequiredAt: true },
  });
  const reviewRequired =
    reviewRequiredClaim?.reviewRequiredAt != null
      ? {
          id: reviewRequiredClaim.id,
          reviewRequiredAt: reviewRequiredClaim.reviewRequiredAt,
        }
      : null;
  if (reviewRequired) {
    blockers.push("TASK_PAYMENT_CLAIM_REVIEW_REQUIRED");
  }

  const pendingPaymentClaim = await prisma.taskPaymentClaim.findFirst({
    where: {
      status: TaskPaymentClaimStatus.PENDING,
      reviewRequiredAt: null,
      transaction: { userId },
    },
    select: { id: true },
  });
  if (pendingPaymentClaim) {
    blockers.push("TASK_PAYMENT_CLAIM_PENDING");
  }

  // Same throw-priority as the claim guards above: evaluate reports this so
  // GET /deletion can show it, and beforeDelete throws before the wipe. The
  // task-owner branch matters because taskId is RESTRICT.
  const pendingX402Payment = await prisma.taskX402Payment.findFirst({
    where: {
      status: TaskX402PaymentStatus.PENDING,
      // refundTransaction should be impossible on a PENDING row (the refund
      // is written when status flips), but nothing DB-level forbids it and
      // the FK is RESTRICT — without this branch such a row would fail the
      // user cascade with a raw FK 500 instead of this clean 400.
      OR: [
        { transaction: { userId } },
        { refundTransaction: { userId } },
        { task: { ownerId: userId } },
      ],
    },
    select: { id: true },
  });
  if (pendingX402Payment) {
    blockers.push("TASK_X402_PAYMENT_PENDING");
  }

  return { blockers, reviewRequiredClaim: reviewRequired };
}

/**
 * Current Organization-deletion blockers for the acting owner. Empty means
 * the existing wipe may proceed. Order is throw-priority.
 */
export async function evaluateOrganizationDeletion(
  organizationId: string,
  actorUserId: string,
  prisma: PrismaClient,
): Promise<OrganizationDeletionEvaluation> {
  const blockers: OrganizationDeletionBlocker[] = [];

  if (await hasRunningPaidSubscription(organizationId, prisma)) {
    blockers.push("RUNNING_SUBSCRIPTION");
  }

  const activeEnterpriseContract = await prisma.enterpriseContract.findFirst({
    where: {
      organizationId,
      status: EnterpriseContractStatus.active,
      activatedAt: { not: null },
    },
    select: { id: true },
  });
  if (activeEnterpriseContract) {
    blockers.push("ENTERPRISE_CONTRACT_ACTIVE");
  }

  const members = await memberRepository.getMembersByOrganizationId(
    organizationId,
    prisma,
  );
  if (members.some((member) => member.userId !== actorUserId)) {
    blockers.push("ORGANIZATION_HAS_ADDITIONAL_MEMBERS");
  }

  if (
    await isLastWorkspace(
      actorUserId,
      { type: "organization", organizationId },
      prisma,
    )
  ) {
    blockers.push("LAST_WORKSPACE");
  }

  return { blockers };
}

export function throwIfUserDeletionBlocked(
  userId: string,
  evaluation: UserDeletionEvaluation,
): void {
  if (evaluation.blockers.length === 0) {
    return;
  }

  const code = evaluation.blockers[0];
  if (code === "TASK_PAYMENT_CLAIM_REVIEW_REQUIRED") {
    Sentry.captureMessage(
      "Account deletion blocked by a task payment claim awaiting review",
      {
        level: "error",
        tags: { error_type: "user_deletion_blocked_by_claim_review" },
        extra: {
          userId,
          taskPaymentClaimId: evaluation.reviewRequiredClaim?.id,
          reviewRequiredAt:
            evaluation.reviewRequiredClaim?.reviewRequiredAt.toISOString(),
        },
      },
    );
  }

  throw new APIError("BAD_REQUEST", {
    code,
    message: USER_DELETION_MESSAGES[code],
  });
}

export function throwIfOrganizationDeletionBlocked(
  evaluation: OrganizationDeletionEvaluation,
): void {
  if (evaluation.blockers.length === 0) {
    return;
  }

  const code = evaluation.blockers[0];
  throw new APIError("BAD_REQUEST", {
    code,
    message: ORGANIZATION_DELETION_MESSAGES[code],
  });
}
