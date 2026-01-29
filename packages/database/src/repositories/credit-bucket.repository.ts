import { type CreditBucket, Prisma } from "../generated/prisma/client.js";

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
      orderBy: [
        { expiresAt: { sort: "asc", nulls: "last" } },
        { createdAt: "asc" },
      ],
    });
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
    const where = organizationId
      ? Prisma.sql`cb."organizationId" = ${organizationId}`
      : Prisma.sql`cb."userId" = ${userId} AND cb."organizationId" IS NULL`;

    const result = await tx.$queryRaw<Array<{ balance: bigint }>>`
      WITH bucket_avail AS (
        SELECT
          (cb.amount - COALESCE(SUM(cc.amount), 0))::bigint AS available
        FROM credit_bucket cb
        LEFT JOIN credit_consumption cc ON cc."bucketId" = cb.id
        WHERE ${where}
          AND (cb."expiresAt" IS NULL OR cb."expiresAt" > ${now})
        GROUP BY cb.id, cb.amount
      )
      SELECT COALESCE(SUM(available), 0)::bigint AS balance
      FROM bucket_avail
    `;

    return result[0]?.balance ?? 0n;
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
    cents: bigint,
    tx: Prisma.TransactionClient,
  ): Promise<Consumption[]> {
    if (cents <= BigInt(0)) {
      throw new Error("Cents to consume must be positive");
    }

    if (!organizationId) {
      const now = new Date();
      const buckets = await getFifoBucketsToCoverSpendPersonal(
        userId,
        now,
        cents,
        tx,
      );

      const consumptions: Consumption[] = [];
      let remaining = cents;

      for (const bucket of buckets) {
        if (remaining <= BigInt(0)) {
          break;
        }

        const available = bucket.available;

        if (available <= BigInt(0)) {
          continue;
        }

        const consumeFromBucket = available < remaining ? available : remaining;

        consumptions.push({ bucketId: bucket.id, amount: consumeFromBucket });
        remaining -= consumeFromBucket;
      }

      if (remaining > BigInt(0)) {
        throw new Error(
          `Insufficient balance: tried to consume ${cents} but only ${cents - remaining} available`,
        );
      }

      return consumptions;
    }

    const now = new Date();
    const buckets = await getFifoBucketsToCoverSpendOrganization(
      organizationId,
      now,
      cents,
      tx,
    );

    const consumptions: Consumption[] = [];
    let remaining = cents;

    for (const bucket of buckets) {
      if (remaining <= BigInt(0)) {
        break;
      }

      const available = bucket.available;

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
        `Insufficient balance: tried to consume ${cents} but only ${cents - remaining} available`,
      );
    }

    return consumptions;
  },
};

async function getFifoBucketsToCoverSpendPersonal(
  userId: string,
  now: Date,
  cents: bigint,
  tx: Prisma.TransactionClient,
): Promise<Array<{ id: string; available: bigint }>> {
  return await tx.$queryRaw<Array<{ id: string; available: bigint }>>`
    WITH bucket_avail AS (
      SELECT
        cb.id,
        (cb.amount - COALESCE(SUM(cc.amount), 0))::bigint AS available,
        cb."expiresAt",
        cb."createdAt"
      FROM credit_bucket cb
      LEFT JOIN credit_consumption cc ON cc."bucketId" = cb.id
      WHERE cb."userId" = ${userId}
        AND cb."organizationId" IS NULL
        AND (cb."expiresAt" IS NULL OR cb."expiresAt" > ${now})
      GROUP BY cb.id, cb.amount, cb."expiresAt", cb."createdAt"
      HAVING (cb.amount - COALESCE(SUM(cc.amount), 0)) > 0
    ),
    ordered AS (
      SELECT
        id,
        available,
        "expiresAt",
        "createdAt",
        SUM(available) OVER (
          ORDER BY "expiresAt" ASC NULLS LAST, "createdAt" ASC, id ASC
        ) AS running_total
      FROM bucket_avail
    )
    SELECT id, available
    FROM ordered
    WHERE running_total - available < ${cents}
    ORDER BY "expiresAt" ASC NULLS LAST, "createdAt" ASC, id ASC
  `;
}

async function getFifoBucketsToCoverSpendOrganization(
  organizationId: string,
  now: Date,
  cents: bigint,
  tx: Prisma.TransactionClient,
): Promise<Array<{ id: string; available: bigint }>> {
  return await tx.$queryRaw<Array<{ id: string; available: bigint }>>`
    WITH bucket_avail AS (
      SELECT
        cb.id,
        (cb.amount - COALESCE(SUM(cc.amount), 0))::bigint AS available,
        cb."expiresAt",
        cb."createdAt"
      FROM credit_bucket cb
      LEFT JOIN credit_consumption cc ON cc."bucketId" = cb.id
      WHERE cb."organizationId" = ${organizationId}
        AND (cb."expiresAt" IS NULL OR cb."expiresAt" > ${now})
      GROUP BY cb.id, cb.amount, cb."expiresAt", cb."createdAt"
      HAVING (cb.amount - COALESCE(SUM(cc.amount), 0)) > 0
    ),
    ordered AS (
      SELECT
        id,
        available,
        "expiresAt",
        "createdAt",
        SUM(available) OVER (
          ORDER BY "expiresAt" ASC NULLS LAST, "createdAt" ASC, id ASC
        ) AS running_total
      FROM bucket_avail
    )
    SELECT id, available
    FROM ordered
    WHERE running_total - available < ${cents}
    ORDER BY "expiresAt" ASC NULLS LAST, "createdAt" ASC, id ASC
  `;
}
