-- `file_index_job` is created by this branch (20260927180001), so this
-- alters nothing that existed before it. Separate from that migration
-- because it has already been applied to preprod.
--
-- Counts revivals from FAILED, which reset `attempt`. A bound of its own is
-- what keeps a document that fails for its own reasons from looping.
ALTER TABLE "file_index_job" ADD COLUMN "revivals" INTEGER NOT NULL DEFAULT 0;

-- The sweep's predicate: FAILED rows of one pipeline, oldest first, with
-- revivals left. Without this it is a sequential scan of the whole job
-- table on every tick that finds nothing to lease.
CREATE INDEX "file_index_job_state_pipeline_updatedAt_idx"
  ON "file_index_job"("state", "pipeline", "updatedAt");
