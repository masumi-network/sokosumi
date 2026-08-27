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
    AND: [creditBucketActivatesAtOrBefore(now), currentPeriodBucketScope],
  };

  const totalAggregateResult = await params.tx.creditBucket.aggregate({
    _sum: {
      amount: true,
    },
    where: currentPeriodBucketWhere,
  });
  const usedAggregateResult = await params.tx.creditConsumption.aggregate({
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
  });

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
