/*
  Adds coworker profile metadata fields for richer UI presentation.
*/

ALTER TABLE "coworker"
ADD COLUMN "caption" TEXT,
ADD COLUMN "company" TEXT,
ADD COLUMN "companyLogo" TEXT;
