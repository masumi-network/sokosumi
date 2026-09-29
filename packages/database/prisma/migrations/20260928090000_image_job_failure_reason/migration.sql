-- A stable, localisable reason for a failed generation.
--
-- The studio is offered in three languages, so an English sentence from the
-- server is a sentence most of the audience cannot read. `error` keeps a human
-- sentence as the fallback; this column is what a client branches on and
-- translates.
--
-- Deliberately TEXT and not an enum: a new reason should be a deploy, not an
-- enum-replacement migration, and Core maps a value it does not recognise to
-- `unknown` rather than failing the read. Existing rows keep NULL — they failed
-- before the studio recorded a reason, and inventing one for them would be a
-- guess about what went wrong months ago.

-- AlterTable
ALTER TABLE "project_image_job" ADD COLUMN "failureReason" TEXT;
