-- Ensure UUIDv7 generator is available.
--
-- CI uses a plain `postgres` container image which doesn't ship with `pg_uuidv7`.
-- To keep migrations portable, we create a small UUIDv7 generator backed by
-- `pgcrypto` (which is bundled with Postgres).
CREATE EXTENSION IF NOT EXISTS pgcrypto;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_proc p
      JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE p.proname = 'uuid_generate_v7'
      AND n.nspname = 'public'
  ) THEN
    EXECUTE $fn$
      CREATE FUNCTION public.uuid_generate_v7()
      RETURNS uuid
      LANGUAGE plpgsql
      AS $uuidv7$
      DECLARE
        v_time_ms bigint;
        v_rand bytea;
        v_bytes bytea;
      BEGIN
        v_time_ms := floor(extract(epoch from clock_timestamp()) * 1000);

        -- 48 bits timestamp (ms) + 80 bits random
        v_rand := gen_random_bytes(10);
        v_bytes := substring(int8send(v_time_ms) FROM 3 FOR 6) || v_rand;

        -- Set version (7) in high nibble of byte 6 (0-indexed).
        v_bytes := set_byte(v_bytes, 6, (get_byte(v_bytes, 6) & 15) | 112);

        -- Set variant (RFC 4122) in byte 8 (0-indexed).
        v_bytes := set_byte(v_bytes, 8, (get_byte(v_bytes, 8) & 63) | 128);

        RETURN encode(v_bytes, 'hex')::uuid;
      END;
      $uuidv7$;
    $fn$;
  END IF;
END $$;

