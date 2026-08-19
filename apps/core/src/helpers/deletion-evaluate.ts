import * as Sentry from "@sentry/node";
import {
  EnterpriseContractStatus,
  MemberRole,
  type Prisma,
  TaskPaymentClaimStatus,
  TaskStatus,
  TaskX402PaymentStatus,
} from "@sokosumi/database";
import type { createPrismaClient } from "@sokosumi/database/client";
import { ACTIVE_SUBSCRIPTION_STATUSES } from "@sokosumi/database/helpers";
import { memberRepository } from "@sokosumi/database/repositories";
import {
  finalizedAgentJobStatuses,
  finalizedOnChainJobStatuses,
} from "@sokosumi/database/types/job";
import { APIError } from "better-auth/api";

import { SWEEPABLE_X402_STATUSES } from "@/helpers/user-deletion-tasks";
import { isLastWorkspace } from "@/helpers/workspace-access";

type PrismaClient = ReturnType<typeof createPrismaClient>;

export const USER_DELETION_BLOCKER_CODES = [
  "RUNNING_SUBSCRIPTION",
  "USER_OWNS_ORGANIZATION",
  "IN_FLIGHT_JOB",
  "UNSETTLED_ON_CHAIN_JOB",
  "IN_FLIGHT_TASK",
  "TASK_PAYMENT_CLAIM_REVIEW_REQUIRED",
  "TASK_PAYMENT_CLAIM_PENDING",
  "TASK_X402_PAYMENT_PENDING",
  "TASK_X402_PAYMENT_UNRESOLVED",
  "TASK_X402_PAYMENT_AUTHORIZATION_LIVE",
  "TASK_X402_PAYMENT_BILLING_OWNER_MISMATCH",
] as const;

export type UserDeletionBlocker = (typeof USER_DELETION_BLOCKER_CODES)[number];

export const ORGANIZATION_DELETION_BLOCKER_CODES = [
  "RUNNING_SUBSCRIPTION",
  "ENTERPRISE_CONTRACT_ACTIVE",
  "ORGANIZATION_HAS_ADDITIONAL_MEMBERS",
  "LAST_WORKSPACE",
  "IN_FLIGHT_JOB",
  "UNSETTLED_ON_CHAIN_JOB",
  "IN_FLIGHT_TASK",
] as const;

export type OrganizationDeletionBlocker =
  (typeof ORGANIZATION_DELETION_BLOCKER_CODES)[number];

export interface UserDeletionEvaluation {
  blockers: UserDeletionBlocker[];
  reviewRequiredClaim: { id: string; reviewRequiredAt: Date } | null;
  pendingX402Payment: { id: string } | null;
  unresolvedX402Payment: { id: string; status: string } | null;
  foreignChargePayment: {
    id: string;
    taskId: string;
    chargedUserId: string;
  } | null;
}

export interface OrganizationDeletionEvaluation {
  blockers: OrganizationDeletionBlocker[];
}

const RUNNING_SUBSCRIPTION_MESSAGE =
  "Cancel your running subscription and wait until the paid period ends before deleting.";

const USER_DELETION_MESSAGES: Record<UserDeletionBlocker, string> = {
  RUNNING_SUBSCRIPTION: RUNNING_SUBSCRIPTION_MESSAGE,
  USER_OWNS_ORGANIZATION:
    "Transfer ownership or delete every organization you own before deleting your account.",
  IN_FLIGHT_JOB:
    "Wait for in-flight jobs to finish before deleting your account.",
  UNSETTLED_ON_CHAIN_JOB:
    "Wait for on-chain job purchases to settle before deleting your account.",
  IN_FLIGHT_TASK:
    "Wait for in-flight tasks to finish before deleting your account.",
  TASK_PAYMENT_CLAIM_REVIEW_REQUIRED:
    "A task payment needs administrator review before your account can be deleted. Please contact support.",
  TASK_PAYMENT_CLAIM_PENDING:
    "Wait for pending task payments to settle before deleting your account.",
  TASK_X402_PAYMENT_PENDING:
    "A task payment is still pending; contact support to have it resolved, then delete your account again.",
  TASK_X402_PAYMENT_UNRESOLVED:
    "A task payment is in a state that blocks account deletion. Contact support, then delete your account again.",
  TASK_X402_PAYMENT_AUTHORIZATION_LIVE:
    "A signed task payment authorization is still live. Retry account deletion after it expires, or contact support.",
  TASK_X402_PAYMENT_BILLING_OWNER_MISMATCH:
    "A task payment has inconsistent billing ownership; contact support to repair it, then delete your account again.",
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
  IN_FLIGHT_JOB:
    "Wait for in-flight jobs on this organization to finish before deleting it.",
  UNSETTLED_ON_CHAIN_JOB:
    "Wait for on-chain job purchases on this organization to settle before deleting it.",
  IN_FLIGHT_TASK:
    "Wait for in-flight tasks on this organization to finish before deleting it.",
};

