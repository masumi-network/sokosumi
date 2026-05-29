-- AlterTable
ALTER TABLE "member" ADD COLUMN "seatAssignedAt" TIMESTAMP(3);

-- CreateIndex
CREATE INDEX "member_organizationId_seatAssignedAt_idx" ON "member"("organizationId", "seatAssignedAt");

-- Backfill: assign seats to existing members up to purchased subscription capacity
WITH active_org_subscriptions AS (
  SELECT DISTINCT ON ("referenceId")
    "referenceId" AS "organizationId",
    GREATEST(COALESCE("seats", 1), 1) AS "purchasedSeats"
  FROM "subscription"
  WHERE "status" IN ('active', 'trialing', 'past_due', 'unpaid')
  ORDER BY "referenceId", "createdAt" DESC
),
ranked_members AS (
  SELECT
    "member"."id",
    "member"."organizationId",
    ROW_NUMBER() OVER (
      PARTITION BY "member"."organizationId"
      ORDER BY "member"."createdAt" ASC
    ) AS "memberRank"
  FROM "member"
  INNER JOIN active_org_subscriptions
    ON active_org_subscriptions."organizationId" = "member"."organizationId"
)
UPDATE "member"
SET "seatAssignedAt" = CURRENT_TIMESTAMP
FROM ranked_members
INNER JOIN active_org_subscriptions
  ON active_org_subscriptions."organizationId" = ranked_members."organizationId"
WHERE "member"."id" = ranked_members."id"
  AND ranked_members."memberRank" <= active_org_subscriptions."purchasedSeats";
