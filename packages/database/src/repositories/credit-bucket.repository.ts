import {
  CreditBucketReferenceType,
  Prisma,
} from "../generated/prisma/client.js";
import { creditBucketActivatesAtOrBeforeSql } from "../helpers/credit.js";
import {
  buildCreditBucketScopeSql,
  buildEnterprisePoolScopeSql,
  buildOrganizationPoolScopeSql,
  type CreditBucketProjectOption,
  creditBucketSpendOrderSql,
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
interface CreditBucketBalanceRow {
  totalCents: bigint;
  remainingCents: bigint;
  expiresAt: Date | null;
  /** Set on Project credits (ADR 0067); null for the pool. */
  projectId: string | null;
  projectName: string | null;
}

/** Unexpired, active non-subscription buckets with remaining > 0. */
async function queryBucketBalances(
  where: Prisma.Sql,
  orderBy: Prisma.Sql,
  now: Date,
  tx: Prisma.TransactionClient,
): Promise<CreditBucketBalanceRow[]> {
  return await tx.$queryRaw<CreditBucketBalanceRow[]>`
    WITH bucket_avail AS (
      SELECT
        cb.id,
        cb.amount,
        (cb.amount - COALESCE(SUM(cc.amount), 0))::bigint AS available,
        cb."expiresAt",
        cb."createdAt",
        cb."projectId",
        p.name AS "projectName"
      FROM credit_bucket cb
      LEFT JOIN credit_consumption cc ON cc."bucketId" = cb.id
      LEFT JOIN project p ON p.id = cb."projectId"
      WHERE ${where}
        AND (cb."expiresAt" IS NULL OR cb."expiresAt" > ${now})
        AND ${creditBucketActivatesAtOrBeforeSql(now)}
        AND cb."referenceType" IS DISTINCT FROM ${CreditBucketReferenceType.STRIPE_SUBSCRIPTION_PERIOD}
        AND cb."referenceType" IS DISTINCT FROM ${CreditBucketReferenceType.ENTERPRISE_PERIOD}
        AND cb."referenceType" IS DISTINCT FROM ${CreditBucketReferenceType.ENTERPRISE_TOP_UP}
      GROUP BY cb.id, cb.amount, cb."expiresAt", cb."createdAt", cb."projectId", p.name
      HAVING (cb.amount - COALESCE(SUM(cc.amount), 0)) > 0
    )
    SELECT
      amount AS "totalCents",
      available AS "remainingCents",
      "expiresAt",
      "projectId",
      "projectName"
    FROM bucket_avail
    ${orderBy}
  `;
}

export const creditBucketRepository = {
  /**
   * What `userId` can spend in this workspace. A null user with an
   * organization reads the Organization pool a charge with no member draws on
   * (ADR 0057). With a Project it adds that Project's credits (ADR 0067).
   */
  async getBalance(
    userId: string | null,
    organizationId: string | null,
    tx: Prisma.TransactionClient,
    options: CreditBucketProjectOption = {},
  ): Promise<bigint> {
    const now = new Date();
    const scopeContext = await resolveCreditBucketScopeContext(
      userId,
      organizationId,
      tx,
      now,
    );
    return await sumAvailableCents(
      buildCreditBucketScopeSql(scopeContext, options),
      now,
      tx,
    );
  },

  /**
   * The Organization pool a seated member would see, with no seat check. Only
   * for deciding whether the pool itself is empty; spend uses `getBalance`.
   */
  async getOrganizationPoolBalance(
    organizationId: string,
    tx: Prisma.TransactionClient,
    options: CreditBucketProjectOption = {},
  ): Promise<bigint> {
    const now = new Date();
    return await sumAvailableCents(
      await buildOrganizationPoolScopeSql(organizationId, tx, now, options),
      now,
      tx,
    );
  },

  /**
   * Unexpired buckets with remaining > 0. Omits subscription-period buckets
   * (`referenceType` subscription); those credits live on the subscription
   * payload. Order: expiresAt ASC NULLS LAST, smallest original `amount`,
   * then createdAt ASC, then id ASC; a Project's credits come first when
   * given one. Amounts in cents.
   */
  async listAvailableBucketsWithBalances(
    userId: string | null,
    organizationId: string | null,
    tx: Prisma.TransactionClient,
    options: CreditBucketProjectOption = {},
  ): Promise<CreditBucketBalanceRow[]> {
    const now = new Date();
    const scopeContext = await resolveCreditBucketScopeContext(
      userId,
      organizationId,
      tx,
      now,
    );
    return await queryBucketBalances(
      buildCreditBucketScopeSql(scopeContext, options),
      creditBucketSpendOrderSql(options.projectId),
      now,
      tx,
    );
  },

  /**
   * Every Project's credits in the organization the member can see, as their
   * own rows named by Project (ADR 0067). Organization balances leave them out.
   */
  async listProjectBucketsWithBalances(
    userId: string | null,
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
    if (
      scopeContext.workspace !== "organization" ||
      scopeContext.poolAccess === "none"
    ) {
      return [];
    }
    return await queryBucketBalances(
      Prisma.sql`cb."organizationId" = ${organizationId} AND cb."projectId" IS NOT NULL`,
      creditBucketSpendOrderSql(undefined),
      now,
      tx,
    );
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
    userId: string | null,
    organizationId: string,
    tx: Prisma.TransactionClient,
  ): Promise<
    Pick<
      CreditBucketBalanceRow,
      "totalCents" | "remainingCents" | "expiresAt"
    >[]
  > {
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
   * FIFO consume in list order until `cents` is covered. Throws if
   * insufficient. A null user with an organization consumes the Organization
   * pool with no member and no Seat (ADR 0057). With a Project it draws that
   * Project's credits first, then the pool (ADR 0067).
   */
  async prepareConsumption(
    userId: string | null,
    organizationId: string | null,
    cents: bigint,
    tx: Prisma.TransactionClient,
    options: CreditBucketProjectOption = {},
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
      options,
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

async function sumAvailableCents(
  where: Prisma.Sql,
  now: Date,
  tx: Prisma.TransactionClient,
): Promise<bigint> {
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
}

async function getFifoBucketsToCoverSpend(
  userId: string | null,
  organizationId: string | null,
  now: Date,
  cents: bigint,
  tx: Prisma.TransactionClient,
  options: CreditBucketProjectOption,
): Promise<Array<{ id: string; available: bigint }>> {
  const scopeContext = await resolveCreditBucketScopeContext(
    userId,
    organizationId,
    tx,
    now,
  );
  const where = buildCreditBucketScopeSql(scopeContext, options);
  const spendOrder = creditBucketSpendOrderSql(options.projectId);

  return await tx.$queryRaw<Array<{ id: string; available: bigint }>>`
    WITH bucket_avail AS (
      SELECT
        cb.id,
        cb.amount,
        (cb.amount - COALESCE(SUM(cc.amount), 0))::bigint AS available,
        cb."expiresAt",
        cb."createdAt",
        cb."projectId"
      FROM credit_bucket cb
      LEFT JOIN credit_consumption cc ON cc."bucketId" = cb.id
      WHERE ${where}
        AND (cb."expiresAt" IS NULL OR cb."expiresAt" > ${now})
        AND ${creditBucketActivatesAtOrBeforeSql(now)}
      GROUP BY cb.id, cb.amount, cb."expiresAt", cb."createdAt", cb."projectId"
      HAVING (cb.amount - COALESCE(SUM(cc.amount), 0)) > 0
    ),
    ordered AS (
      SELECT
        id,
        amount,
        available,
        "expiresAt",
        "createdAt",
        "projectId",
        SUM(available) OVER (
          ${spendOrder}
        ) AS running_total
      FROM bucket_avail
    )
    SELECT id, available
    FROM ordered
    WHERE running_total - available < ${cents}
    ${spendOrder}
  `;
}
