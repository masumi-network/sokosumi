ALTER TABLE "coworker"
ADD COLUMN "archivedAt" TIMESTAMP(3);

CREATE INDEX "coworker_archivedAt_idx" ON "coworker"("archivedAt");
