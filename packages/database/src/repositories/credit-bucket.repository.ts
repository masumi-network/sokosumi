import type {
  CreditBucket,
  CreditConsumption,
  Prisma,
} from "../generated/prisma/client.js";

interface Consumption {
  bucketId: string;
  amount: bigint;
}

/**
 * Credit Bucket Repository Interface
 *
 * Handles credit bucket operations including FIFO consumption and balance calculations.
 * Balances are calculated dynamically (bucket.amount - sum(consumptions)) rather than stored.
 */
export const creditBucketRepository = {
  /**
   * Get all unexpired credit buckets for a user, ordered by FIFO (expiresAt ASC NULLS LAST, createdAt ASC).
   *
   * @param userId - The ID of the user.
   * @param organizationId - Optional organization ID (null for personal credits).
   * @param tx - The Prisma transaction client to use for database operations.
   * @returns Array of credit buckets ordered by FIFO.
   */
  async getUnexpiredBuckets(
    userId: string,
    organizationId: string | null,
    tx: Prisma.TransactionClient,
  ): Promise<CreditBucket[]> {
    const now = new Date();
    return await tx.creditBucket.findMany({
      where: {
        userId,
        organizationId: organizationId ?? null,
        OR: [
          { expiresAt: null },
          { expiresAt: { gt: now } },
        ],
      },
      orderBy: [
        { expiresAt: { sort: "asc", nulls: "last" } },
        { createdAt: "asc" },
      ],
    });
  },

  /**
   * Calculate the available balance for a specific bucket.
   * Available balance = bucket.amount - sum(consumptions for this bucket).
   *
   * @param bucketId - The ID of the credit bucket.
   * @param tx - The Prisma transaction client to use for database operations.
   * @returns The available balance in cents as a bigint.
   */
  async getBalanceForBucket(
    bucketId: string,
    tx: Prisma.TransactionClient,
  ): Promise<bigint> {
    const bucket = await tx.creditBucket.findUnique({
      where: { id: bucketId },
      select: { amount: true },
    });

    if (!bucket) {
      return BigInt(0);
    }

    const consumptionSum = await tx.creditConsumption.aggregate({
      where: { bucketId },
      _sum: { amount: true },
    });

    const consumed = consumptionSum._sum.amount ?? BigInt(0);
    return bucket.amount - consumed;
  },

  /**
   * Calculate the total available balance for a user/organization.
   * Balance = sum(bucket.amount where unexpired) - sum(consumption.amount where bucket is unexpired).
   *
   * @param userId - The ID of the user.
   * @param organizationId - Optional organization ID (null for personal credits).
   * @param tx - The Prisma transaction client to use for database operations.
   * @returns The total available balance in cents as a bigint.
   */
  async getBalance(
    userId: string,
    organizationId: string | null,
    tx: Prisma.TransactionClient,
  ): Promise<bigint> {
    const now = new Date();

    // Get all unexpired buckets
    const buckets = await tx.creditBucket.findMany({
      where: {
        userId,
        organizationId: organizationId ?? null,
        OR: [
          { expiresAt: null },
          { expiresAt: { gt: now } },
        ],
      },
      select: {
        id: true,
        amount: true,
      },
    });

    if (buckets.length === 0) {
      return BigInt(0);
    }

    const bucketIds = buckets.map((b) => b.id);

    // Sum all consumptions for these buckets
    const consumptionSum = await tx.creditConsumption.aggregate({
      where: {
        bucketId: { in: bucketIds },
      },
      _sum: { amount: true },
    });

    const totalBucketAmount = buckets.reduce(
      (sum, bucket) => sum + bucket.amount,
      BigInt(0),
    );
    const totalConsumed = consumptionSum._sum.amount ?? BigInt(0);

    return totalBucketAmount - totalConsumed;
  },

  /**
   * Consume credits from buckets in FIFO order until the requested amount is covered.
   * Creates CreditConsumption records for each bucket consumed from.
   *
   * @param userId - The ID of the user.
   * @param organizationId - Optional organization ID (null for personal credits).
   * @param amountToConsume - The amount to consume in cents (must be positive).
   * @param tx - The Prisma transaction client to use for database operations.
   * @returns Array of CreditConsumption records created, or throws error if insufficient balance.
   */
  async prepareConsumption(
    userId: string,
    organizationId: string | null,
    amountToConsume: bigint,
    tx: Prisma.TransactionClient,
  ): Promise<Consumption[]> {
    if (amountToConsume <= BigInt(0)) {
      throw new Error("Amount to consume must be positive");
    }

    // Get buckets in FIFO order
    const buckets = await this.getUnexpiredBuckets(
      userId,
      organizationId,
      tx,
    );

    const consumptions: Consumption[] = [];
    let remaining = amountToConsume;

    for (const bucket of buckets) {
      if (remaining <= BigInt(0)) {
        break;
      }

      // Calculate available balance for this bucket
      const available = await this.getBalanceForBucket(bucket.id, tx);

      if (available <= BigInt(0)) {
        continue; // Skip empty buckets
      }

      // Consume from this bucket (either all available or just what we need)
      const consumeFromBucket = available < remaining ? available : remaining;

      consumptions.push({ bucketId: bucket.id, amount: consumeFromBucket });
      remaining -= consumeFromBucket;
    }

    // Check if we consumed enough
    if (remaining > BigInt(0)) {
      throw new Error(
        `Insufficient balance: tried to consume ${amountToConsume} but only ${amountToConsume - remaining} available`,
      );
    }

    return consumptions;
  },
};
