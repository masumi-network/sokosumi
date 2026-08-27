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
  consumptions: Array<{ amount: bigint }>;
}): bigint {
  const consumed = bucket.consumptions.reduce(
    (sum, consumption) => sum + consumption.amount,
    0n,
  );
  const remaining = bucket.amount - consumed;
  return remaining > 0n ? remaining : 0n;
}

function expiryGroupKey(expiresAt: Date | null): string {
  return expiresAt ? expiresAt.toISOString() : "none";
}

export function buildMigratedMemberPeriodPoolReferenceId(
  organizationId: string,
  transferredAt: Date,
  expiresAt: Date | null = null,
): string {
  return `${ORGANIZATION_CREDIT_REFERENCE_PREFIX}${organizationId}:migrated-member-period:${transferredAt.toISOString()}:${expiryGroupKey(expiresAt)}`;
}

export async function transferMemberPeriodBucketsToOrganizationPool(
  tx: Prisma.TransactionClient,
  organizationId?: string,
  now: Date = new Date(),
): Promise<MemberPeriodPoolTransferResult> {
  const buckets = await tx.creditBucket.findMany({
    where: {
      organizationId: organizationId ?? { not: null },
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
      consumptions: {
        select: { amount: true },
      },
    },
  });

  const byOrganizationAndExpiry = new Map<
    string,
    {
      buckets: BucketWithRemaining[];
      expiresAt: Date | null;
      organizationId: string;
    }
  >();
  for (const bucket of buckets) {
    if (!bucket.organizationId) {
      continue;
    }
    if (bucket.expiresAt && bucket.expiresAt <= now) {
      continue;
    }
    const remaining = remainingOf(bucket);
    if (remaining <= 0n) {
      continue;
    }
    const key = `${bucket.organizationId}:${expiryGroupKey(bucket.expiresAt)}`;
    const group = byOrganizationAndExpiry.get(key) ?? {
      buckets: [],
      expiresAt: bucket.expiresAt,
      organizationId: bucket.organizationId,
    };
    group.buckets.push({
      amount: bucket.amount,
      expiresAt: bucket.expiresAt,
      id: bucket.id,
      remaining,
    });
    byOrganizationAndExpiry.set(key, group);
  }

  let bucketsDrained = 0;
  let centsTransferred = 0n;
  const transferredOrganizations = new Set<string>();

  for (const group of byOrganizationAndExpiry.values()) {
    const owner = await tx.member.findFirst({
      where: {
        organizationId: group.organizationId,
        role: "owner",
      },
      select: { userId: true },
    });
    if (!owner) {
      continue;
    }

    const totalRemaining = group.buckets.reduce(
      (sum, bucket) => sum + bucket.remaining,
      0n,
    );
    if (totalRemaining <= 0n) {
      continue;
    }

    const transferredAt = new Date();
    await tx.transaction.create({
      data: {
        amount: totalRemaining * -1n,
        organizationId: group.organizationId,
        userId: owner.userId,
        creditConsumptions: {
          createMany: {
            data: group.buckets.map((bucket) => ({
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
        organizationId: group.organizationId,
        userId: owner.userId,
        sourceCreditBucket: {
          create: {
            amount: totalRemaining,
            expiresAt: group.expiresAt,
            organizationId: group.organizationId,
            referenceId: buildMigratedMemberPeriodPoolReferenceId(
              group.organizationId,
              transferredAt,
              group.expiresAt,
            ),
            referenceType: CreditBucketReferenceType.STRIPE_SUBSCRIPTION_PERIOD,
            userId: null,
          },
        },
      },
    });

    bucketsDrained += group.buckets.length;
    centsTransferred += totalRemaining;
    transferredOrganizations.add(group.organizationId);
  }

  return {
    organizations: transferredOrganizations.size,
    bucketsDrained,
    centsTransferred,
  };
}
