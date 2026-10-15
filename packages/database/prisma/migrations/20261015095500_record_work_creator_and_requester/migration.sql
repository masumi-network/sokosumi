-- Record who made and who asked for work (ADR 0056, expand step).
-- Task, Task Schedule and Job record their Creator (a person, a Coworker or a
-- Soko Bot) and, when a Coworker or Soko Bot acted for a person, that person
-- as Requester. The Owner is not touched.

-- AlterTable
ALTER TABLE "task" ADD COLUMN "requestedByUserId" TEXT;

-- AlterTable
ALTER TABLE "task_schedule" ADD COLUMN "requestedByUserId" TEXT;

-- AlterTable
ALTER TABLE "Job" ADD COLUMN "creatorUserId" TEXT,
ADD COLUMN "creatorCoworkerId" TEXT,
ADD COLUMN "creatorSokoBotId" UUID,
ADD COLUMN "requestedByUserId" TEXT;

-- Backfill. A Coworker or Soko Bot always acted for the Owner, so the Owner is
-- the Requester of the work they made.
UPDATE "task"
SET "requestedByUserId" = "ownerId"
WHERE "creatorCoworkerId" IS NOT NULL OR "creatorSokoBotId" IS NOT NULL;

UPDATE "task_schedule"
SET "requestedByUserId" = "ownerId"
WHERE "creatorCoworkerId" IS NOT NULL OR "creatorSokoBotId" IS NOT NULL;

-- A Job a Soko Bot delegation links to a turn was made by that turn's Soko Bot
-- for the Owner; every other Job was made by its Owner.
UPDATE "Job" AS j
SET "creatorSokoBotId" = delegated."sokoBotId",
    "requestedByUserId" = j."ownerId"
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

-- A deleted person leaves no Creator, so "exactly one" becomes "at most one".
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

-- A person making their own work is never its Requester.
ALTER TABLE "task" ADD CONSTRAINT "task_requester_not_person_creator_check" CHECK (
  "requestedByUserId" IS NULL OR "creatorUserId" IS NULL
);
ALTER TABLE "task_schedule" ADD CONSTRAINT "task_schedule_requester_not_person_creator_check" CHECK (
  "requestedByUserId" IS NULL OR "creatorUserId" IS NULL
);
ALTER TABLE "Job" ADD CONSTRAINT "Job_requester_not_person_creator_check" CHECK (
  "requestedByUserId" IS NULL OR "creatorUserId" IS NULL
);

-- Deleting a person empties their Creator column instead of blocking.
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

-- CreateIndex
CREATE INDEX "Job_requestedByUserId_idx" ON "Job"("requestedByUserId");

-- CreateIndex
CREATE INDEX "task_requestedByUserId_idx" ON "task"("requestedByUserId");

-- CreateIndex
CREATE INDEX "task_schedule_requestedByUserId_idx" ON "task_schedule"("requestedByUserId");

-- AddForeignKey
ALTER TABLE "Job" ADD CONSTRAINT "Job_creatorUserId_fkey" FOREIGN KEY ("creatorUserId") REFERENCES "user"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Job" ADD CONSTRAINT "Job_creatorCoworkerId_fkey" FOREIGN KEY ("creatorCoworkerId") REFERENCES "coworker"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Job" ADD CONSTRAINT "Job_creatorSokoBotId_fkey" FOREIGN KEY ("creatorSokoBotId") REFERENCES "soko_bot"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Job" ADD CONSTRAINT "Job_requestedByUserId_fkey" FOREIGN KEY ("requestedByUserId") REFERENCES "user"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "task" ADD CONSTRAINT "task_creatorUserId_fkey" FOREIGN KEY ("creatorUserId") REFERENCES "user"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "task" ADD CONSTRAINT "task_requestedByUserId_fkey" FOREIGN KEY ("requestedByUserId") REFERENCES "user"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "task_schedule" ADD CONSTRAINT "task_schedule_creatorUserId_fkey" FOREIGN KEY ("creatorUserId") REFERENCES "user"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "task_schedule" ADD CONSTRAINT "task_schedule_requestedByUserId_fkey" FOREIGN KEY ("requestedByUserId") REFERENCES "user"("id") ON DELETE SET NULL ON UPDATE CASCADE;
