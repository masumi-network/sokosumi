import {
  CreditBucketReferenceType,
  Prisma,
} from "../generated/prisma/client.js";
import {
  ORGANIZATION_CREDIT_REFERENCE_PREFIX,
  ORGANIZATION_MEMBER_SUBSCRIPTION_REFERENCE_PREFIX,
} from "./credit.js";

export interface MemberPeriodPoolTransferResult {
  organizations: number;
  bucketsDrained: number;
  centsTransferred: bigint;
  skippedNoActor: number;
}

interface LeftoverMemberPeriodBucket {
  activatesAt: Date | null;
  amount: bigint;
  expiresAt: Date | null;
  id: string;
  organizationId: string;
  remaining: bigint;
}

function expiryGroupKey(expiresAt: Date | null): string {
  return expiresAt ? expiresAt.toISOString() : "none";
}

export function buildMigratedMemberPeriodPoolReferenceId(
  organizationId: string,
  transferredAt: Date,
  expiresAt: Date | null = null,
  activatesAt: Date | null = null,
): string {
  return `${ORGANIZATION_CREDIT_REFERENCE_PREFIX}${organizationId}:migrated-member-period:${transferredAt.toISOString()}:${expiryGroupKey(expiresAt)}:${expiryGroupKey(activatesAt)}`;
}

const leftoverMemberPeriodWhereSql = Prisma.sql`
  cb."referenceType" = ${CreditBucketReferenceType.STRIPE_SUBSCRIPTION_PERIOD}
  AND cb."referenceId" LIKE ${`${ORGANIZATION_MEMBER_SUBSCRIPTION_REFERENCE_PREFIX}%`}
  AND cb."userId" IS NOT NULL
`;

export async function listOrganizationIdsWithLeftoverMemberPeriodRemaining(
  tx: Prisma.TransactionClient,
  now: Date = new Date(),
): Promise<string[]> {
  const rows = await tx.$queryRaw<Array<{ organizationId: string }>>`
    SELECT DISTINCT leftover."organizationId"
    FROM (
      SELECT
        cb."organizationId"
      FROM credit_bucket cb
      LEFT JOIN credit_consumption cc ON cc."bucketId" = cb.id
      WHERE cb."organizationId" IS NOT NULL
        AND ${leftoverMemberPeriodWhereSql}
        AND (cb."expiresAt" IS NULL OR cb."expiresAt" > ${now})
      GROUP BY cb.id, cb."organizationId", cb.amount
      HAVING (cb.amount - COALESCE(SUM(cc.amount), 0)) > 0
    ) AS leftover
  `;

  return rows.map((row) => row.organizationId);
}

async function listLeftoverMemberPeriodBucketsWithRemaining(
  tx: Prisma.TransactionClient,
  now: Date,
  organizationId?: string,
): Promise<LeftoverMemberPeriodBucket[]> {
  const organizationFilter = organizationId
    ? Prisma.sql`cb."organizationId" = ${organizationId}`
    : Prisma.sql`cb."organizationId" IS NOT NULL`;

  return await tx.$queryRaw<LeftoverMemberPeriodBucket[]>`
    SELECT
      cb.id,
      cb.amount,
      cb."expiresAt",
      cb."activatesAt",
      cb."organizationId",
      (cb.amount - COALESCE(SUM(cc.amount), 0))::bigint AS remaining
    FROM credit_bucket cb
    LEFT JOIN credit_consumption cc ON cc."bucketId" = cb.id
    WHERE ${organizationFilter}
      AND ${leftoverMemberPeriodWhereSql}
      AND (cb."expiresAt" IS NULL OR cb."expiresAt" > ${now})
    GROUP BY cb.id, cb.amount, cb."expiresAt", cb."activatesAt", cb."organizationId"
    HAVING (cb.amount - COALESCE(SUM(cc.amount), 0)) > 0
  `;
}

async function resolveTransferActorUserId(
  tx: Prisma.TransactionClient,
  organizationId: string,
): Promise<string | null> {
  const owner = await tx.member.findFirst({
    where: {
      organizationId,
      role: "owner",
    },
    select: { userId: true },
  });
  if (owner) {
    return owner.userId;
  }

  const member = await tx.member.findFirst({
    where: { organizationId },
    orderBy: { createdAt: "asc" },
    select: { userId: true },
  });
  return member?.userId ?? null;
}

export async function transferMemberPeriodBucketsToOrganizationPool(
  tx: Prisma.TransactionClient,
  organizationId?: string,
  now: Date = new Date(),
): Promise<MemberPeriodPoolTransferResult> {
  const buckets = await listLeftoverMemberPeriodBucketsWithRemaining(
    tx,
    now,
    organizationId,
  );

  const byOrganizationAndSchedule = new Map<
    string,
    {
      activatesAt: Date | null;
      buckets: LeftoverMemberPeriodBucket[];
      expiresAt: Date | null;
      organizationId: string;
    }
  >();
  for (const bucket of buckets) {
    const key = `${bucket.organizationId}:${expiryGroupKey(bucket.expiresAt)}:${expiryGroupKey(bucket.activatesAt)}`;
    const group = byOrganizationAndSchedule.get(key) ?? {
      activatesAt: bucket.activatesAt,
      buckets: [],
      expiresAt: bucket.expiresAt,
      organizationId: bucket.organizationId,
    };
    group.buckets.push(bucket);
    byOrganizationAndSchedule.set(key, group);
  }

  const actorByOrganization = new Map<string, string>();
  const skippedOrganizations = new Set<string>();
  for (const organization of new Set(
    buckets.map((bucket) => bucket.organizationId),
  )) {
    const actorUserId = await resolveTransferActorUserId(tx, organization);
    if (actorUserId) {
      actorByOrganization.set(organization, actorUserId);
    } else {
      skippedOrganizations.add(organization);
    }
  }

  let bucketsDrained = 0;
  let centsTransferred = 0n;
  const transferredOrganizations = new Set<string>();

  for (const group of byOrganizationAndSchedule.values()) {
    const actorUserId = actorByOrganization.get(group.organizationId);
    if (!actorUserId) {
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
        userId: actorUserId,
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
        userId: actorUserId,
        sourceCreditBucket: {
          create: {
            activatesAt: group.activatesAt,
            amount: totalRemaining,
            expiresAt: group.expiresAt,
            organizationId: group.organizationId,
            referenceId: buildMigratedMemberPeriodPoolReferenceId(
              group.organizationId,
              transferredAt,
              group.expiresAt,
              group.activatesAt,
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
    skippedNoActor: skippedOrganizations.size,
  };
}
