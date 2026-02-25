ALTER TABLE "coworker"
ADD COLUMN "isWhitelisted" BOOLEAN NOT NULL DEFAULT true;

ALTER TABLE "coworker"
ALTER COLUMN "isWhitelisted" SET DEFAULT false;
