-- More ways to classify a contact than the sales pipeline: a plain contact
-- (the new default) and the kinds of relationship. Its own migration:
-- Postgres cannot use a new enum value in the transaction that added it (the
-- default and the backfill follow).
ALTER TYPE "ContactStage" ADD VALUE IF NOT EXISTS 'CONTACT';
ALTER TYPE "ContactStage" ADD VALUE IF NOT EXISTS 'VENDOR';
ALTER TYPE "ContactStage" ADD VALUE IF NOT EXISTS 'ADVISOR';
ALTER TYPE "ContactStage" ADD VALUE IF NOT EXISTS 'COMMUNITY';
ALTER TYPE "ContactStage" ADD VALUE IF NOT EXISTS 'PRESS';
ALTER TYPE "ContactStage" ADD VALUE IF NOT EXISTS 'FRIEND';
