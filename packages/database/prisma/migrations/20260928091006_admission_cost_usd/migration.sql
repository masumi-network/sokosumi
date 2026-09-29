-- Record what each Jev call actually cost, so a daily spend budget can be
-- enforced from observed cost rather than from an assumed price per token.
--
-- Nullable: it is written at dispatch, and a call that never reached the
-- provider has no cost. The budget treats null as unknown, not as zero.
ALTER TABLE "file_authorization_admission" ADD COLUMN "costUsd" DECIMAL(12,6);
