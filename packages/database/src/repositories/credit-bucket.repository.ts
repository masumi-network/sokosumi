import {
  type CreditBucket,
  CreditBucketReferenceType,
  Prisma,
} from "../generated/prisma/client.js";
import {
  creditBucketActivatesAtOrBefore,
  creditBucketActivatesAtOrBeforeSql,
} from "../helpers/credit.js";
import {
  buildCreditBucketScopeSql,
  buildCreditBucketScopeWhere,
  buildEnterprisePoolScopeSql,
  resolveCreditBucketScopeContext,
} from "../helpers/credit-bucket-scope.js";

export interface Consumption {
  bucketId: string;
  amount: bigint;
}

export class InsufficientBalanceError extends Error {
  constructor(cents: bigint, available: bigint) {
    super(
      `Insufficient balance: tried to consume ${cents} but only ${available} available`,
    );
    this.name = "InsufficientBalanceError";
  }
}

/** Per-bucket amounts in cents from listAvailableBucketsWithBalances */
export interface CreditBucketBalanceRow {
  totalCents: bigint;
  remainingCents: bigint;
  expiresAt: Date | null;
}

/**
 * Credit Bucket Repository Interface
 *
 * Handles credit bucket operations including FIFO consumption and balance calculations.
 * Balances are calculated dynamically (bucket.amount - sum(consumptions)) rather than stored.
 */
