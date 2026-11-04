-- Every contact has a first contact: one with no interaction gets the moment it was added.
UPDATE "contact" SET "firstContactAt" = "createdAt" WHERE "firstContactAt" IS NULL;
ALTER TABLE "contact" ALTER COLUMN "firstContactAt" SET DEFAULT CURRENT_TIMESTAMP;
ALTER TABLE "contact" ALTER COLUMN "firstContactAt" SET NOT NULL;
