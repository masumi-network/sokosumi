import { convertCreditsToCents } from "@sokosumi/utils";

import {
  CreditBucketReferenceType,
  type Prisma,
} from "../generated/prisma/client.js";
import { buildSupportCreditReferenceId } from "./credit.js";

export interface GrantSupportCreditsParams {
  credits: number;
  expiresAt: Date | null;
  grantId: string;
  organizationId: string | null;
  referenceNote: string | null;
  targetId: string;
  targetType: "user" | "organization";
  transactionUserId: string;
}

export interface GrantSupportCreditsResult {
  bucketId: string;
}

export async function grantSupportCredits(
  params: GrantSupportCreditsParams,
  tx: Prisma.TransactionClient,
): Promise<GrantSupportCreditsResult> {
  if (
    !Number.isFinite(params.credits) ||
    !Number.isInteger(params.credits) ||
    params.credits <= 0
  ) {
    throw new Error("Support credits must be a positive integer");
  }

  if (params.targetType === "user" && params.organizationId !== null) {
    throw new Error("User support credits cannot be scoped to an organization");
  }

  if (params.targetType === "organization" && params.organizationId === null) {
    throw new Error("Organization support credits require an organization id");
  }

  const referenceId = buildSupportCreditReferenceId({
    grantId: params.grantId,
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
          referenceType: CreditBucketReferenceType.SUPPORT,
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
    throw new Error("Failed to create support credit bucket");
  }

  return { bucketId };
}
