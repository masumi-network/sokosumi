import type { CreditBucketReferenceType, Prisma } from "@sokosumi/database";

import { isCreditBucketReferenceUniqueConstraintError } from "@/helpers/prisma";
import prisma from "@/lib/db/prisma";
import { markOutOfCreditsTasksAsToppedUp } from "@/services/task-topup.service";

/**
 * Credits a CMO payment grants a Cuso's Project (ADR 0068): a plan's month or
 * a top-up pack. The plan grant, the top-up and the yearly grant job share it;
 * only the reference type and the expiry differ.
 */
export interface CmoCreditGrant {
  amount: bigint;
  expiresAt: Date;
  organizationId: string;
  projectId: string;
  /** `<orderId>:<monthIndex>`: the bucket's unique key with the type. */
  referenceId: string;
  referenceNote: string;
  referenceType: CreditBucketReferenceType;
}

/**
 * Grants the credits, with `alsoWrite` in the same transaction, and frees the
 * Project's tasks that waited for credits. The grant rides on the bucket's
 * unique key: a redelivered or raced payment ends there and grants nothing
 * more (`already_granted`).
 */
export async function grantCmoCredits(
  grant: CmoCreditGrant,
  alsoWrite?: (tx: Prisma.TransactionClient) => Promise<void>,
): Promise<"granted" | "already_granted"> {
  const { amount, organizationId, projectId } = grant;
  try {
    await prisma.$transaction(async (tx) => {
      await tx.transaction.create({
        data: {
          amount,
          organizationId,
          userId: null,
          sourceCreditBucket: {
            create: {
              amount,
              expiresAt: grant.expiresAt,
              organizationId,
              projectId,
              referenceId: grant.referenceId,
              referenceNote: grant.referenceNote,
              referenceType: grant.referenceType,
              userId: null,
            },
          },
        },
      });
      await alsoWrite?.(tx);
      await markOutOfCreditsTasksAsToppedUp({
        organizationId,
        projectId,
        tx,
        userId: null,
      });
    });
    return "granted";
  } catch (error) {
    if (!isCreditBucketReferenceUniqueConstraintError(error)) throw error;
    return "already_granted";
  }
}
