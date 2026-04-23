import { CreditBucketReferenceType, type Prisma } from "@sokosumi/database";
import { getOrganizationMemberSubscriptionReferencePrefixForStartsWith } from "@sokosumi/database/helpers";
import { subscriptionRepository } from "@sokosumi/database/repositories";
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

interface ExtraCreditsSummary {
  available: number;
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

  const currentPeriodBucketWhere = params.organizationId
    ? {
        referenceType: CreditBucketReferenceType.STRIPE_SUBSCRIPTION_PERIOD,
        organizationId: params.organizationId,
        userId: params.userId,
        referenceId: {
          startsWith:
            getOrganizationMemberSubscriptionReferencePrefixForStartsWith(
              params.userId,
            ),
        },
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

function buildActiveExtraCreditBucketWhere(params: {
  userId: string;
  organizationId: string | null;
  now: Date;
}): Prisma.CreditBucketWhereInput {
  const scopeWhere = params.organizationId
    ? {
        organizationId: params.organizationId,
      }
    : {
        userId: params.userId,
        organizationId: null,
      };

  return {
    ...scopeWhere,
    createdAt: {
      lt: params.now,
    },
    AND: [
      {
        OR: [{ expiresAt: null }, { expiresAt: { gt: params.now } }],
      },
      {
        OR: [
          { referenceType: null },
          {
            referenceType: {
              not: CreditBucketReferenceType.STRIPE_SUBSCRIPTION_PERIOD,
            },
          },
        ],
      },
    ],
  };
}

export async function getExtraCreditSummary(params: {
  userId: string;
  organizationId: string | null;
  tx: Prisma.TransactionClient;
  now?: Date;
}): Promise<ExtraCreditsSummary> {
  const now = params.now ?? new Date();
  const extraBucketWhere = buildActiveExtraCreditBucketWhere({
    userId: params.userId,
    organizationId: params.organizationId,
    now,
  });
  const [totalAggregateResult, usedAggregateResult] = await Promise.all([
    params.tx.creditBucket.aggregate({
      _sum: {
        amount: true,
      },
      where: extraBucketWhere,
    }),
    params.tx.creditConsumption.aggregate({
      _sum: {
        amount: true,
      },
      where: {
        bucket: {
          is: extraBucketWhere,
        },
      },
    }),
  ]);
  const normalizedCents = normalizeSubscriptionCents(
    totalAggregateResult._sum.amount ?? 0n,
    usedAggregateResult._sum.amount ?? 0n,
  );

  return {
    available: convertCentsToCredits(normalizedCents.remainingCents),
    total: convertCentsToCredits(normalizedCents.totalCents),
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
  extra: ExtraCreditsSummary;
  total: number;
}

export async function buildCreditsPayload(params: {
  userId: string;
  organizationId: string | null;
  referenceId: string;
  tx: Prisma.TransactionClient;
}): Promise<CreditsPayload> {
  const totalCredits = await getCredits(
    params.userId,
    params.organizationId,
    params.tx,
  );
  const latestSubscription =
    (await subscriptionRepository.getLatestActiveSubscriptionByReferenceId(
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
  const { buffer, total } = getCreditSummary({
    totalCredits,
    subscriptionCredits,
  });
  const extra = await getExtraCreditSummary({
    userId: params.userId,
    organizationId: params.organizationId,
    tx: params.tx,
  });

  return {
    subscription,
    buffer,
    extra,
    total,
  };
}
