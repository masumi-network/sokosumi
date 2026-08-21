-- Pin the exact narrowed 402 demand behind an idempotency key. Nullable only
-- for rows created before this migration; every new writer supplies SHA-256.
ALTER TABLE "task_x402_payment"
  ADD COLUMN IF NOT EXISTS "demandFingerprint" VARCHAR(64);
