import {
  CreditBucketReferenceType,
  type Prisma,
} from "../generated/prisma/client.js";
import {
  ORGANIZATION_CREDIT_REFERENCE_PREFIX,
  ORGANIZATION_MEMBER_SUBSCRIPTION_REFERENCE_PREFIX,
} from "./credit.js";

export interface MemberPeriodPoolTransferResult {
  organizations: number;
  bucketsDrained: number;
  centsTransferred: bigint;
}

interface BucketWithRemaining {
  amount: bigint;
  expiresAt: Date | null;
  id: string;
  remaining: bigint;
}

function remainingOf(bucket: {
  amount: bigint;
  creditConsumptions: Array<{ amount: bigint }>;
}): bigint {
  const consumed = bucket.creditConsumptions.reduce(
    (sum, consumption) => sum + consumption.amount,
    0n,
  );
  const remaining = bucket.amount - consumed;
  return remaining > 0n ? remaining : 0n;
}

export function buildMigratedMemberPeriodPoolReferenceId(
  organizationId: string,
  transferredAt: Date,
): string {
  return `${ORGANIZATION_CREDIT_REFERENCE_PREFIX}${organizationId}:migrated-member-period:${transferredAt.toISOString()}`;
}

export async function transferMemberPeriodBucketsToOrganizationPool(
  tx: Prisma.TransactionClient,
): Promise<MemberPeriodPoolTransferResult> {
  const buckets = await tx.creditBucket.findMany({
    where: {
      organizationId: { not: null },
      referenceType: CreditBucketReferenceType.STRIPE_SUBSCRIPTION_PERIOD,
      referenceId: {
        startsWith: ORGANIZATION_MEMBER_SUBSCRIPTION_REFERENCE_PREFIX,
      },
      userId: { not: null },
    },
    select: {
      amount: true,
      expiresAt: true,
      id: true,
      organizationId: true,
      creditConsumptions: {
        select: { amount: true },
      },
    },
  });

  const byOrganization = new Map<string, BucketWithRemaining[]>();
  for (const bucket of buckets) {
    if (!bucket.organizationId) {
      continue;
    }
    const remaining = remainingOf(bucket);
    if (remaining <= 0n) {
      continue;
    }
    const group = byOrganization.get(bucket.organizationId) ?? [];
    group.push({
      amount: bucket.amount,
      expiresAt: bucket.expiresAt,
      id: bucket.id,
      remaining,
    });
    byOrganization.set(bucket.organizationId, group);
  }

  let bucketsDrained = 0;
  let centsTransferred = 0n;

  for (const [organizationId, group] of byOrganization) {
    const owner = await tx.member.findFirst({
      where: {
        organizationId,
        role: "owner",
      },
      select: { userId: true },
    });
    if (!owner) {
      continue;
    }

    const totalRemaining = group.reduce(
      (sum, bucket) => sum + bucket.remaining,
      0n,
    );
    if (totalRemaining <= 0n) {
      continue;
    }

    const latestExpiry = group.reduce<Date | null>((latest, bucket) => {
      if (!bucket.expiresAt) {
        return latest;
      }
      if (!latest || bucket.expiresAt > latest) {
        return bucket.expiresAt;
      }
      return latest;
    }, null);

    const transferredAt = new Date();
    await tx.transaction.create({
      data: {
        amount: totalRemaining * -1n,
        organizationId,
        userId: owner.userId,
        creditConsumptions: {
          createMany: {
            data: group.map((bucket) => ({
              bucketId: bucket.id,
              amount: bucket.remaining,
            })),
          },
        },
      },
    });

    await tx.transaction.create({
      data: {
        amount: totalRemaining,
        organizationId,
        userId: owner.userId,
        sourceCreditBucket: {
          create: {
            amount: totalRemaining,
            expiresAt: latestExpiry,
            organizationId,
            referenceId: buildMigratedMemberPeriodPoolReferenceId(
              organizationId,
              transferredAt,
            ),
            referenceType: CreditBucketReferenceType.STRIPE_SUBSCRIPTION_PERIOD,
            userId: null,
          },
        },
      },
    });

    bucketsDrained += group.length;
    centsTransferred += totalRemaining;
  }

  return {
    organizations: [...byOrganization.keys()].length,
    bucketsDrained,
    centsTransferred,
  };
}
