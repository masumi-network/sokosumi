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
  userId: string;
}

interface GrantSignupBonusCreditsResult {
  bucketId: string;
  created: boolean;
}

async function findSignupBonusBucket(
  referenceId: string,
  network: TableNetwork,
  tx: Prisma.TransactionClient,
): Promise<{ id: string } | null> {
  const found = await findCreditBucketByReference(
    {
      network,
      referenceId,
      referenceType: CreditBucketReferenceType.SIGNUP_BONUS,
    },
    tx,
  );
  return found ? { id: found.id } : null;
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
  const referenceId = buildSignupBonusCreditReferenceId(params.userId);
  const existingBucket = await findSignupBonusBucket(referenceId, network, tx);

  if (existingBucket) {
    return { bucketId: existingBucket.id, created: false };
  }

  const amount = convertCreditsToCents(params.credits);

  try {
    const { bucketId } = await insertCreditGrant(
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
    );

    return { bucketId, created: true };
  } catch (error) {
    if (!isPrismaUniqueConstraintError(error)) {
      throw error;
    }

    const racedBucket = await findSignupBonusBucket(referenceId, network, tx);
    if (racedBucket) {
      return { bucketId: racedBucket.id, created: false };
    }

    throw error;
  }
}