-- Set UUIDv7 defaults for all primary key id columns (TEXT).
ALTER TABLE "user" ALTER COLUMN "id" SET DEFAULT (uuid_generate_v7()::text);
ALTER TABLE "session" ALTER COLUMN "id" SET DEFAULT (uuid_generate_v7()::text);
ALTER TABLE "account" ALTER COLUMN "id" SET DEFAULT (uuid_generate_v7()::text);
ALTER TABLE "verification" ALTER COLUMN "id" SET DEFAULT (uuid_generate_v7()::text);
ALTER TABLE "passkey" ALTER COLUMN "id" SET DEFAULT (uuid_generate_v7()::text);
ALTER TABLE "subscription" ALTER COLUMN "id" SET DEFAULT (uuid_generate_v7()::text);
ALTER TABLE "organization" ALTER COLUMN "id" SET DEFAULT (uuid_generate_v7()::text);
ALTER TABLE "member" ALTER COLUMN "id" SET DEFAULT (uuid_generate_v7()::text);
ALTER TABLE "invitation" ALTER COLUMN "id" SET DEFAULT (uuid_generate_v7()::text);
ALTER TABLE "utmAttribution" ALTER COLUMN "id" SET DEFAULT (uuid_generate_v7()::text);
ALTER TABLE "notice" ALTER COLUMN "id" SET DEFAULT (uuid_generate_v7()::text);
ALTER TABLE "noticeAcknowledgment" ALTER COLUMN "id" SET DEFAULT (uuid_generate_v7()::text);
ALTER TABLE "rateLimit" ALTER COLUMN "id" SET DEFAULT (uuid_generate_v7()::text);
ALTER TABLE "UnitValue" ALTER COLUMN "id" SET DEFAULT (uuid_generate_v7()::text);
ALTER TABLE "AgentPricing" ALTER COLUMN "id" SET DEFAULT (uuid_generate_v7()::text);
ALTER TABLE "AgentFixedPricing" ALTER COLUMN "id" SET DEFAULT (uuid_generate_v7()::text);
ALTER TABLE "ExampleOutput" ALTER COLUMN "id" SET DEFAULT (uuid_generate_v7()::text);
ALTER TABLE "UserAgentRating" ALTER COLUMN "id" SET DEFAULT (uuid_generate_v7()::text);
ALTER TABLE "Agent" ALTER COLUMN "id" SET DEFAULT (uuid_generate_v7()::text);
ALTER TABLE "Category" ALTER COLUMN "id" SET DEFAULT (uuid_generate_v7()::text);
ALTER TABLE "Lock" ALTER COLUMN "id" SET DEFAULT (uuid_generate_v7()::text);
ALTER TABLE "Tag" ALTER COLUMN "id" SET DEFAULT (uuid_generate_v7()::text);
ALTER TABLE "sync_metadata" ALTER COLUMN "id" SET DEFAULT (uuid_generate_v7()::text);
ALTER TABLE "AgentList" ALTER COLUMN "id" SET DEFAULT (uuid_generate_v7()::text);
ALTER TABLE "Transaction" ALTER COLUMN "id" SET DEFAULT (uuid_generate_v7()::text);
ALTER TABLE "credit_bucket" ALTER COLUMN "id" SET DEFAULT (uuid_generate_v7()::text);
ALTER TABLE "credit_consumption" ALTER COLUMN "id" SET DEFAULT (uuid_generate_v7()::text);
ALTER TABLE "Job" ALTER COLUMN "id" SET DEFAULT (uuid_generate_v7()::text);
ALTER TABLE "jobPurchase" ALTER COLUMN "id" SET DEFAULT (uuid_generate_v7()::text);
ALTER TABLE "jobEvent" ALTER COLUMN "id" SET DEFAULT (uuid_generate_v7()::text);
ALTER TABLE "jobInput" ALTER COLUMN "id" SET DEFAULT (uuid_generate_v7()::text);
ALTER TABLE "CreditCost" ALTER COLUMN "id" SET DEFAULT (uuid_generate_v7()::text);
ALTER TABLE "apikey" ALTER COLUMN "id" SET DEFAULT (uuid_generate_v7()::text);
ALTER TABLE "blob" ALTER COLUMN "id" SET DEFAULT (uuid_generate_v7()::text);
ALTER TABLE "link" ALTER COLUMN "id" SET DEFAULT (uuid_generate_v7()::text);
ALTER TABLE "jobShare" ALTER COLUMN "id" SET DEFAULT (uuid_generate_v7()::text);
ALTER TABLE "jobSchedule" ALTER COLUMN "id" SET DEFAULT (uuid_generate_v7()::text);
ALTER TABLE "oauthClient" ALTER COLUMN "id" SET DEFAULT (uuid_generate_v7()::text);
ALTER TABLE "oauthAccessToken" ALTER COLUMN "id" SET DEFAULT (uuid_generate_v7()::text);
ALTER TABLE "oauthRefreshToken" ALTER COLUMN "id" SET DEFAULT (uuid_generate_v7()::text);
ALTER TABLE "oauthConsent" ALTER COLUMN "id" SET DEFAULT (uuid_generate_v7()::text);
ALTER TABLE "jwks" ALTER COLUMN "id" SET DEFAULT (uuid_generate_v7()::text);
ALTER TABLE "coworker" ALTER COLUMN "id" SET DEFAULT (uuid_generate_v7()::text);
ALTER TABLE "coworker_api_key" ALTER COLUMN "id" SET DEFAULT (uuid_generate_v7()::text);
ALTER TABLE "task" ALTER COLUMN "id" SET DEFAULT (uuid_generate_v7()::text);
ALTER TABLE "task_link" ALTER COLUMN "id" SET DEFAULT (uuid_generate_v7()::text);
ALTER TABLE "taskEvent" ALTER COLUMN "id" SET DEFAULT (uuid_generate_v7()::text);
ALTER TABLE "coworker_usage" ALTER COLUMN "id" SET DEFAULT (uuid_generate_v7()::text);
ALTER TABLE "conversation" ALTER COLUMN "id" SET DEFAULT (uuid_generate_v7()::text);
ALTER TABLE "conversationItem" ALTER COLUMN "id" SET DEFAULT (uuid_generate_v7()::text);

