-- Resume the adoption of pre-existing Drive objects across visits.
--
-- Backfill previously ran only for a store with zero catalog rows and read a
-- single 200-object listing page, so a larger store permanently exposed its
-- first 200 files and a store with any upload after the deploy was never
-- backfilled at all.
ALTER TABLE "file_evidence_scope"
  ADD COLUMN "backfillCursor" TEXT,
  ADD COLUMN "backfilledAt" TIMESTAMP(3);
