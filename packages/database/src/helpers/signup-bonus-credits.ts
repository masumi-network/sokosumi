import { convertCreditsToCents } from "@sokosumi/utils";

import {
  CreditBucketReferenceType,
  type Prisma,
} from "../generated/prisma/client.js";
import { isPrismaUniqueConstraintError } from "../prisma-errors.js";
import type { TableNetwork } from "../sql-tables.js";
import { buildSignupBonusCreditReferenceId } from "./credit.js";
import {
  findCreditBucketByReference,
  insertCreditGrant,
} from "./credit-grant-sql.js";

interface GrantSignupBonusCreditsParams {
  credits: number;
  expiresAt: Date | null;
  mintId?: () => string;
  network?: TableNetwork;
  splitSql?: boolean;
  userId: string;
}

interface GrantSignupBonusCreditsResult {
  bucketId: string;
  created: boolean;
}

async function findSignupBonusBucket(
  referenceId: string,
  tx: Prisma.TransactionClient,
  options?: { network?: TableNetwork; splitSql?: boolean },
): Promise<{ id: string } | null> {
  if (options?.splitSql) {
    const found = await findCreditBucketByReference(
      {
        network: options.network ?? "mainnet",
        referenceId,
        referenceType: CreditBucketReferenceType.SIGNUP_BONUS,
      },
      tx,
    );
    return found ? { id: found.id } : null;
  }

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

  const network = params.network ?? "mainnet";
  const splitSql = params.splitSql === true;
  const referenceId = buildSignupBonusCreditReferenceId(params.userId);
  const existingBucket = await findSignupBonusBucket(referenceId, tx, {
    network,
    splitSql,
  });

  if (existingBucket) {
    return { bucketId: existingBucket.id, created: false };
  }

  const amount = convertCreditsToCents(params.credits);

  try {
    let bucketId: string;
    if (splitSql) {
      ({ bucketId } = await insertCreditGrant(
        {
          mintId: params.mintId,
          network,
          amount,
          expiresAt: params.expiresAt,
          organizationId: null,
          referenceId,
          referenceType: CreditBucketReferenceType.SIGNUP_BONUS,
          userId: params.userId,
        },
        tx,
      ));
    } else {
      const transaction = await tx.transaction.create({
        data: {
          amount,
          sourceCreditBucket: {
            create: {
              amount,
              expiresAt: params.expiresAt,
              organizationId: null,
              referenceId,
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

      const createdBucketId = transaction.sourceCreditBucket?.id;
      if (!createdBucketId) {
        throw new Error("Failed to create signup bonus credit bucket");
      }
      bucketId = createdBucketId;
    }

    return { bucketId, created: true };
  } catch (error) {
    if (!isPrismaUniqueConstraintError(error)) {
      throw error;
    }

    const racedBucket = await findSignupBonusBucket(referenceId, tx, {
      network,
      splitSql,
    });
    if (racedBucket) {
      return { bucketId: racedBucket.id, created: false };
    }

    throw error;
  }
}
