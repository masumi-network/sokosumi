-- Data migration: Set onboardingCompleted to true for all existing users
UPDATE "public"."user"
SET "onboardingCompleted" = true
WHERE "onboardingCompleted" = false;


