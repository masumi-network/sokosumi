import "dotenv/config";

import { createPrismaClient } from "../../src/client.js";
import {
  CreditBucketReferenceType,
  Prisma,
} from "../../src/generated/prisma/client.js";
import {
  ORGANIZATION_MEMBER_SUBSCRIPTION_REFERENCE_PREFIX,
  splitAmountEvenlyWithRemainderRotation,
} from "../../src/helpers/credit.js";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  throw new Error("DATABASE_URL is required");
}

const prisma = createPrismaClient(databaseUrl);

const LEGACY_SPLIT_REFERENCE_SEGMENT = "legacy-split";

class OrganizationWithoutMembersError extends Error {
  organizationId: string;

  constructor(organizationId: string) {
    super(
      `Organization ${organizationId} has no members; legacy subscription buckets were not migrated`,
    );
    this.name = "OrganizationWithoutMembersError";
    this.organizationId = organizationId;
  }
}

interface LegacyBucketWithAvailable {
  id: string;
  amount: bigint;
  available: bigint;
  expiresAt: Date | null;
  createdAt: Date;
}

interface OrganizationMigrationStats {
  bucketsExpired: number;
  bucketsExamined: number;
  memberBucketsCreated: number;
  memberBucketsSkipped: number;
  remainingAvailableCents: bigint;
  splitCentsCreated: bigint;
}

function getSortedUniqueMemberUserIds(
  members: Array<{ userId: string }>,
): string[] {
  return Array.from(new Set(members.map((member) => member.userId))).sort();
}

function buildLegacySplitReferenceId(
  userId: string,
  legacyBucketId: string,
): string {
  return `${ORGANIZATION_MEMBER_SUBSCRIPTION_REFERENCE_PREFIX}${userId}:${LEGACY_SPLIT_REFERENCE_SEGMENT}:${legacyBucketId}`;
}

async function getLegacyOrganizationIds(
  migrationTime: Date,
): Promise<string[]> {
  const organizations = await prisma.creditBucket.findMany({
    where: {
      organizationId: {
        not: null,
      },
      referenceType: CreditBucketReferenceType.STRIPE_SUBSCRIPTION_PERIOD,
      AND: [
        {
          OR: [
            {
              expiresAt: null,
            },
            {
              expiresAt: {
                gt: migrationTime,
              },
            },
          ],
        },
        {
          OR: [
            {
              referenceId: null,
            },
            {
              referenceId: {
                not: {
                  startsWith: ORGANIZATION_MEMBER_SUBSCRIPTION_REFERENCE_PREFIX,
                },
              },
            },
          ],
        },
      ],
    },
    select: {
      organizationId: true,
    },
    distinct: ["organizationId"],
  });

  return organizations
    .map((organization) => organization.organizationId)
    .filter(
      (organizationId): organizationId is string => organizationId !== null,
    )
    .sort();
}

async function getLegacyBucketsForOrganization(params: {
  organizationId: string;
  migrationTime: Date;
  tx: Prisma.TransactionClient;
}): Promise<LegacyBucketWithAvailable[]> {
  return params.tx.$queryRaw<LegacyBucketWithAvailable[]>`
    SELECT
      cb.id,
      cb.amount,
      cb."expiresAt",
      cb."createdAt",
      (cb.amount - COALESCE(SUM(cc.amount), 0))::bigint AS available
    FROM credit_bucket cb
    LEFT JOIN credit_consumption cc ON cc."bucketId" = cb.id
    WHERE cb."organizationId" = ${params.organizationId}
      AND cb."referenceType" = ${CreditBucketReferenceType.STRIPE_SUBSCRIPTION_PERIOD}
      AND (cb."expiresAt" IS NULL OR cb."expiresAt" > ${params.migrationTime})
      AND (
        cb."referenceId" IS NULL
        OR cb."referenceId" NOT LIKE ${`${ORGANIZATION_MEMBER_SUBSCRIPTION_REFERENCE_PREFIX}%`}
      )
    GROUP BY cb.id, cb.amount, cb."expiresAt"
    ORDER BY cb."expiresAt" ASC NULLS LAST, cb."createdAt" ASC, cb.id ASC
  `;
}

