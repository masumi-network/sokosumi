-- Record who made a Job, as Task and Task Schedule already do (ADR 0057): a
-- person, a Coworker or a Soko Bot. A deleted person leaves no Creator, so the
-- creator checks become "at most one" and a person Creator empties instead of
-- blocking the deletion.

-- AlterTable
ALTER TABLE "Job" ADD COLUMN "creatorUserId" TEXT,
ADD COLUMN "creatorCoworkerId" TEXT,
ADD COLUMN "creatorSokoBotId" UUID;

-- Backfill. A Job a Soko Bot delegation links to a turn was made by that
-- turn's Soko Bot; every other Job was made by its Owner.
UPDATE "Job" AS j
SET "creatorSokoBotId" = delegated."sokoBotId"
FROM (
  SELECT DISTINCT ON (d."jobId") d."jobId", t."sokoBotId"
  FROM "soko_bot_delegation" AS d
  JOIN "soko_bot_turn" AS t ON t."id" = d."turnId"
  WHERE d."jobId" IS NOT NULL
  ORDER BY d."jobId", d."createdAt", d."id"
) AS delegated
WHERE delegated."jobId" = j."id";

UPDATE "Job"
SET "creatorUserId" = "ownerId"
WHERE "creatorSokoBotId" IS NULL;

ALTER TABLE "task" DROP CONSTRAINT "task_creator_exactly_one_check";
ALTER TABLE "task" ADD CONSTRAINT "task_creator_at_most_one_check" CHECK (
  (
    ("creatorUserId" IS NOT NULL)::int
    + ("creatorCoworkerId" IS NOT NULL)::int
    + ("creatorSokoBotId" IS NOT NULL)::int
  ) <= 1
);

ALTER TABLE "task_schedule" DROP CONSTRAINT "task_schedule_creator_exactly_one_check";
ALTER TABLE "task_schedule" ADD CONSTRAINT "task_schedule_creator_at_most_one_check" CHECK (
  (
    ("creatorUserId" IS NOT NULL)::int
    + ("creatorCoworkerId" IS NOT NULL)::int
    + ("creatorSokoBotId" IS NOT NULL)::int
  ) <= 1
);

ALTER TABLE "Job" ADD CONSTRAINT "Job_creator_at_most_one_check" CHECK (
  (
    ("creatorUserId" IS NOT NULL)::int
    + ("creatorCoworkerId" IS NOT NULL)::int
    + ("creatorSokoBotId" IS NOT NULL)::int
  ) <= 1
);

-- DropForeignKey
ALTER TABLE "task" DROP CONSTRAINT "task_creatorUserId_fkey";

-- DropForeignKey
ALTER TABLE "task_schedule" DROP CONSTRAINT "task_schedule_creatorUserId_fkey";

-- CreateIndex
CREATE INDEX "Job_creatorUserId_idx" ON "Job"("creatorUserId");

-- CreateIndex
CREATE INDEX "Job_creatorCoworkerId_idx" ON "Job"("creatorCoworkerId");

-- CreateIndex
CREATE INDEX "Job_creatorSokoBotId_idx" ON "Job"("creatorSokoBotId");

-- AddForeignKey
ALTER TABLE "Job" ADD CONSTRAINT "Job_creatorUserId_fkey" FOREIGN KEY ("creatorUserId") REFERENCES "user"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Job" ADD CONSTRAINT "Job_creatorCoworkerId_fkey" FOREIGN KEY ("creatorCoworkerId") REFERENCES "coworker"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Job" ADD CONSTRAINT "Job_creatorSokoBotId_fkey" FOREIGN KEY ("creatorSokoBotId") REFERENCES "soko_bot"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "task" ADD CONSTRAINT "task_creatorUserId_fkey" FOREIGN KEY ("creatorUserId") REFERENCES "user"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "task_schedule" ADD CONSTRAINT "task_schedule_creatorUserId_fkey" FOREIGN KEY ("creatorUserId") REFERENCES "user"("id") ON DELETE SET NULL ON UPDATE CASCADE;
