import type { Prisma } from "@sokosumi/database";
import { convertCentsToCredits } from "@sokosumi/database/helpers";

import prisma from "@/lib/db/prisma";

/**
 * Gets credit balance in cents for a user or organization
 *
 * @param userId - The user ID to fetch
 * @param organizationId - Optional organization ID. If provided, returns organization credits; otherwise returns user credits
 * @param tx - Optional Prisma transaction client for transaction support
 * @returns The credit in cents as a bigint
 */
export async function getCents(
  userId: string,
  organizationId: string | null,
  tx: Prisma.TransactionClient = prisma,
): Promise<bigint> {
  const now = new Date();

  // Get all unexpired buckets
  const buckets = await tx.creditBucket.findMany({
    where: {
      ...(organizationId
        ? {
            organizationId,
          }
        : {
            userId,
            organizationId: null,
          }),
      OR: [{ expiresAt: null }, { expiresAt: { gt: now } }],
    },
    select: {
      id: true,
      amount: true,
    },
  });

  if (buckets.length === 0) {
    return 0n;
  }

  // Sum all consumptions for these buckets
  const bucketIds = buckets.map((b) => b.id);
  const consumptionSum = await tx.creditConsumption.aggregate({
    where: {
      bucketId: { in: bucketIds },
    },
    _sum: { amount: true },
  });

  // Sum all buckets
  const totalBucketAmount = buckets.reduce(
    (sum, bucket) => sum + bucket.amount,
    0n,
  );

  const totalConsumed = consumptionSum._sum.amount ?? 0n;
  const cents = totalBucketAmount - totalConsumed;
  return cents;
}

/**
 * Gets credits for a user or organization
 *
 * @param userId - The user ID to fetch
 * @param organizationId - Optional organization ID. If provided, returns organization credits; otherwise returns user credits
 * @param tx - Optional Prisma transaction client for transaction support
 * @returns The credits as a number
 */
export async function getCredits(
  userId: string,
  organizationId: string | null,
  tx: Prisma.TransactionClient = prisma,
): Promise<number> {
  const cents = await getCents(userId, organizationId, tx);
  return convertCentsToCredits(cents);
}
