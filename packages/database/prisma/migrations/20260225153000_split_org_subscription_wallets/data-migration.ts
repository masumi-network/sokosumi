import "dotenv/config";

import {
  CreditBucketReferenceType,
  Prisma,
} from "../../../src/generated/prisma/client.js";
import { ORGANIZATION_MEMBER_SUBSCRIPTION_REFERENCE_PREFIX } from "../../../src/helpers/credit.js";
import { createPrismaClient } from "../../../src/client.js";

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

function splitAmountEvenly(params: {
  memberUserIds: string[];
  totalAmount: bigint;
}): Array<{ amount: bigint; userId: string }> {
  if (params.totalAmount <= 0n || params.memberUserIds.length === 0) {
    return [];
  }

  const memberCount = BigInt(params.memberUserIds.length);
  const baseAmount = params.totalAmount / memberCount;
  const remainder = Number(params.totalAmount % memberCount);

  return params.memberUserIds
    .map((userId, index) => ({
      userId,
      amount: baseAmount + (index < remainder ? 1n : 0n),
    }))
    .filter((allocation) => allocation.amount > 0n);
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

      for (const legacyBucket of legacyBuckets) {
        if (legacyBucket.available <= 0n) {
          continue;
        }

        remainingAvailableCents += legacyBucket.available;
        const allocations = splitAmountEvenly({
          memberUserIds,
          totalAmount: legacyBucket.available,
        });

        for (const allocation of allocations) {
          const referenceId = buildLegacySplitReferenceId(
            allocation.userId,
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
                  id: allocation.userId,
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
                  userId: allocation.userId,
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

  const organizationsWithoutMembers: string[] = [];

  let totalOrganizationsMigrated = 0;
  let totalBucketsExpired = 0;
  let totalMemberBucketsCreated = 0;
  let totalMemberBucketsSkipped = 0;
  let totalRemainingAvailableCents = 0n;
  let totalSplitCentsCreated = 0n;

  for (const organizationId of organizationIds) {
    try {
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
    } catch (error) {
      if (error instanceof OrganizationWithoutMembersError) {
        organizationsWithoutMembers.push(error.organizationId);
        console.error(error.message);
        continue;
      }

      throw error;
    }
  }

  console.log(
    `Migration summary: organizationsMigrated=${totalOrganizationsMigrated}, bucketsExpired=${totalBucketsExpired}, memberBucketsCreated=${totalMemberBucketsCreated}, memberBucketsSkipped=${totalMemberBucketsSkipped}, remainingAvailableCents=${totalRemainingAvailableCents}, splitCentsCreated=${totalSplitCentsCreated}`,
  );

  if (totalSplitCentsCreated !== totalRemainingAvailableCents) {
    throw new Error(
      `Split mismatch detected: remainingAvailableCents=${totalRemainingAvailableCents}, splitCentsCreated=${totalSplitCentsCreated}`,
    );
  }

  if (organizationsWithoutMembers.length > 0) {
    throw new Error(
      `Organizations with zero members were skipped: ${organizationsWithoutMembers.join(", ")}`,
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
