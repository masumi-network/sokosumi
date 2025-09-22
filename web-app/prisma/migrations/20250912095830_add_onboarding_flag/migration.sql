-- AlterTable
ALTER TABLE "public"."user" ADD COLUMN     "onboardingCompleted" BOOLEAN NOT NULL DEFAULT false;

-- Data migration: Set onboardingCompleted to true for all existing users
UPDATE "public"."user"
SET "onboardingCompleted" = true
WHERE "onboardingCompleted" = false;