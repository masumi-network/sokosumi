import {
  CreditBucketReferenceType,
  type Prisma,
} from "@sokosumi/database";
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

interface SubscriptionRecord extends SubscriptionPeriodRecord {
  id: string;
  plan: string;
  status: string;
  cancelAtPeriodEnd: boolean | null;
  credits?: SubscriptionCredits | null;
}

export async function getCurrentSubscriptionCredits(params: {
  subscription: SubscriptionPeriodRecord | null;
  userId: string;
  organizationId: string | null;
  tx: Prisma.TransactionClient;
  now?: Date;
}): Promise<SubscriptionCredits | null> {
  if (!params.subscription) {
    return null;
  }

  const periodStart = params.subscription.periodStart;
  const periodEnd = params.subscription.periodEnd;
  const now = params.now ?? new Date();
  if (!periodStart || !periodEnd || periodEnd <= periodStart) {
    return null;
  }

  if (periodStart > now || periodEnd <= now) {
    return null;
  }

  const currentPeriodBucketWhere = params.organizationId
    ? {
        referenceType: CreditBucketReferenceType.STRIPE_SUBSCRIPTION_PERIOD,
        organizationId: params.organizationId,
        expiresAt: periodEnd,
        createdAt: {
          gte: periodStart,
          lt: periodEnd,
        },
      }
    : {
        referenceType: CreditBucketReferenceType.STRIPE_SUBSCRIPTION_PERIOD,
        userId: params.userId,
        organizationId: null,
        expiresAt: periodEnd,
        createdAt: {
          gte: periodStart,
          lt: periodEnd,
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
          gte: periodStart,
          lt: now,
        },
        bucket: {
          is: currentPeriodBucketWhere,
        },
      },
    }),
  ]);

  const totalCents = totalAggregateResult._sum.amount ?? 0n;
  const usedCents = usedAggregateResult._sum.amount ?? 0n;
  const remainingCents = totalCents > usedCents ? totalCents - usedCents : 0n;

  return {
    total: convertCentsToCredits(totalCents),
    used: convertCentsToCredits(usedCents),
    remaining: convertCentsToCredits(remainingCents),
  };
}

export function mapSubscription(subscription: SubscriptionRecord | null) {
  if (!subscription) {
    return null;
  }

  return {
    id: subscription.id,
    plan: subscription.plan,
    status: subscription.status,
    periodStart: subscription.periodStart,
    periodEnd: subscription.periodEnd,
    cancelAtPeriodEnd: subscription.cancelAtPeriodEnd,
    credits: subscription.credits ?? null,
  };
}
