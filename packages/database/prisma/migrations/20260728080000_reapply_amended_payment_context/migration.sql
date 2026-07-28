-- 20260727210000_agent_registry_identity_and_payment_context was amended
-- after it had already been applied to preview databases: the amendment added
-- Job."agentApiBaseUrl" and made Agent."registryIdentity" nullable for
-- rollback compatibility. `prisma migrate deploy` skips applied migrations by
-- name without re-checking content, so those environments never received the
-- amendment and the 20260728090000 repair fails there with 42703.
--
-- Re-apply the amendment idempotently. Both statements are no-ops on
-- databases that already ran the amended version, and this file sorts before
-- 20260728090000 so the repair always sees the full schema.
ALTER TABLE "Job" ADD COLUMN IF NOT EXISTS "agentApiBaseUrl" TEXT;

ALTER TABLE "Agent" ALTER COLUMN "registryIdentity" DROP NOT NULL;
