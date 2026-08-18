-- SOK-799: Retire User.onboardingCompleted (no replacement boolean).
ALTER TABLE "user" DROP COLUMN "onboardingCompleted";
