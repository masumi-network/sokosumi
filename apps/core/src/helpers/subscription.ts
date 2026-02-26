import { CreditBucketReferenceType, type Prisma } from "@sokosumi/database";
import {
  convertCentsToCredits,
  getOrganizationMemberSubscriptionReferencePrefix,
} from "@sokosumi/database/helpers";

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

  const currentPeriodBucketWhere = params.organizationId
    ? {
        referenceType: CreditBucketReferenceType.STRIPE_SUBSCRIPTION_PERIOD,
        organizationId: params.organizationId,
        userId: params.userId,
        referenceId: {
          startsWith: getOrganizationMemberSubscriptionReferencePrefix(
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
  const latestSubscription = await params.tx.subscription.findFirst({
    where: {
      referenceId: params.referenceId,
    },
    orderBy: { updatedAt: "desc" },
  });
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

  return {
    subscription,
    buffer,
    total,
  };
}
