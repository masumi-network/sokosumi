-- AlterTable
ALTER TABLE "project_studio_connection"
    ADD COLUMN "generationCreditLimit" INTEGER NOT NULL DEFAULT 0,
    ADD COLUMN "generationCreditsRemaining" INTEGER NOT NULL DEFAULT 0;

ALTER TABLE "project_studio_connection"
    ADD CONSTRAINT "project_studio_connection_generation_credits_check"
    CHECK ("generationCreditsRemaining" >= 0 AND "generationCreditsRemaining" <= "generationCreditLimit");
