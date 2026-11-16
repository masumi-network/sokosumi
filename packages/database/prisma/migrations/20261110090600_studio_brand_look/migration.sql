-- AlterTable
ALTER TABLE "project"
    ADD COLUMN "studioBrandLook" JSONB,
    ADD COLUMN "studioBrandLookRevision" INTEGER NOT NULL DEFAULT 0;