async function getOrganizationsWithoutMembers(
  organizationIds: string[],
): Promise<string[]> {
  if (organizationIds.length === 0) {
    return [];
  }

  const memberCounts = await prisma.member.groupBy({
    by: ["organizationId"],
    where: {
      organizationId: {
        in: organizationIds,
      },
    },
    _count: {
      _all: true,
    },
  });

  const organizationsWithMembers = new Set(
    memberCounts
      .filter((count) => count._count._all > 0)
      .map((count) => count.organizationId),
  );

  return organizationIds.filter(
    (organizationId) => !organizationsWithMembers.has(organizationId),
  );
}

interface NegativeAvailableLegacyBucket {
  organizationId: string;
  bucketId: string;
  available: bigint;
}

async function getNegativeAvailableLegacyBuckets(params: {
  organizationIds: string[];
  migrationTime: Date;
}): Promise<NegativeAvailableLegacyBucket[]> {
  if (params.organizationIds.length === 0) {
    return [];
  }

  return prisma.$queryRaw<NegativeAvailableLegacyBucket[]>`
    SELECT
      cb."organizationId" AS "organizationId",
      cb.id AS "bucketId",
      (cb.amount - COALESCE(SUM(cc.amount), 0))::bigint AS available
    FROM credit_bucket cb
    LEFT JOIN credit_consumption cc ON cc."bucketId" = cb.id
    WHERE cb."organizationId" = ANY(${params.organizationIds})
      AND cb."referenceType" = ${CreditBucketReferenceType.STRIPE_SUBSCRIPTION_PERIOD}
      AND (cb."expiresAt" IS NULL OR cb."expiresAt" > ${params.migrationTime})
      AND (
        cb."referenceId" IS NULL
        OR cb."referenceId" NOT LIKE ${`${ORGANIZATION_MEMBER_SUBSCRIPTION_REFERENCE_PREFIX}%`}
      )
    GROUP BY cb."organizationId", cb.id, cb.amount
    HAVING (cb.amount - COALESCE(SUM(cc.amount), 0)) < 0
    ORDER BY cb."organizationId" ASC, cb.id ASC
  `;
}

async function migrateOrganization(params: {
  migrationTime: Date;
  organizationId: string;
}): Promise<OrganizationMigrationStats> {
  return prisma.$transaction(
    async (tx) => {
      const members = await tx.member.findMany({
        where: {
          organizationId: params.organizationId,
        },
        select: {
          userId: true,
        },
        orderBy: {
          userId: "asc",
        },
      });
      const memberUserIds = getSortedUniqueMemberUserIds(members);
      if (memberUserIds.length === 0) {
        throw new OrganizationWithoutMembersError(params.organizationId);
      }

      const legacyBuckets = await getLegacyBucketsForOrganization({
        organizationId: params.organizationId,
        migrationTime: params.migrationTime,
        tx,
      });

      if (legacyBuckets.length === 0) {
        return {
          bucketsExpired: 0,
          bucketsExamined: 0,
          memberBucketsCreated: 0,
          memberBucketsSkipped: 0,
          remainingAvailableCents: 0n,
          splitCentsCreated: 0n,
        };
      }

      await tx.creditBucket.updateMany({
        where: {
          id: {
            in: legacyBuckets.map((bucket) => bucket.id),
          },
          OR: [
            {
              expiresAt: null,
            },
            {
              expiresAt: {
                gt: params.migrationTime,
              },
            },
          ],
        },
        data: {
          expiresAt: params.migrationTime,
        },
      });

      let memberBucketsCreated = 0;
      let memberBucketsSkipped = 0;
      let remainingAvailableCents = 0n;
      let splitCentsCreated = 0n;
      let remainderOffset = 0;

      for (const legacyBucket of legacyBuckets) {
        if (legacyBucket.available <= 0n) {
          continue;
        }

        remainingAvailableCents += legacyBucket.available;
        const splitResult = splitAmountEvenlyWithRemainderRotation({
          memberIds: memberUserIds,
          remainderOffset,
          totalAmount: legacyBucket.available,
        });
        remainderOffset = splitResult.nextRemainderOffset;

        for (const allocation of splitResult.allocations) {
          const referenceId = buildLegacySplitReferenceId(
            allocation.memberId,
            legacyBucket.id,
          );

          const existingBucket = await tx.creditBucket.findUnique({
            where: {
              referenceId_referenceType: {
                referenceId,
                referenceType:
                  CreditBucketReferenceType.STRIPE_SUBSCRIPTION_PERIOD,
              },
            },
          });

          if (existingBucket) {
            memberBucketsSkipped += 1;
            continue;
          }

          await tx.transaction.create({
            data: {
              amount: allocation.amount,
              user: {
                connect: {
                  id: allocation.memberId,
                },
              },
              organization: {
                connect: {
                  id: params.organizationId,
                },
              },
              sourceCreditBucket: {
                create: {
                  amount: allocation.amount,
                  expiresAt: legacyBucket.expiresAt,
                  referenceId,
                  referenceType:
                    CreditBucketReferenceType.STRIPE_SUBSCRIPTION_PERIOD,
                  userId: allocation.memberId,
                  organizationId: params.organizationId,
                },
              },
            },
          });

          memberBucketsCreated += 1;
          splitCentsCreated += allocation.amount;
        }
      }

      return {
        bucketsExpired: legacyBuckets.length,
        bucketsExamined: legacyBuckets.length,
        memberBucketsCreated,
        memberBucketsSkipped,
        remainingAvailableCents,
        splitCentsCreated,
      };
    },
    {
      isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
    },
  );
}