export const creditBucketRepository = {
  /**
   * Get all unexpired credit buckets for a user, ordered for spend/display:
   * expiresAt ASC NULLS LAST, then smallest original allocation (`amount` ASC),
   * then createdAt ASC, then id ASC.
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
    const scopeContext = await resolveCreditBucketScopeContext(
      userId,
      organizationId,
      tx,
      now,
    );
    const scopeWhere = buildCreditBucketScopeWhere(scopeContext);

    return await tx.creditBucket.findMany({
      where: {
        AND: [
          scopeWhere,
          creditBucketActivatesAtOrBefore(now),
          { OR: [{ expiresAt: null }, { expiresAt: { gt: now } }] },
        ],
      },
      orderBy: [
        { expiresAt: { sort: "asc", nulls: "last" } },
        { amount: "asc" },
        { createdAt: "asc" },
        { id: "asc" },
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
    const scopeContext = await resolveCreditBucketScopeContext(
      userId,
      organizationId,
      tx,
      now,
    );
    const where = buildCreditBucketScopeSql(scopeContext);

    const result = await tx.$queryRaw<Array<{ balance: bigint }>>`
      WITH bucket_avail AS (
        SELECT
          (cb.amount - COALESCE(SUM(cc.amount), 0))::bigint AS available
        FROM credit_bucket cb
        LEFT JOIN credit_consumption cc ON cc."bucketId" = cb.id
        WHERE ${where}
          AND (cb."expiresAt" IS NULL OR cb."expiresAt" > ${now})
          AND ${creditBucketActivatesAtOrBeforeSql(now)}
        GROUP BY cb.id, cb.amount
      )
      SELECT COALESCE(SUM(available), 0)::bigint AS balance
      FROM bucket_avail
    `;

    return result[0]?.balance ?? 0n;
  },

  /**
   * List unexpired buckets with remaining balance > 0 (same ownership scope as getBalance).
   * Omits subscription-period buckets (`referenceType` subscription); those credits are
   * represented on the subscription payload instead.
   * Order: expiresAt ASC NULLS LAST, smallest original allocation (`amount`),
   * then createdAt ASC, then id ASC.
   * Amounts are in cents for conversion at the API boundary.
   */
  async listAvailableBucketsWithBalances(
    userId: string,
    organizationId: string | null,
    tx: Prisma.TransactionClient,
  ): Promise<CreditBucketBalanceRow[]> {
    const now = new Date();
    const scopeContext = await resolveCreditBucketScopeContext(
      userId,
      organizationId,
      tx,
      now,
    );
    const where = buildCreditBucketScopeSql(scopeContext);

    return await tx.$queryRaw<
      Array<{
        totalCents: bigint;
        remainingCents: bigint;
        expiresAt: Date | null;
      }>
    >`
      WITH bucket_avail AS (
        SELECT
          cb.id,
          cb.amount,
          (cb.amount - COALESCE(SUM(cc.amount), 0))::bigint AS available,
          cb."expiresAt",
          cb."createdAt"
        FROM credit_bucket cb
        LEFT JOIN credit_consumption cc ON cc."bucketId" = cb.id
        WHERE ${where}
          AND (cb."expiresAt" IS NULL OR cb."expiresAt" > ${now})
          AND ${creditBucketActivatesAtOrBeforeSql(now)}
          AND cb."referenceType" IS DISTINCT FROM ${CreditBucketReferenceType.STRIPE_SUBSCRIPTION_PERIOD}
          AND cb."referenceType" IS DISTINCT FROM ${CreditBucketReferenceType.ENTERPRISE_PERIOD}
          AND cb."referenceType" IS DISTINCT FROM ${CreditBucketReferenceType.ENTERPRISE_TOP_UP}
        GROUP BY cb.id, cb.amount, cb."expiresAt", cb."createdAt"
        HAVING (cb.amount - COALESCE(SUM(cc.amount), 0)) > 0
      )
      SELECT
        amount AS "totalCents",
        available AS "remainingCents",
        "expiresAt"
      FROM bucket_avail
      ORDER BY "expiresAt" ASC NULLS LAST, amount ASC, "createdAt" ASC, id ASC
    `;
  },

  async sumOrganizationEnterprisePoolBalances(
    organizationId: string,
    tx: Prisma.TransactionClient,
    now: Date = new Date(),
  ): Promise<{ totalCents: bigint; remainingCents: bigint }> {
    const rows = await tx.$queryRaw<
      Array<{ totalCents: bigint; remainingCents: bigint }>
    >`
      WITH bucket_avail AS (
        SELECT
          cb.amount,
          (cb.amount - COALESCE(SUM(cc.amount), 0))::bigint AS available
        FROM credit_bucket cb
        LEFT JOIN credit_consumption cc ON cc."bucketId" = cb.id
        WHERE cb."organizationId" = ${organizationId}
          AND cb."referenceType" IN (
            ${CreditBucketReferenceType.ENTERPRISE_PERIOD},
            ${CreditBucketReferenceType.ENTERPRISE_TOP_UP}
          )
          AND (cb."expiresAt" IS NULL OR cb."expiresAt" > ${now})
          AND ${creditBucketActivatesAtOrBeforeSql(now)}
        GROUP BY cb.id, cb.amount
      )
      SELECT
        COALESCE(SUM(amount), 0)::bigint AS "totalCents",
        COALESCE(SUM(GREATEST(available, 0)), 0)::bigint AS "remainingCents"
      FROM bucket_avail
    `;

    return rows[0] ?? { totalCents: 0n, remainingCents: 0n };
  },

  async sumOrganizationOwnedCreditBalances(
    organizationId: string,
    tx: Prisma.TransactionClient,
    now: Date = new Date(),
  ): Promise<{ totalCents: bigint; remainingCents: bigint }> {
    const rows = await tx.$queryRaw<
      Array<{ totalCents: bigint; remainingCents: bigint }>
    >`
      WITH bucket_avail AS (
        SELECT
          cb.amount,
          (cb.amount - COALESCE(SUM(cc.amount), 0))::bigint AS available
        FROM credit_bucket cb
        LEFT JOIN credit_consumption cc ON cc."bucketId" = cb.id
        WHERE cb."organizationId" = ${organizationId}
          AND cb."userId" IS NULL
          AND cb."referenceType" IS DISTINCT FROM ${CreditBucketReferenceType.ENTERPRISE_PERIOD}
          AND cb."referenceType" IS DISTINCT FROM ${CreditBucketReferenceType.ENTERPRISE_TOP_UP}
          AND (cb."expiresAt" IS NULL OR cb."expiresAt" > ${now})
          AND ${creditBucketActivatesAtOrBeforeSql(now)}
        GROUP BY cb.id, cb.amount
      )
      SELECT
        COALESCE(SUM(amount), 0)::bigint AS "totalCents",
        COALESCE(SUM(GREATEST(available, 0)), 0)::bigint AS "remainingCents"
      FROM bucket_avail
    `;

    return rows[0] ?? { totalCents: 0n, remainingCents: 0n };
  },

  async listEnterprisePoolBucketsWithBalances(
    userId: string,
    organizationId: string,
    tx: Prisma.TransactionClient,
  ): Promise<CreditBucketBalanceRow[]> {
    const now = new Date();
    const scopeContext = await resolveCreditBucketScopeContext(
      userId,
      organizationId,
      tx,
      now,
    );
    const where = buildEnterprisePoolScopeSql(scopeContext);
    if (!where) {
      return [];
    }

    return await tx.$queryRaw<
      Array<{
        totalCents: bigint;
        remainingCents: bigint;
        expiresAt: Date | null;
      }>
    >`
      WITH bucket_avail AS (
        SELECT
          cb.id,
          cb.amount,
          (cb.amount - COALESCE(SUM(cc.amount), 0))::bigint AS available,
          cb."expiresAt",
          cb."createdAt"
        FROM credit_bucket cb
        LEFT JOIN credit_consumption cc ON cc."bucketId" = cb.id
        WHERE ${where}
          AND (cb."expiresAt" IS NULL OR cb."expiresAt" > ${now})
          AND ${creditBucketActivatesAtOrBeforeSql(now)}
        GROUP BY cb.id, cb.amount, cb."expiresAt", cb."createdAt"
        HAVING (cb.amount - COALESCE(SUM(cc.amount), 0)) > 0
      )
      SELECT
        amount AS "totalCents",
        available AS "remainingCents",
        "expiresAt"
      FROM bucket_avail
      ORDER BY "expiresAt" ASC NULLS LAST, amount ASC, "createdAt" ASC, id ASC
    `;
  },

  /**
   * Consume credits from buckets in list order (expiry, then smallest original amount,
   * then createdAt, then id) until the requested amount is covered.
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

    const now = new Date();
    const buckets = await getFifoBucketsToCoverSpend(
      userId,
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
        continue;
      }

      const consumeFromBucket = available < remaining ? available : remaining;

      consumptions.push({ bucketId: bucket.id, amount: consumeFromBucket });
      remaining -= consumeFromBucket;
    }

    if (remaining > BigInt(0)) {
      throw new InsufficientBalanceError(cents, cents - remaining);
    }

    return consumptions;
  },
};

async function getFifoBucketsToCoverSpend(
  userId: string,
  organizationId: string | null,
  now: Date,
  cents: bigint,
  tx: Prisma.TransactionClient,
): Promise<Array<{ id: string; available: bigint }>> {
  const scopeContext = await resolveCreditBucketScopeContext(
    userId,
    organizationId,
    tx,
    now,
  );
  const where = buildCreditBucketScopeSql(scopeContext);

  return await tx.$queryRaw<Array<{ id: string; available: bigint }>>`
    WITH bucket_avail AS (
      SELECT
        cb.id,
        cb.amount,
        (cb.amount - COALESCE(SUM(cc.amount), 0))::bigint AS available,
        cb."expiresAt",
        cb."createdAt"
      FROM credit_bucket cb
      LEFT JOIN credit_consumption cc ON cc."bucketId" = cb.id
      WHERE ${where}
        AND (cb."expiresAt" IS NULL OR cb."expiresAt" > ${now})
        AND ${creditBucketActivatesAtOrBeforeSql(now)}
      GROUP BY cb.id, cb.amount, cb."expiresAt", cb."createdAt"
      HAVING (cb.amount - COALESCE(SUM(cc.amount), 0)) > 0
    ),
    ordered AS (
      SELECT
        id,
        amount,
        available,
        "expiresAt",
        "createdAt",
        SUM(available) OVER (
          ORDER BY "expiresAt" ASC NULLS LAST, amount ASC, "createdAt" ASC, id ASC
        ) AS running_total
      FROM bucket_avail
    )
    SELECT id, available
    FROM ordered
    WHERE running_total - available < ${cents}
    ORDER BY "expiresAt" ASC NULLS LAST, amount ASC, "createdAt" ASC, id ASC
  `;
}
