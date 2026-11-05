-- AlterTable
ALTER TABLE "social_account_post" ADD COLUMN "contentType" TEXT NOT NULL DEFAULT 'unknown';
ALTER TABLE "social_account_post" ADD COLUMN "postKind" TEXT NOT NULL DEFAULT 'unknown';
ALTER TABLE "social_account_post" ADD COLUMN "media" JSONB NOT NULL DEFAULT '[]';
