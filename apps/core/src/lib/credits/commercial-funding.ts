import { CreditBucketReferenceType, type Prisma } from "@sokosumi/database";
import { sharedTable } from "@sokosumi/database/sql-tables";
import { REFUND_PART_SEPARATOR } from "@/helpers/compensating-refund";
import type { NetworkScope } from "@/lib/db/network-scope";

/**
 * Tester credits (all Projects, or one): what a Cuso works on without a CMO
 * subscription, found by their type. The gate, free hiring, the unpaid-Cuso
 * rule and the hiring steps all read them through this.
 */
export function testerCreditsWhere(
  projectId?: string,
): Prisma.CreditBucketWhereInput {
  return {
    referenceType: CreditBucketReferenceType.CMO_TESTER_CREDITS,
    ...(projectId && { projectId }),
  };
}

export function testerFundingQuery(projectId: string, now: Date) {
  return {
    where: {
      AND: [
        testerCreditsWhere(projectId),
        { OR: [{ expiresAt: null }, { expiresAt: { gt: now } }] },
      ],
    },
    select: { amount: true, consumptions: { select: { amount: true } } },
  } satisfies Prisma.CreditBucketFindManyArgs;
}

export function testerFunding(
  scope: NetworkScope,
  projectId: string,
  now: Date,
) {
  return scope.networkDb.creditBucket.findMany(
    testerFundingQuery(projectId, now),
  );
}

export function findTesterGrant(scope: NetworkScope, projectId: string) {
  return scope.networkDb.creditBucket.findFirst({
    where: testerCreditsWhere(projectId),
    select: { id: true },
  });
}

export function refundParts(scope: NetworkScope, refundedJobIds: string[]) {
  return scope.networkDb.creditBucket.findMany({
    where: {
      referenceType: "REFUND",
      OR: refundedJobIds.map((id) => ({
        referenceId: { startsWith: `${id}${REFUND_PART_SEPARATOR}` },
      })),
    },
    select: { referenceId: true, amount: true },
  });
}

export function turnCharges(scope: NetworkScope, sokoBotId: string) {
  return scope.networkDb.sokoBotUsage.aggregate({
    where: { sokoBotId },
    _sum: { cents: true },
  });
}

// A quote only counts once it was charged, in the period it was charged.
export function projectImageCharges(
  scope: NetworkScope,
  projects: string[],
  since: Date,
) {
  return scope.sharedDb.$queryRaw<
    { projectId: string; cents: bigint | null }[]
  >`
      SELECT j."projectId", SUM(COALESCE(j."chargedCents", 0)) AS cents
      FROM ${sharedTable("project_image_job")} j
      JOIN ${scope.networkTable("Transaction")} t ON t.id = j."transactionId"
      WHERE j."projectId" = ANY(${projects}::uuid[]) AND t."createdAt" >= ${since}
      GROUP BY j."projectId"`;
}

export function turnChargesSince(
  scope: NetworkScope,
  bots: string[],
  lab: string[],
  since: Date,
) {
  return scope.sharedDb.$queryRaw<
    { sokoBotId: string; cents: bigint | null }[]
  >`
      SELECT "sokoBotId", SUM(cents) AS cents
      FROM ${scope.networkTable("soko_bot_usage")}
      WHERE "sokoBotId" = ANY(${bots}::uuid[]) AND "createdAt" >= ${since}
        -- A lab turn's charge names the turn; other charges name no turn.
        AND NOT (COALESCE("referenceId", '') = ANY(${lab}::text[]))
      GROUP BY "sokoBotId"`;
}