async function main() {
  const migrationTime = new Date();
  console.log(
    `Starting split_org_subscription_wallets data migration at ${migrationTime.toISOString()}`,
  );

  const organizationIds = await getLegacyOrganizationIds(migrationTime);
  console.log(
    `Found ${organizationIds.length} organizations with legacy subscription buckets`,
  );
  const organizationsWithoutMembers =
    await getOrganizationsWithoutMembers(organizationIds);
  if (organizationsWithoutMembers.length > 0) {
    throw new Error(
      `Organizations with zero members were skipped: ${organizationsWithoutMembers.join(", ")}`,
    );
  }

  const negativeAvailableLegacyBuckets = await getNegativeAvailableLegacyBuckets({
    organizationIds,
    migrationTime,
  });
  if (negativeAvailableLegacyBuckets.length > 0) {
    throw new Error(
      `Negative available legacy buckets detected; aborting migration: ${negativeAvailableLegacyBuckets
        .map(
          (bucket) =>
            `${bucket.organizationId}/${bucket.bucketId} (available=${bucket.available})`,
        )
        .join(", ")}`,
    );
  }

  let totalOrganizationsMigrated = 0;
  let totalBucketsExpired = 0;
  let totalMemberBucketsCreated = 0;
  let totalMemberBucketsSkipped = 0;
  let totalRemainingAvailableCents = 0n;
  let totalSplitCentsCreated = 0n;

  for (const organizationId of organizationIds) {
    const stats = await migrateOrganization({
      migrationTime,
      organizationId,
    });

    totalOrganizationsMigrated += 1;
    totalBucketsExpired += stats.bucketsExpired;
    totalMemberBucketsCreated += stats.memberBucketsCreated;
    totalMemberBucketsSkipped += stats.memberBucketsSkipped;
    totalRemainingAvailableCents += stats.remainingAvailableCents;
    totalSplitCentsCreated += stats.splitCentsCreated;

    console.log(
      `Migrated organization ${organizationId}: legacyBuckets=${stats.bucketsExamined}, memberBucketsCreated=${stats.memberBucketsCreated}, memberBucketsSkipped=${stats.memberBucketsSkipped}, remainingAvailableCents=${stats.remainingAvailableCents}, splitCentsCreated=${stats.splitCentsCreated}`,
    );
  }

  console.log(
    `Migration summary: organizationsMigrated=${totalOrganizationsMigrated}, bucketsExpired=${totalBucketsExpired}, memberBucketsCreated=${totalMemberBucketsCreated}, memberBucketsSkipped=${totalMemberBucketsSkipped}, remainingAvailableCents=${totalRemainingAvailableCents}, splitCentsCreated=${totalSplitCentsCreated}`,
  );

  if (totalSplitCentsCreated !== totalRemainingAvailableCents) {
    throw new Error(
      `Split mismatch detected: remainingAvailableCents=${totalRemainingAvailableCents}, splitCentsCreated=${totalSplitCentsCreated}`,
    );
  }

  console.log("split_org_subscription_wallets data migration completed");
}

main()
  .catch(async (error) => {
    console.error("Migration failed:", error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
