import { CreditBucketReferenceType, type Prisma } from "@sokosumi/database";
import { creditBucketActivatesAtOrBefore } from "@sokosumi/database/helpers";
import {
  creditBucketRepository,
  subscriptionRepository,
} from "@sokosumi/database/repositories";
import { convertCentsToCredits } from "@sokosumi/utils";

import { getCredits } from "@/helpers/user";

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

function getCurrentSubscriptionPeriod(
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

  const currentPeriodBucketScope = params.organizationId
    ? {
        referenceType: CreditBucketReferenceType.STRIPE_SUBSCRIPTION_PERIOD,
        organizationId: params.organizationId,
        userId: null,
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

  const currentPeriodBucketWhere = {
    AND: [
      creditBucketActivatesAtOrBefore(now),
      currentPeriodBucketScope,
      {
        OR: [{ expiresAt: null }, { expiresAt: { gt: now } }],
      },
    ],
  };

  const buckets = await params.tx.creditBucket.findMany({
    select: {
      amount: true,
      id: true,
    },
    where: currentPeriodBucketWhere,
  });

  if (buckets.length === 0) {
    return {
      remaining: 0,
      total: 0,
      used: 0,
    };
  }

  const bucketIds = buckets.map((bucket) => bucket.id);
  const [lifetimeUsedRows, periodUsedRows] = await Promise.all([
    params.tx.creditConsumption.groupBy({
      by: ["bucketId"],
      where: {
        bucketId: { in: bucketIds },
      },
      _sum: {
        amount: true,
      },
    }),
    params.tx.creditConsumption.groupBy({
      by: ["bucketId"],
      where: {
        bucketId: { in: bucketIds },
        createdAt: {
          gte: period.periodStart,
          lt: now,
        },
      },
      _sum: {
        amount: true,
      },
    }),
  ]);

  const lifetimeUsedByBucketId = new Map(
    lifetimeUsedRows.map((row) => [row.bucketId, row._sum.amount ?? 0n]),
  );
  const periodUsedByBucketId = new Map(
    periodUsedRows.map((row) => [row.bucketId, row._sum.amount ?? 0n]),
  );

  const normalizedCents = summarizeCurrentPeriodSubscriptionBuckets(
    buckets.map((bucket) =>
      currentPeriodBucketContribution(
        bucket.amount,
        lifetimeUsedByBucketId.get(bucket.id) ?? 0n,
        periodUsedByBucketId.get(bucket.id) ?? 0n,
      ),
    ),
  );

  return {
    total: convertCentsToCredits(normalizedCents.totalCents),
    used: convertCentsToCredits(normalizedCents.usedCents),
    remaining: convertCentsToCredits(normalizedCents.remainingCents),
  };
}

function currentPeriodBucketContribution(
  amountCents: bigint,
  lifetimeUsedCents: bigint,
  periodUsedCents: bigint,
): { remainingCents: bigint; usedThisPeriodCents: bigint } {
  const amount = amountCents > 0n ? amountCents : 0n;
  const lifetimeUsed = lifetimeUsedCents > 0n ? lifetimeUsedCents : 0n;
  const periodUsed = periodUsedCents > 0n ? periodUsedCents : 0n;
  const lifetimeCapped = lifetimeUsed > amount ? amount : lifetimeUsed;
  const remainingCents = amount - lifetimeCapped;
  const usedThisPeriodCents =
    periodUsed > lifetimeCapped ? lifetimeCapped : periodUsed;

  return { remainingCents, usedThisPeriodCents };
}

function summarizeCurrentPeriodSubscriptionBuckets(
  buckets: Array<{ remainingCents: bigint; usedThisPeriodCents: bigint }>,
): NormalizedSubscriptionCents {
  let remainingCents = 0n;
  let usedCents = 0n;
  for (const bucket of buckets) {
    remainingCents += bucket.remainingCents;
    usedCents += bucket.usedThisPeriodCents;
  }

  return normalizeSubscriptionCents(remainingCents + usedCents, usedCents);
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
  const total = Math.min(
    normalizedBuffer + subscriptionRemaining,
    totalCredits,
  );

  return {
    buffer: normalizedBuffer,
    total,
  };
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

export interface CreditsPayload {
  subscription: ReturnType<typeof mapSubscription>;
  buffer: number;
  total: number;
}

export interface CreditsApiPayload {
  subscription: ReturnType<typeof mapSubscription>;
  extra: {
    credits: {
      total: number;
      remaining: number;
      used: number;
    };
    buckets: Array<{
      total: number;
      remaining: number;
      expiresAt: Date | null;
    }>;
    enterprise: {
      credits: {
        total: number;
        remaining: number;
        used: number;
      };
      buckets: Array<{
        total: number;
        remaining: number;
        expiresAt: Date | null;
      }>;
    } | null;
  };
  credits: CreditsPayload;
}

export async function buildCreditsPayload(params: {
  userId: string;
  organizationId: string | null;
  referenceId: string;
  tx: Prisma.TransactionClient;
}): Promise<CreditsApiPayload> {
  const totalCredits = await getCredits(
    params.userId,
    params.organizationId,
    params.tx,
  );
  const latestSubscription =
    (await subscriptionRepository.resolveActiveSubscriptionByReferenceId(
      params.referenceId,
      params.tx,
    )) ??
    (await subscriptionRepository.getLatestSubscriptionByReferenceId(
      params.referenceId,
      params.tx,
    ));
  const subscriptionCredits = await getCurrentSubscriptionCredits({
    subscription: latestSubscription,
    userId: params.userId,
    organizationId: params.organizationId,
    tx: params.tx,
  });
  const subscription = mapSubscription(
    latestSubscription
      ? {
          ...latestSubscription,
          credits: subscriptionCredits,
        }
      : null,
  );
  const bucketRows =
    await creditBucketRepository.listAvailableBucketsWithBalances(
      params.userId,
      params.organizationId,
      params.tx,
    );

  const enterpriseBucketRows = params.organizationId
    ? await creditBucketRepository.listEnterprisePoolBucketsWithBalances(
        params.userId,
        params.organizationId,
        params.tx,
      )
    : [];

  const nonSubAggregates = bucketRows.reduce(
    (acc, row) => ({
      totalCents: acc.totalCents + row.totalCents,
      remainingCents: acc.remainingCents + row.remainingCents,
    }),
    { totalCents: 0n, remainingCents: 0n },
  );
  const nonSubUsedCents =
    nonSubAggregates.totalCents - nonSubAggregates.remainingCents;

  const buckets = bucketRows.map((row) => ({
    total: convertCentsToCredits(row.totalCents),
    remaining: convertCentsToCredits(row.remainingCents),
    expiresAt: row.expiresAt,
  }));

  const enterpriseAggregates = enterpriseBucketRows.reduce(
    (acc, row) => ({
      totalCents: acc.totalCents + row.totalCents,
      remainingCents: acc.remainingCents + row.remainingCents,
    }),
    { totalCents: 0n, remainingCents: 0n },
  );
  const enterpriseUsedCents =
    enterpriseAggregates.totalCents - enterpriseAggregates.remainingCents;
  const enterprise =
    enterpriseBucketRows.length > 0
      ? {
          credits: {
            total: convertCentsToCredits(enterpriseAggregates.totalCents),
            remaining: convertCentsToCredits(
              enterpriseAggregates.remainingCents,
            ),
            used: convertCentsToCredits(enterpriseUsedCents),
          },
          buckets: enterpriseBucketRows.map((row) => ({
            total: convertCentsToCredits(row.totalCents),
            remaining: convertCentsToCredits(row.remainingCents),
            expiresAt: row.expiresAt,
          })),
        }
      : null;

  const enterpriseRemainingCredits = enterprise?.credits.remaining ?? 0;
  const { buffer: bufferIncludingEnterprise, total } = getCreditSummary({
    totalCredits,
    subscriptionCredits,
  });
  const buffer = Math.max(
    0,
    bufferIncludingEnterprise - enterpriseRemainingCredits,
  );

  const credits = {
    subscription,
    buffer,
    total,
  };

  return {
    subscription,
    extra: {
      credits: {
        total: convertCentsToCredits(nonSubAggregates.totalCents),
        remaining: convertCentsToCredits(nonSubAggregates.remainingCents),
        used: convertCentsToCredits(nonSubUsedCents),
      },
      buckets,
      enterprise,
    },
    credits,
  };
}
