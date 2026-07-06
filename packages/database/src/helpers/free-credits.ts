import { convertCreditsToCents } from "@sokosumi/utils";

import {
  CreditBucketReferenceType,
  type Prisma,
} from "../generated/prisma/client.js";
import { buildFreeCreditReferenceId } from "./credit.js";

export interface GrantFreeCreditsParams {
  credits: number;
  expiresAt: Date | null;
  organizationId: string | null;
  referenceNote: string | null;
  targetId: string;
  targetType: "user" | "organization";
  transactionUserId: string;
}

export interface GrantFreeCreditsResult {
  bucketId: string;
}

export async function grantFreeCredits(
  params: GrantFreeCreditsParams,
  tx: Prisma.TransactionClient,
): Promise<GrantFreeCreditsResult> {
  if (
    !Number.isFinite(params.credits) ||
    !Number.isInteger(params.credits) ||
    params.credits <= 0
  ) {
    throw new Error("Free credits must be a positive integer");
  }

  if (params.targetType === "user" && params.organizationId !== null) {
    throw new Error("User free credits cannot be scoped to an organization");
  }

  if (params.targetType === "organization" && params.organizationId === null) {
    throw new Error("Organization free credits require an organization id");
  }

  const referenceId = buildFreeCreditReferenceId({
    targetId: params.targetId,
    targetType: params.targetType,
  });
  const amount = convertCreditsToCents(params.credits);
  const bucketUserId = params.targetType === "user" ? params.targetId : null;

  const transaction = await tx.transaction.create({
    data: {
      amount,
      ...(params.organizationId && {
        organization: {
          connect: {
            id: params.organizationId,
          },
        },
      }),
      sourceCreditBucket: {
        create: {
          amount,
          expiresAt: params.expiresAt,
          organizationId: params.organizationId,
          referenceId,
          referenceNote: params.referenceNote,
          referenceType: CreditBucketReferenceType.FREE,
          userId: bucketUserId,
        },
      },
      user: {
        connect: {
          id: params.transactionUserId,
        },
      },
    },
    select: {
      sourceCreditBucket: {
        select: { id: true },
      },
    },
  });

  const bucketId = transaction.sourceCreditBucket?.id;
  if (!bucketId) {
    throw new Error("Failed to create free credit bucket");
  }

  return { bucketId };
}