const IN_FLIGHT_TASK_STATUSES_EXCLUDED: TaskStatus[] = [
  TaskStatus.COMPLETED,
  TaskStatus.FAILED,
  TaskStatus.CANCELED,
];

function inFlightJobWhere(
  scope: Pick<Prisma.JobWhereInput, "ownerId" | "organizationId">,
): Prisma.JobWhereInput {
  return {
    ...scope,
    events: {
      none: { status: { in: finalizedAgentJobStatuses } },
    },
  };
}

function unsettledOnChainJobWhere(
  scope: Pick<Prisma.JobWhereInput, "ownerId" | "organizationId">,
): Prisma.JobWhereInput {
  return {
    ...scope,
    purchase: {
      OR: [
        { onChainStatus: { notIn: finalizedOnChainJobStatuses } },
        { onChainStatus: null },
      ],
    },
  };
}

function inFlightTaskWhere(
  scope: Pick<Prisma.TaskWhereInput, "ownerId" | "organizationId">,
): Prisma.TaskWhereInput {
  return {
    ...scope,
    status: { notIn: IN_FLIGHT_TASK_STATUSES_EXCLUDED },
  };
}

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
  const idSelect = { id: true } as const;
  const [
    runningSubscription,
    ownerMembership,
    inFlightJob,
    unsettledOnChainJob,
    inFlightTask,
    reviewRequiredClaim,
    pendingPaymentClaim,
  ] = await Promise.all([
    hasRunningPaidSubscription(userId, prisma),
    prisma.member.findFirst({
      where: { userId, role: MemberRole.OWNER },
      select: { id: true },
    }),
    prisma.job.findFirst({
      where: inFlightJobWhere({ ownerId: userId }),
      select: idSelect,
    }),
    prisma.job.findFirst({
      where: unsettledOnChainJobWhere({ ownerId: userId }),
      select: idSelect,
    }),
    prisma.task.findFirst({
      where: inFlightTaskWhere({ ownerId: userId }),
      select: idSelect,
    }),
    prisma.taskPaymentClaim.findFirst({
      where: {
        status: TaskPaymentClaimStatus.PENDING,
        reviewRequiredAt: { not: null },
        transaction: { userId },
      },
      select: { id: true, reviewRequiredAt: true },
    }),
    prisma.taskPaymentClaim.findFirst({
      where: {
        status: TaskPaymentClaimStatus.PENDING,
        reviewRequiredAt: null,
        transaction: { userId },
      },
      select: { id: true },
    }),
  ]);

  if (runningSubscription) {
    blockers.push("RUNNING_SUBSCRIPTION");
  }
  if (ownerMembership) {
    blockers.push("USER_OWNS_ORGANIZATION");
  }
  if (inFlightJob) {
    blockers.push("IN_FLIGHT_JOB");
  }
  if (unsettledOnChainJob) {
    blockers.push("UNSETTLED_ON_CHAIN_JOB");
  }
  if (inFlightTask) {
    blockers.push("IN_FLIGHT_TASK");
  }

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
  if (pendingPaymentClaim) {
    blockers.push("TASK_PAYMENT_CLAIM_PENDING");
  }

  const x402RestrictBranches = {
    OR: [
      { transaction: { userId } },
      { refundTransaction: { userId } },
      { task: { ownerId: userId } },
    ],
  } as const;

  // Unlocked preview of the same unresolved-status guard the wipe re-checks
  // under lock. PENDING and any future enum member share this predicate so
  // GET /deletion cannot advertise a wipe that prepareTasks will 400.
  const unresolvedX402Payment = await prisma.taskX402Payment.findFirst({
    where: {
      status: { notIn: [...SWEEPABLE_X402_STATUSES] },
      ...x402RestrictBranches,
    },
    select: { id: true, status: true },
  });
  const pendingX402Payment =
    unresolvedX402Payment?.status === TaskX402PaymentStatus.PENDING
      ? { id: unresolvedX402Payment.id }
      : null;
  const unresolvedX402 =
    unresolvedX402Payment &&
    unresolvedX402Payment.status !== TaskX402PaymentStatus.PENDING
      ? {
          id: unresolvedX402Payment.id,
          status: unresolvedX402Payment.status,
        }
      : null;
  if (pendingX402Payment) {
    blockers.push("TASK_X402_PAYMENT_PENDING");
  } else if (unresolvedX402) {
    blockers.push("TASK_X402_PAYMENT_UNRESOLVED");
  }

  const liveAuthorizationX402Payment = await prisma.taskX402Payment.findFirst({
    where: {
      xPaymentHeader: { not: null },
      AND: [
        {
          OR: [{ validBefore: null }, { validBefore: { gt: new Date() } }],
        },
        x402RestrictBranches,
      ],
    },
    select: { id: true },
  });
  if (liveAuthorizationX402Payment) {
    blockers.push("TASK_X402_PAYMENT_AUTHORIZATION_LIVE");
  }

  const foreignChargeRow = await prisma.taskX402Payment.findFirst({
    where: {
      status: { in: [...SWEEPABLE_X402_STATUSES] },
      transaction: { userId: { not: userId } },
      OR: [{ refundTransaction: { userId } }, { task: { ownerId: userId } }],
    },
    select: {
      id: true,
      taskId: true,
      transaction: { select: { userId: true } },
    },
  });
  const foreignChargePayment = foreignChargeRow
    ? {
        id: foreignChargeRow.id,
        taskId: foreignChargeRow.taskId,
        chargedUserId: foreignChargeRow.transaction.userId,
      }
    : null;
  if (foreignChargePayment) {
    blockers.push("TASK_X402_PAYMENT_BILLING_OWNER_MISMATCH");
  }

  return {
    blockers,
    reviewRequiredClaim: reviewRequired,
    pendingX402Payment,
    unresolvedX402Payment: unresolvedX402,
    foreignChargePayment,
  };
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
  const idSelect = { id: true } as const;
  const [
    runningSubscription,
    activeEnterpriseContract,
    members,
    lastWorkspace,
    inFlightJob,
    unsettledOnChainJob,
    inFlightTask,
  ] = await Promise.all([
    hasRunningPaidSubscription(organizationId, prisma),
    prisma.enterpriseContract.findFirst({
      where: {
        organizationId,
        status: EnterpriseContractStatus.active,
        activatedAt: { not: null },
      },
      select: { id: true },
    }),
    memberRepository.getMembersByOrganizationId(organizationId, prisma),
    isLastWorkspace(
      actorUserId,
      { type: "organization", organizationId },
      prisma,
    ),
    prisma.job.findFirst({
      where: inFlightJobWhere({ organizationId }),
      select: idSelect,
    }),
    prisma.job.findFirst({
      where: unsettledOnChainJobWhere({ organizationId }),
      select: idSelect,
    }),
    prisma.task.findFirst({
      where: inFlightTaskWhere({ organizationId }),
      select: idSelect,
    }),
  ]);

  if (runningSubscription) {
    blockers.push("RUNNING_SUBSCRIPTION");
  }
  if (activeEnterpriseContract) {
    blockers.push("ENTERPRISE_CONTRACT_ACTIVE");
  }
  if (members.some((member) => member.userId !== actorUserId)) {
    blockers.push("ORGANIZATION_HAS_ADDITIONAL_MEMBERS");
  }
  if (lastWorkspace) {
    blockers.push("LAST_WORKSPACE");
  }
  if (inFlightJob) {
    blockers.push("IN_FLIGHT_JOB");
  }
  if (unsettledOnChainJob) {
    blockers.push("UNSETTLED_ON_CHAIN_JOB");
  }
  if (inFlightTask) {
    blockers.push("IN_FLIGHT_TASK");
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
  } else if (code === "TASK_X402_PAYMENT_PENDING") {
    Sentry.captureMessage(
      "Account deletion blocked by a pending x402 task payment",
      {
        level: "error",
        tags: { error_type: "user_deletion_blocked_by_x402_pending" },
        extra: {
          userId,
          taskX402PaymentId: evaluation.pendingX402Payment?.id,
          resolveEndpoint: evaluation.pendingX402Payment
            ? `POST /v1/admin/task-x402-payments/${evaluation.pendingX402Payment.id}/resolve`
            : undefined,
        },
      },
    );
  } else if (code === "TASK_X402_PAYMENT_UNRESOLVED") {
    Sentry.captureMessage(
      "Account deletion blocked by an x402 task payment in an unhandled status",
      {
        level: "error",
        tags: { error_type: "user_deletion_blocked_by_x402_unhandled" },
        extra: {
          userId,
          taskX402PaymentId: evaluation.unresolvedX402Payment?.id,
          status: evaluation.unresolvedX402Payment?.status,
        },
      },
    );
  } else if (code === "TASK_X402_PAYMENT_BILLING_OWNER_MISMATCH") {
    Sentry.captureMessage(
      "Account deletion would remove a task x402 payment charged to another user",
      {
        level: "error",
        tags: { error_type: "user_deletion_x402_payment_foreign_charge" },
        extra: {
          userId,
          taskX402PaymentId: evaluation.foreignChargePayment?.id,
          taskId: evaluation.foreignChargePayment?.taskId,
          chargedUserId: evaluation.foreignChargePayment?.chargedUserId,
          repair:
            "No admin endpoint clears this. Repair the ownership mismatch manually (align Task.ownerId with the charge Transaction's userId, or reassign the charge), then have the user retry deletion.",
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
