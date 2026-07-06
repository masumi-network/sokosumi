import { convertCreditsToCents } from "@sokosumi/utils";

import {
  CreditBucketReferenceType,
  type Prisma,
} from "../generated/prisma/client.js";
import { buildSignupBonusCreditReferenceId } from "./credit.js";

function isPrismaUniqueConstraintError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === "P2002"
  );
}

export interface GrantSignupBonusCreditsParams {
  credits: number;
  expiresAt: Date | null;
  referenceNote?: string | null;
  userId: string;
}

export interface GrantSignupBonusCreditsResult {
  bucketId: string;
  created: boolean;
}

async function findSignupBonusBucket(
  referenceId: string,
  tx: Prisma.TransactionClient,
): Promise<{ id: string } | null> {
  return await tx.creditBucket.findUnique({
    where: {
      referenceId_referenceType: {
        referenceId,
        referenceType: CreditBucketReferenceType.SIGNUP_BONUS,
      },
    },
    select: { id: true },
  });
}

export async function grantSignupBonusCredits(
  params: GrantSignupBonusCreditsParams,
  tx: Prisma.TransactionClient,
): Promise<GrantSignupBonusCreditsResult> {
  if (
    !Number.isFinite(params.credits) ||
    !Number.isInteger(params.credits) ||
    params.credits <= 0
  ) {
    throw new Error("Signup bonus credits must be a positive integer");
  }

  const referenceId = buildSignupBonusCreditReferenceId(params.userId);
  const existingBucket = await findSignupBonusBucket(referenceId, tx);

  if (existingBucket) {
    return { bucketId: existingBucket.id, created: false };
  }

  const amount = convertCreditsToCents(params.credits);

  try {
    const transaction = await tx.transaction.create({
      data: {
        amount,
        sourceCreditBucket: {
          create: {
            amount,
            expiresAt: params.expiresAt,
            organizationId: null,
            referenceId,
            referenceNote: params.referenceNote ?? null,
            referenceType: CreditBucketReferenceType.SIGNUP_BONUS,
            userId: params.userId,
          },
        },
        user: {
          connect: {
            id: params.userId,
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
      throw new Error("Failed to create signup bonus credit bucket");
    }

    return { bucketId, created: true };
  } catch (error) {
    if (!isPrismaUniqueConstraintError(error)) {
      throw error;
    }

    const racedBucket = await findSignupBonusBucket(referenceId, tx);
    if (racedBucket) {
      return { bucketId: racedBucket.id, created: false };
    }

    throw error;
  }
}
