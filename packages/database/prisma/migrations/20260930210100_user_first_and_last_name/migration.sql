-- First and last name, asked at email sign-up and in onboarding. "name" stays
-- the display name. Nullable with no backfill: users from before this keep
-- null, because splitting a display name into parts guesses wrong.
ALTER TABLE "user" ADD COLUMN "firstName" TEXT,
ADD COLUMN "lastName" TEXT;
