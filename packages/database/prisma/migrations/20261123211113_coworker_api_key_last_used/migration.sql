-- Nullable and additive: the release still serving ignores it.
ALTER TABLE "coworker_api_key" ADD COLUMN "lastUsedAt" TIMESTAMP(3);
