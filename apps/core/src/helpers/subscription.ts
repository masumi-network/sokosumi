import { CreditBucketReferenceType, type Prisma } from "@sokosumi/database";
import { convertCentsToCredits } from "@sokosumi/database/helpers";

interface SubscriptionPeriodRecord {
  periodStart: Date | null;
  periodEnd: Date | null;
}

interface SubscriptionCredits {
  remaining: number;
  total: number;
  used: number;
}

interface CreditSummary {
  buffer: number;
  total: number;
}

interface SubscriptionRecord extends SubscriptionPeriodRecord {
  plan: string;
  status: string;
  cancelAtPeriodEnd: boolean | null;
  credits?: SubscriptionCredits | null;
}

interface CurrentSubscriptionPeriod {
  periodEnd: Date;
  periodStart: Date;
}

interface OrganizationCurrentSubscriptionPeriod extends CurrentSubscriptionPeriod {
  organizationId: string;
}

interface NormalizedSubscriptionCents {
  remainingCents: bigint;
  totalCents: bigint;
  usedCents: bigint;
}

function normalizeSubscriptionCents(
  totalCentsRaw: bigint,
  usedCentsRaw: bigint,
): NormalizedSubscriptionCents {
  const totalCents = totalCentsRaw > 0n ? totalCentsRaw : 0n;
  const usedCentsNonNegative = usedCentsRaw > 0n ? usedCentsRaw : 0n;
  const usedCents =
    usedCentsNonNegative > totalCents ? totalCents : usedCentsNonNegative;
  const remainingCents = totalCents - usedCents;

  return { totalCents, usedCents, remainingCents };
}

export function getCurrentSubscriptionPeriod(
  subscription: SubscriptionPeriodRecord | null,
  now: Date,
): CurrentSubscriptionPeriod | null {
  if (!subscription) {
    return null;
  }

  const { periodStart, periodEnd } = subscription;
  if (!periodStart || !periodEnd || periodEnd <= periodStart) {
    return null;
  }

  if (periodStart > now || periodEnd <= now) {
    return null;
  }

  return { periodStart, periodEnd };
}

export async function getCurrentSubscriptionCredits(params: {
  subscription: SubscriptionPeriodRecord | null;
  userId: string;
  organizationId: string | null;
  tx: Prisma.TransactionClient;
  now?: Date;
}): Promise<SubscriptionCredits | null> {
  const now = params.now ?? new Date();
  const period = getCurrentSubscriptionPeriod(params.subscription, now);
  if (!period) {
    return null;
  }

  const currentPeriodBucketWhere = params.organizationId
    ? {
        referenceType: CreditBucketReferenceType.STRIPE_SUBSCRIPTION_PERIOD,
        organizationId: params.organizationId,
        expiresAt: {
          gt: period.periodStart,
          lte: period.periodEnd,
        },
        createdAt: {
          lt: now,
        },
      }
    : {
        referenceType: CreditBucketReferenceType.STRIPE_SUBSCRIPTION_PERIOD,
        userId: params.userId,
        organizationId: null,
        expiresAt: {
          gt: period.periodStart,
          lte: period.periodEnd,
        },
        createdAt: {
          lt: now,
        },
      };

  const [totalAggregateResult, usedAggregateResult] = await Promise.all([
    params.tx.creditBucket.aggregate({
      _sum: {
        amount: true,
      },
      where: currentPeriodBucketWhere,
    }),
    params.tx.creditConsumption.aggregate({
      _sum: {
        amount: true,
      },
      where: {
        createdAt: {
          gte: period.periodStart,
          lt: now,
        },
        bucket: {
          is: currentPeriodBucketWhere,
        },
      },
    }),
  ]);

  const normalizedCents = normalizeSubscriptionCents(
    totalAggregateResult._sum.amount ?? 0n,
    usedAggregateResult._sum.amount ?? 0n,
  );

  return {
    total: convertCentsToCredits(normalizedCents.totalCents),
    used: convertCentsToCredits(normalizedCents.usedCents),
    remaining: convertCentsToCredits(normalizedCents.remainingCents),
  };
}

