import {
  CreditBucketReferenceType,
  type Prisma,
  TaskPaymentClaimStatus,
} from "@sokosumi/database";

import prisma from "@/lib/db/prisma";

const MAX_FAILURE_REASON_LENGTH = 2_000;

interface CreateTaskPaymentClaimInput {
  blockchainIdentifier: string;
  taskEventId: string;
  transactionId: string;
  tx: {
    taskPaymentClaim: Pick<
      Prisma.TransactionClient["taskPaymentClaim"],
      "create"
    >;
  };
}

/**
 * Claims one seller-provided blockchain identifier in the same transaction as
 * the task credit debit. The unique identifier prevents request replays and
 * concurrent deliveries from charging twice.
 */
export async function createTaskPaymentClaim(
  input: CreateTaskPaymentClaimInput,
): Promise<string> {
  const claim = await input.tx.taskPaymentClaim.create({
    data: {
      blockchainIdentifier: input.blockchainIdentifier,
      taskEventId: input.taskEventId,
      transactionId: input.transactionId,
    },
    select: { id: true },
  });
  return claim.id;
}

export async function markTaskPaymentClaimPurchased(
  claimId: string,
  externalPurchaseId: string,
): Promise<void> {
  const updated = await prisma.taskPaymentClaim.updateMany({
    where: {
      id: claimId,
      status: TaskPaymentClaimStatus.PENDING,
    },
    data: {
      status: TaskPaymentClaimStatus.PURCHASED,
      externalPurchaseId,
      failureReason: null,
    },
  });
  if (updated.count !== 1) {
    throw new Error(`Task payment claim ${claimId} is no longer pending`);
  }
}

/**
 * Restores a failed task payment's full debit as a non-expiring refund bucket.
 * Claim status and refund transaction commit atomically; repeated calls are
 * no-ops after the first refund.
 */
export async function refundFailedTaskPaymentClaim(
  claimId: string,
  failureReason: string,
): Promise<boolean> {
  return await prisma.$transaction(async (tx) => {
    const claimed = await tx.taskPaymentClaim.updateMany({
      where: {
        id: claimId,
        status: TaskPaymentClaimStatus.PENDING,
      },
      data: {
        status: TaskPaymentClaimStatus.REFUNDED,
        failureReason: failureReason.slice(0, MAX_FAILURE_REASON_LENGTH),
      },
    });

    const claim = await tx.taskPaymentClaim.findUnique({
      where: { id: claimId },
      select: {
        id: true,
        status: true,
        transaction: {
          select: {
            amount: true,
            userId: true,
            organizationId: true,
          },
        },
      },
    });
    if (!claim) {
      throw new Error(`Task payment claim ${claimId} not found`);
    }
    if (
      claimed.count === 0 &&
      claim.status === TaskPaymentClaimStatus.REFUNDED
    ) {
      return false;
    }
    if (claimed.count === 0) {
      throw new Error(`Task payment claim ${claimId} is already purchased`);
    }

    const refundAmount = claim.transaction.amount * -1n;
    if (refundAmount <= 0n) {
      throw new Error(`Task payment claim ${claimId} has no debit to refund`);
    }

    await tx.taskPaymentClaim.update({
      where: { id: claim.id },
      data: {
        refundTransaction: {
          create: {
            amount: refundAmount,
            user: { connect: { id: claim.transaction.userId } },
            ...(claim.transaction.organizationId
              ? {
                  organization: {
                    connect: { id: claim.transaction.organizationId },
                  },
                }
              : {}),
            sourceCreditBucket: {
              create: {
                amount: refundAmount,
                referenceId: `task-payment:${claim.id}`,
                referenceType: CreditBucketReferenceType.REFUND,
                user: { connect: { id: claim.transaction.userId } },
                expiresAt: null,
                ...(claim.transaction.organizationId
                  ? {
                      organization: {
                        connect: { id: claim.transaction.organizationId },
                      },
                    }
                  : {}),
              },
            },
          } satisfies Prisma.TransactionCreateInput,
        },
      },
    });
    return true;
  });
}