export function getCreditSummary(params: {
  totalCredits: number;
  subscriptionCredits: Pick<SubscriptionCredits, "remaining"> | null;
}): CreditSummary {
  const totalCredits = Number.isFinite(params.totalCredits)
    ? Math.max(params.totalCredits, 0)
    : 0;
  const subscriptionRemaining = Number.isFinite(
    params.subscriptionCredits?.remaining,
  )
    ? Math.max(params.subscriptionCredits?.remaining ?? 0, 0)
    : 0;
  const buffer = totalCredits - subscriptionRemaining;
  const normalizedBuffer = buffer > 0 ? buffer : 0;
  const total = normalizedBuffer + subscriptionRemaining;

  return {
    buffer: normalizedBuffer,
    total,
  };
}

export async function getCurrentOrganizationSubscriptionCreditsMap(params: {
  periods: OrganizationCurrentSubscriptionPeriod[];
  tx: Prisma.TransactionClient;
  now?: Date;
}): Promise<Map<string, SubscriptionCredits>> {
  if (params.periods.length === 0) {
    return new Map();
  }

  const now = params.now ?? new Date();
  const organizationIds = params.periods.map((period) => period.organizationId);
  const periodStarts = params.periods.map((period) => period.periodStart);
  const periodEnds = params.periods.map((period) => period.periodEnd);

  const rows = await params.tx.$queryRaw<
    Array<{
      organization_id: string;
      total_cents: bigint;
      used_cents: bigint;
    }>
  >`
    WITH input(organization_id, period_start, period_end) AS (
      SELECT *
      FROM UNNEST(
        ${organizationIds}::text[],
        ${periodStarts}::timestamptz[],
        ${periodEnds}::timestamptz[]
      )
    )
    SELECT
      i.organization_id,
      COALESCE((
        SELECT SUM(cb.amount)::bigint
        FROM credit_bucket cb
        WHERE cb."organizationId" = i.organization_id
          AND cb."referenceType" = 'STRIPE_SUBSCRIPTION_PERIOD'
          AND cb."expiresAt" IS NOT NULL
          AND cb."expiresAt" > i.period_start
          AND cb."expiresAt" <= i.period_end
          AND cb."createdAt" < ${now}
      ), 0)::bigint AS total_cents,
      COALESCE((
        SELECT SUM(cc.amount)::bigint
        FROM credit_consumption cc
        INNER JOIN credit_bucket cb ON cb.id = cc."bucketId"
        WHERE cb."organizationId" = i.organization_id
          AND cb."referenceType" = 'STRIPE_SUBSCRIPTION_PERIOD'
          AND cb."expiresAt" IS NOT NULL
          AND cb."expiresAt" > i.period_start
          AND cb."expiresAt" <= i.period_end
          AND cb."createdAt" < ${now}
          AND cc."createdAt" >= i.period_start
          AND cc."createdAt" < ${now}
      ), 0)::bigint AS used_cents
    FROM input i
  `;

  return new Map(
    rows.map((row) => {
      const normalizedCents = normalizeSubscriptionCents(
        row.total_cents,
        row.used_cents,
      );

      return [
        row.organization_id,
        {
          total: convertCentsToCredits(normalizedCents.totalCents),
          used: convertCentsToCredits(normalizedCents.usedCents),
          remaining: convertCentsToCredits(normalizedCents.remainingCents),
        },
      ];
    }),
  );
}

export function mapSubscription(subscription: SubscriptionRecord | null) {
  if (!subscription) {
    return null;
  }

  return {
    plan: subscription.plan,
    status: subscription.status,
    periodStart: subscription.periodStart,
    periodEnd: subscription.periodEnd,
    cancelAtPeriodEnd: subscription.cancelAtPeriodEnd,
    credits: subscription.credits ?? null,
  };
}
