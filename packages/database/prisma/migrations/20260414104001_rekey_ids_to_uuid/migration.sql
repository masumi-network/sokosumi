-- Rekey all TEXT primary keys / foreign keys to UUID.
--
-- Existing ids are mostly CUIDs, so we cannot cast them to UUID. Instead we:
-- 1) assign `_new_id`: keep values that already parse as UUID (e.g. UUIDv7 from
--    Prisma); only generate `gen_random_uuid()` for non-UUID text (e.g. CUIDs)
-- 2) rewrite FK columns to point at the new UUIDs (as text)
-- 3) rewrite PK `id` columns to the new UUIDs (as text)
-- 4) convert columns to native UUID type
--
-- UUIDv7 defaults are handled by Prisma (`@default(uuid(7))`), not DB defaults.
--
-- This preserves existing relationships while changing the identifier values.

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- Map legacy text PKs: valid UUID strings keep their value; CUIDs etc. get a new UUID.
CREATE OR REPLACE FUNCTION migration_rekey_text_pk_to_uuid(p TEXT)
RETURNS UUID
LANGUAGE plpgsql
VOLATILE
AS $$
BEGIN
  RETURN p::uuid;
EXCEPTION
  WHEN invalid_text_representation THEN
    RETURN gen_random_uuid();
END;
$$;

-- `task_link_task_pair_key` uses LEAST/GREATEST on (fromTaskId, toTaskId).
-- During this migration we temporarily have mixed column types (TEXT -> UUID),
-- which breaks the index expression. Drop it up front and recreate it at the end.
DROP INDEX IF EXISTS "task_link_task_pair_key";

-- Drop FKs first so we can rewrite values and change types.
ALTER TABLE "workspace" DROP CONSTRAINT IF EXISTS "workspace_userId_fkey";
ALTER TABLE "workspace" DROP CONSTRAINT IF EXISTS "workspace_organizationId_fkey";
ALTER TABLE "session" DROP CONSTRAINT IF EXISTS "session_userId_fkey";
ALTER TABLE "account" DROP CONSTRAINT IF EXISTS "account_userId_fkey";
ALTER TABLE "passkey" DROP CONSTRAINT IF EXISTS "passkey_userId_fkey";
ALTER TABLE "member" DROP CONSTRAINT IF EXISTS "member_userId_fkey";
ALTER TABLE "member" DROP CONSTRAINT IF EXISTS "member_organizationId_fkey";
ALTER TABLE "invitation" DROP CONSTRAINT IF EXISTS "invitation_organizationId_fkey";
ALTER TABLE "invitation" DROP CONSTRAINT IF EXISTS "invitation_inviterId_fkey";
ALTER TABLE "utmAttribution" DROP CONSTRAINT IF EXISTS "utmAttribution_userId_fkey";
ALTER TABLE "noticeAcknowledgment" DROP CONSTRAINT IF EXISTS "noticeAcknowledgment_userId_fkey";
ALTER TABLE "noticeAcknowledgment" DROP CONSTRAINT IF EXISTS "noticeAcknowledgment_noticeId_fkey";
ALTER TABLE "UnitValue" DROP CONSTRAINT IF EXISTS "UnitValue_agentFixedPricingId_fkey";
ALTER TABLE "AgentPricing" DROP CONSTRAINT IF EXISTS "AgentPricing_agentFixedPricingId_fkey";
ALTER TABLE "ExampleOutput" DROP CONSTRAINT IF EXISTS "ExampleOutput_agentId_fkey";
ALTER TABLE "ExampleOutput" DROP CONSTRAINT IF EXISTS "ExampleOutput_agentIdOverride_fkey";
ALTER TABLE "UserAgentRating" DROP CONSTRAINT IF EXISTS "UserAgentRating_userId_fkey";
ALTER TABLE "UserAgentRating" DROP CONSTRAINT IF EXISTS "UserAgentRating_agentId_fkey";
ALTER TABLE "Agent" DROP CONSTRAINT IF EXISTS "Agent_pricingId_fkey";
ALTER TABLE "AgentList" DROP CONSTRAINT IF EXISTS "AgentList_userId_fkey";
ALTER TABLE "Transaction" DROP CONSTRAINT IF EXISTS "Transaction_userId_fkey";
ALTER TABLE "Transaction" DROP CONSTRAINT IF EXISTS "Transaction_organizationId_fkey";
ALTER TABLE "credit_bucket" DROP CONSTRAINT IF EXISTS "credit_bucket_sourceTransactionId_fkey";
ALTER TABLE "credit_bucket" DROP CONSTRAINT IF EXISTS "credit_bucket_userId_fkey";
ALTER TABLE "credit_bucket" DROP CONSTRAINT IF EXISTS "credit_bucket_organizationId_fkey";
ALTER TABLE "credit_consumption" DROP CONSTRAINT IF EXISTS "credit_consumption_bucketId_fkey";
ALTER TABLE "credit_consumption" DROP CONSTRAINT IF EXISTS "credit_consumption_transactionId_fkey";
ALTER TABLE "Job" DROP CONSTRAINT IF EXISTS "Job_userId_fkey";
ALTER TABLE "Job" DROP CONSTRAINT IF EXISTS "Job_organizationId_fkey";
ALTER TABLE "Job" DROP CONSTRAINT IF EXISTS "Job_agentId_fkey";
ALTER TABLE "Job" DROP CONSTRAINT IF EXISTS "Job_workspaceId_fkey";
ALTER TABLE "Job" DROP CONSTRAINT IF EXISTS "Job_transactionId_fkey";
ALTER TABLE "Job" DROP CONSTRAINT IF EXISTS "Job_refundedTransactionId_fkey";
ALTER TABLE "Job" DROP CONSTRAINT IF EXISTS "Job_jobScheduleId_fkey";
ALTER TABLE "Job" DROP CONSTRAINT IF EXISTS "Job_taskId_fkey";
ALTER TABLE "jobPurchase" DROP CONSTRAINT IF EXISTS "jobPurchase_jobId_fkey";
ALTER TABLE "jobEvent" DROP CONSTRAINT IF EXISTS "jobEvent_jobId_fkey";
ALTER TABLE "jobInput" DROP CONSTRAINT IF EXISTS "jobInput_eventId_fkey";
ALTER TABLE "blob" DROP CONSTRAINT IF EXISTS "blob_eventId_fkey";
ALTER TABLE "link" DROP CONSTRAINT IF EXISTS "link_eventId_fkey";
ALTER TABLE "jobShare" DROP CONSTRAINT IF EXISTS "jobShare_jobId_fkey";
ALTER TABLE "jobShare" DROP CONSTRAINT IF EXISTS "jobShare_taskId_fkey";
ALTER TABLE "jobSchedule" DROP CONSTRAINT IF EXISTS "jobSchedule_userId_fkey";
ALTER TABLE "jobSchedule" DROP CONSTRAINT IF EXISTS "jobSchedule_organizationId_fkey";
ALTER TABLE "jobSchedule" DROP CONSTRAINT IF EXISTS "jobSchedule_agentId_fkey";
ALTER TABLE "jobSchedule" DROP CONSTRAINT IF EXISTS "jobSchedule_workspaceId_fkey";
ALTER TABLE "oauthClient" DROP CONSTRAINT IF EXISTS "oauthClient_userId_fkey";
ALTER TABLE "oauthAccessToken" DROP CONSTRAINT IF EXISTS "oauthAccessToken_sessionId_fkey";
ALTER TABLE "oauthAccessToken" DROP CONSTRAINT IF EXISTS "oauthAccessToken_refreshId_fkey";
ALTER TABLE "oauthAccessToken" DROP CONSTRAINT IF EXISTS "oauthAccessToken_userId_fkey";
ALTER TABLE "oauthRefreshToken" DROP CONSTRAINT IF EXISTS "oauthRefreshToken_sessionId_fkey";
ALTER TABLE "oauthRefreshToken" DROP CONSTRAINT IF EXISTS "oauthRefreshToken_userId_fkey";
ALTER TABLE "oauthConsent" DROP CONSTRAINT IF EXISTS "oauthConsent_userId_fkey";
ALTER TABLE "coworker" DROP CONSTRAINT IF EXISTS "coworker_userId_fkey";
ALTER TABLE "coworker_api_key" DROP CONSTRAINT IF EXISTS "coworker_api_key_coworkerId_fkey";
ALTER TABLE "task" DROP CONSTRAINT IF EXISTS "task_userId_fkey";
ALTER TABLE "task" DROP CONSTRAINT IF EXISTS "task_organizationId_fkey";
ALTER TABLE "task" DROP CONSTRAINT IF EXISTS "task_coworkerId_fkey";
ALTER TABLE "task" DROP CONSTRAINT IF EXISTS "task_workspaceId_fkey";
ALTER TABLE "task_link" DROP CONSTRAINT IF EXISTS "task_link_fromTaskId_fkey";
ALTER TABLE "task_link" DROP CONSTRAINT IF EXISTS "task_link_toTaskId_fkey";
ALTER TABLE "taskEvent" DROP CONSTRAINT IF EXISTS "taskEvent_taskId_fkey";
ALTER TABLE "taskEvent" DROP CONSTRAINT IF EXISTS "taskEvent_userId_fkey";
ALTER TABLE "taskEvent" DROP CONSTRAINT IF EXISTS "taskEvent_coworkerId_fkey";
ALTER TABLE "taskEvent" DROP CONSTRAINT IF EXISTS "taskEvent_transactionId_fkey";
ALTER TABLE "coworker_usage" DROP CONSTRAINT IF EXISTS "coworker_usage_coworkerId_fkey";
ALTER TABLE "coworker_usage" DROP CONSTRAINT IF EXISTS "coworker_usage_userId_fkey";
ALTER TABLE "coworker_usage" DROP CONSTRAINT IF EXISTS "coworker_usage_organizationId_fkey";
ALTER TABLE "coworker_usage" DROP CONSTRAINT IF EXISTS "coworker_usage_transactionId_fkey";
ALTER TABLE "conversation" DROP CONSTRAINT IF EXISTS "conversation_userId_fkey";
ALTER TABLE "conversationItem" DROP CONSTRAINT IF EXISTS "conversationItem_conversationId_fkey";
ALTER TABLE "_AgentToAgentList" DROP CONSTRAINT IF EXISTS "_AgentToAgentList_A_fkey";
ALTER TABLE "_AgentToAgentList" DROP CONSTRAINT IF EXISTS "_AgentToAgentList_B_fkey";
ALTER TABLE "_AgentTag" DROP CONSTRAINT IF EXISTS "_AgentTag_A_fkey";
ALTER TABLE "_AgentTag" DROP CONSTRAINT IF EXISTS "_AgentTag_B_fkey";
ALTER TABLE "_AgentTagOverride" DROP CONSTRAINT IF EXISTS "_AgentTagOverride_A_fkey";
ALTER TABLE "_AgentTagOverride" DROP CONSTRAINT IF EXISTS "_AgentTagOverride_B_fkey";
ALTER TABLE "_AgentCategory" DROP CONSTRAINT IF EXISTS "_AgentCategory_A_fkey";
ALTER TABLE "_AgentCategory" DROP CONSTRAINT IF EXISTS "_AgentCategory_B_fkey";

-- Add new UUID ids for every table.
ALTER TABLE "user" ADD COLUMN "_new_id" UUID;
ALTER TABLE "session" ADD COLUMN "_new_id" UUID;
ALTER TABLE "account" ADD COLUMN "_new_id" UUID;
ALTER TABLE "verification" ADD COLUMN "_new_id" UUID;
ALTER TABLE "passkey" ADD COLUMN "_new_id" UUID;
ALTER TABLE "subscription" ADD COLUMN "_new_id" UUID;
ALTER TABLE "organization" ADD COLUMN "_new_id" UUID;
ALTER TABLE "member" ADD COLUMN "_new_id" UUID;
ALTER TABLE "invitation" ADD COLUMN "_new_id" UUID;
ALTER TABLE "utmAttribution" ADD COLUMN "_new_id" UUID;
ALTER TABLE "notice" ADD COLUMN "_new_id" UUID;
ALTER TABLE "noticeAcknowledgment" ADD COLUMN "_new_id" UUID;
ALTER TABLE "rateLimit" ADD COLUMN "_new_id" UUID;
ALTER TABLE "UnitValue" ADD COLUMN "_new_id" UUID;
ALTER TABLE "AgentPricing" ADD COLUMN "_new_id" UUID;
ALTER TABLE "AgentFixedPricing" ADD COLUMN "_new_id" UUID;
ALTER TABLE "ExampleOutput" ADD COLUMN "_new_id" UUID;
ALTER TABLE "UserAgentRating" ADD COLUMN "_new_id" UUID;
ALTER TABLE "Agent" ADD COLUMN "_new_id" UUID;
ALTER TABLE "Category" ADD COLUMN "_new_id" UUID;
ALTER TABLE "Lock" ADD COLUMN "_new_id" UUID;
ALTER TABLE "Tag" ADD COLUMN "_new_id" UUID;
ALTER TABLE "sync_metadata" ADD COLUMN "_new_id" UUID;
ALTER TABLE "AgentList" ADD COLUMN "_new_id" UUID;
ALTER TABLE "Transaction" ADD COLUMN "_new_id" UUID;
ALTER TABLE "credit_bucket" ADD COLUMN "_new_id" UUID;
ALTER TABLE "credit_consumption" ADD COLUMN "_new_id" UUID;
ALTER TABLE "Job" ADD COLUMN "_new_id" UUID;
ALTER TABLE "jobPurchase" ADD COLUMN "_new_id" UUID;
ALTER TABLE "jobEvent" ADD COLUMN "_new_id" UUID;
ALTER TABLE "jobInput" ADD COLUMN "_new_id" UUID;
ALTER TABLE "CreditCost" ADD COLUMN "_new_id" UUID;
ALTER TABLE "apikey" ADD COLUMN "_new_id" UUID;
ALTER TABLE "blob" ADD COLUMN "_new_id" UUID;
ALTER TABLE "link" ADD COLUMN "_new_id" UUID;
ALTER TABLE "jobShare" ADD COLUMN "_new_id" UUID;
ALTER TABLE "jobSchedule" ADD COLUMN "_new_id" UUID;
ALTER TABLE "oauthClient" ADD COLUMN "_new_id" UUID;
ALTER TABLE "oauthAccessToken" ADD COLUMN "_new_id" UUID;
ALTER TABLE "oauthRefreshToken" ADD COLUMN "_new_id" UUID;
ALTER TABLE "oauthConsent" ADD COLUMN "_new_id" UUID;
ALTER TABLE "jwks" ADD COLUMN "_new_id" UUID;
ALTER TABLE "coworker" ADD COLUMN "_new_id" UUID;
ALTER TABLE "coworker_api_key" ADD COLUMN "_new_id" UUID;
ALTER TABLE "task" ADD COLUMN "_new_id" UUID;
ALTER TABLE "task_link" ADD COLUMN "_new_id" UUID;
ALTER TABLE "taskEvent" ADD COLUMN "_new_id" UUID;
ALTER TABLE "coworker_usage" ADD COLUMN "_new_id" UUID;
ALTER TABLE "conversation" ADD COLUMN "_new_id" UUID;
ALTER TABLE "conversationItem" ADD COLUMN "_new_id" UUID;

UPDATE "user" SET "_new_id" = migration_rekey_text_pk_to_uuid("id");
UPDATE "session" SET "_new_id" = migration_rekey_text_pk_to_uuid("id");
UPDATE "account" SET "_new_id" = migration_rekey_text_pk_to_uuid("id");
UPDATE "verification" SET "_new_id" = migration_rekey_text_pk_to_uuid("id");
UPDATE "passkey" SET "_new_id" = migration_rekey_text_pk_to_uuid("id");
UPDATE "subscription" SET "_new_id" = migration_rekey_text_pk_to_uuid("id");
UPDATE "organization" SET "_new_id" = migration_rekey_text_pk_to_uuid("id");
UPDATE "member" SET "_new_id" = migration_rekey_text_pk_to_uuid("id");
UPDATE "invitation" SET "_new_id" = migration_rekey_text_pk_to_uuid("id");
UPDATE "utmAttribution" SET "_new_id" = migration_rekey_text_pk_to_uuid("id");
UPDATE "notice" SET "_new_id" = migration_rekey_text_pk_to_uuid("id");
UPDATE "noticeAcknowledgment" SET "_new_id" = migration_rekey_text_pk_to_uuid("id");
UPDATE "rateLimit" SET "_new_id" = migration_rekey_text_pk_to_uuid("id");
UPDATE "UnitValue" SET "_new_id" = migration_rekey_text_pk_to_uuid("id");
UPDATE "AgentPricing" SET "_new_id" = migration_rekey_text_pk_to_uuid("id");
UPDATE "AgentFixedPricing" SET "_new_id" = migration_rekey_text_pk_to_uuid("id");
UPDATE "ExampleOutput" SET "_new_id" = migration_rekey_text_pk_to_uuid("id");
UPDATE "UserAgentRating" SET "_new_id" = migration_rekey_text_pk_to_uuid("id");
UPDATE "Agent" SET "_new_id" = migration_rekey_text_pk_to_uuid("id");
UPDATE "Category" SET "_new_id" = migration_rekey_text_pk_to_uuid("id");
UPDATE "Lock" SET "_new_id" = migration_rekey_text_pk_to_uuid("id");
UPDATE "Tag" SET "_new_id" = migration_rekey_text_pk_to_uuid("id");
UPDATE "sync_metadata" SET "_new_id" = migration_rekey_text_pk_to_uuid("id");
UPDATE "AgentList" SET "_new_id" = migration_rekey_text_pk_to_uuid("id");
UPDATE "Transaction" SET "_new_id" = migration_rekey_text_pk_to_uuid("id");
UPDATE "credit_bucket" SET "_new_id" = migration_rekey_text_pk_to_uuid("id");
UPDATE "credit_consumption" SET "_new_id" = migration_rekey_text_pk_to_uuid("id");
UPDATE "Job" SET "_new_id" = migration_rekey_text_pk_to_uuid("id");
UPDATE "jobPurchase" SET "_new_id" = migration_rekey_text_pk_to_uuid("id");
UPDATE "jobEvent" SET "_new_id" = migration_rekey_text_pk_to_uuid("id");
UPDATE "jobInput" SET "_new_id" = migration_rekey_text_pk_to_uuid("id");
UPDATE "CreditCost" SET "_new_id" = migration_rekey_text_pk_to_uuid("id");
UPDATE "apikey" SET "_new_id" = migration_rekey_text_pk_to_uuid("id");
UPDATE "blob" SET "_new_id" = migration_rekey_text_pk_to_uuid("id");
UPDATE "link" SET "_new_id" = migration_rekey_text_pk_to_uuid("id");
UPDATE "jobShare" SET "_new_id" = migration_rekey_text_pk_to_uuid("id");
UPDATE "jobSchedule" SET "_new_id" = migration_rekey_text_pk_to_uuid("id");
UPDATE "oauthClient" SET "_new_id" = migration_rekey_text_pk_to_uuid("id");
UPDATE "oauthAccessToken" SET "_new_id" = migration_rekey_text_pk_to_uuid("id");
UPDATE "oauthRefreshToken" SET "_new_id" = migration_rekey_text_pk_to_uuid("id");
UPDATE "oauthConsent" SET "_new_id" = migration_rekey_text_pk_to_uuid("id");
UPDATE "jwks" SET "_new_id" = migration_rekey_text_pk_to_uuid("id");
UPDATE "coworker" SET "_new_id" = migration_rekey_text_pk_to_uuid("id");
UPDATE "coworker_api_key" SET "_new_id" = migration_rekey_text_pk_to_uuid("id");
UPDATE "task" SET "_new_id" = migration_rekey_text_pk_to_uuid("id");
UPDATE "task_link" SET "_new_id" = migration_rekey_text_pk_to_uuid("id");
UPDATE "taskEvent" SET "_new_id" = migration_rekey_text_pk_to_uuid("id");
UPDATE "coworker_usage" SET "_new_id" = migration_rekey_text_pk_to_uuid("id");
UPDATE "conversation" SET "_new_id" = migration_rekey_text_pk_to_uuid("id");
UPDATE "conversationItem" SET "_new_id" = migration_rekey_text_pk_to_uuid("id");

-- Rewrite FK values to the new ids (as TEXT for now).
UPDATE "session" s SET "userId" = u."_new_id"::text FROM "user" u WHERE s."userId" = u."id";
UPDATE "account" a SET "userId" = u."_new_id"::text FROM "user" u WHERE a."userId" = u."id";
UPDATE "passkey" p SET "userId" = u."_new_id"::text FROM "user" u WHERE p."userId" = u."id";
UPDATE "member" m SET "userId" = u."_new_id"::text FROM "user" u WHERE m."userId" = u."id";
UPDATE "member" m SET "organizationId" = o."_new_id"::text FROM "organization" o WHERE m."organizationId" = o."id";
UPDATE "invitation" i SET "organizationId" = o."_new_id"::text FROM "organization" o WHERE i."organizationId" = o."id";
UPDATE "invitation" i SET "inviterId" = u."_new_id"::text FROM "user" u WHERE i."inviterId" = u."id";
UPDATE "utmAttribution" utm SET "userId" = u."_new_id"::text FROM "user" u WHERE utm."userId" = u."id";
UPDATE "user" u SET "preferredOrganizationId" = o."_new_id"::text FROM "organization" o WHERE u."preferredOrganizationId" = o."id";
UPDATE "session" s SET "activeOrganizationId" = o."_new_id"::text FROM "organization" o WHERE s."activeOrganizationId" = o."id";
UPDATE "workspace" w SET "userId" = u."_new_id"::text FROM "user" u WHERE w."userId" = u."id";
UPDATE "workspace" w SET "organizationId" = o."_new_id"::text FROM "organization" o WHERE w."organizationId" = o."id";
UPDATE "noticeAcknowledgment" na SET "userId" = u."_new_id"::text FROM "user" u WHERE na."userId" = u."id";
UPDATE "noticeAcknowledgment" na SET "noticeId" = n."_new_id"::text FROM "notice" n WHERE na."noticeId" = n."id";
UPDATE "UnitValue" uv SET "agentFixedPricingId" = afp."_new_id"::text FROM "AgentFixedPricing" afp WHERE uv."agentFixedPricingId" = afp."id";
UPDATE "AgentPricing" ap SET "agentFixedPricingId" = afp."_new_id"::text FROM "AgentFixedPricing" afp WHERE ap."agentFixedPricingId" = afp."id";
UPDATE "ExampleOutput" eo SET "agentId" = a."_new_id"::text FROM "Agent" a WHERE eo."agentId" = a."id";
UPDATE "ExampleOutput" eo SET "agentIdOverride" = a."_new_id"::text FROM "Agent" a WHERE eo."agentIdOverride" = a."id";
UPDATE "UserAgentRating" uar SET "userId" = u."_new_id"::text FROM "user" u WHERE uar."userId" = u."id";
UPDATE "UserAgentRating" uar SET "agentId" = a."_new_id"::text FROM "Agent" a WHERE uar."agentId" = a."id";
UPDATE "Agent" a SET "pricingId" = ap."_new_id"::text FROM "AgentPricing" ap WHERE a."pricingId" = ap."id";
UPDATE "AgentList" al SET "userId" = u."_new_id"::text FROM "user" u WHERE al."userId" = u."id";
UPDATE "Transaction" t SET "userId" = u."_new_id"::text FROM "user" u WHERE t."userId" = u."id";
UPDATE "Transaction" t SET "organizationId" = o."_new_id"::text FROM "organization" o WHERE t."organizationId" = o."id";
UPDATE "credit_bucket" cb SET "sourceTransactionId" = t."_new_id"::text FROM "Transaction" t WHERE cb."sourceTransactionId" = t."id";
UPDATE "credit_bucket" cb SET "userId" = u."_new_id"::text FROM "user" u WHERE cb."userId" = u."id";
UPDATE "credit_bucket" cb SET "organizationId" = o."_new_id"::text FROM "organization" o WHERE cb."organizationId" = o."id";
UPDATE "credit_bucket" cb
SET "referenceId" = regexp_replace(
  cb."referenceId",
  '^member:' || old_user."id" || ':',
  'member:' || old_user."_new_id"::text || ':'
)
FROM "user" old_user
WHERE cb."referenceId" IS NOT NULL
  AND cb."referenceType" = 'STRIPE_SUBSCRIPTION_PERIOD'
  AND cb."referenceId" LIKE ('member:' || old_user."id" || ':%');
UPDATE "credit_bucket" cb
SET "referenceId" = regexp_replace(
  cb."referenceId",
  '^user:' || old_user."id" || ':',
  'user:' || old_user."_new_id"::text || ':'
)
FROM "user" old_user
WHERE cb."referenceId" IS NOT NULL
  AND cb."referenceId" LIKE ('user:' || old_user."id" || ':%');
UPDATE "credit_bucket" cb
SET "referenceId" = regexp_replace(
  cb."referenceId",
  '^org:' || old_org."id" || ':',
  'org:' || old_org."_new_id"::text || ':'
)
FROM "organization" old_org
WHERE cb."referenceId" IS NOT NULL
  AND cb."referenceId" LIKE ('org:' || old_org."id" || ':%');
UPDATE "credit_consumption" cc SET "bucketId" = cb."_new_id"::text FROM "credit_bucket" cb WHERE cc."bucketId" = cb."id";
UPDATE "credit_consumption" cc SET "transactionId" = t."_new_id"::text FROM "Transaction" t WHERE cc."transactionId" = t."id";
UPDATE "Job" j SET "userId" = u."_new_id"::text FROM "user" u WHERE j."userId" = u."id";
UPDATE "Job" j SET "organizationId" = o."_new_id"::text FROM "organization" o WHERE j."organizationId" = o."id";
UPDATE "Job" j SET "agentId" = a."_new_id"::text FROM "Agent" a WHERE j."agentId" = a."id";
UPDATE "Job" j SET "transactionId" = t."_new_id"::text FROM "Transaction" t WHERE j."transactionId" = t."id";
UPDATE "Job" j SET "refundedTransactionId" = t."_new_id"::text FROM "Transaction" t WHERE j."refundedTransactionId" = t."id";
UPDATE "Job" j SET "jobScheduleId" = js."_new_id"::text FROM "jobSchedule" js WHERE j."jobScheduleId" = js."id";
UPDATE "Job" j SET "taskId" = tk."_new_id"::text FROM "task" tk WHERE j."taskId" = tk."id";
UPDATE "jobPurchase" jp SET "jobId" = j."_new_id"::text FROM "Job" j WHERE jp."jobId" = j."id";
UPDATE "jobEvent" je SET "jobId" = j."_new_id"::text FROM "Job" j WHERE je."jobId" = j."id";
UPDATE "jobInput" ji SET "eventId" = je."_new_id"::text FROM "jobEvent" je WHERE ji."eventId" = je."id";
UPDATE "blob" b SET "eventId" = je."_new_id"::text FROM "jobEvent" je WHERE b."eventId" = je."id";
UPDATE "link" l SET "eventId" = je."_new_id"::text FROM "jobEvent" je WHERE l."eventId" = je."id";
UPDATE "jobShare" js SET "jobId" = j."_new_id"::text FROM "Job" j WHERE js."jobId" = j."id";
UPDATE "jobShare" js SET "taskId" = tk."_new_id"::text FROM "task" tk WHERE js."taskId" = tk."id";
UPDATE "jobSchedule" js SET "userId" = u."_new_id"::text FROM "user" u WHERE js."userId" = u."id";
UPDATE "jobSchedule" js SET "organizationId" = o."_new_id"::text FROM "organization" o WHERE js."organizationId" = o."id";
UPDATE "jobSchedule" js SET "agentId" = a."_new_id"::text FROM "Agent" a WHERE js."agentId" = a."id";
UPDATE "oauthClient" oc SET "userId" = u."_new_id"::text FROM "user" u WHERE oc."userId" = u."id";
UPDATE "apikey" ak SET "referenceId" = u."_new_id"::text FROM "user" u WHERE ak."referenceId" = u."id";
UPDATE "oauthAccessToken" oat SET "sessionId" = s."_new_id"::text FROM "session" s WHERE oat."sessionId" = s."id";
UPDATE "oauthAccessToken" oat SET "refreshId" = ort."_new_id"::text FROM "oauthRefreshToken" ort WHERE oat."refreshId" = ort."id";
UPDATE "oauthAccessToken" oat SET "userId" = u."_new_id"::text FROM "user" u WHERE oat."userId" = u."id";
UPDATE "oauthRefreshToken" ort SET "sessionId" = s."_new_id"::text FROM "session" s WHERE ort."sessionId" = s."id";
UPDATE "oauthRefreshToken" ort SET "userId" = u."_new_id"::text FROM "user" u WHERE ort."userId" = u."id";
UPDATE "oauthConsent" oc SET "userId" = u."_new_id"::text FROM "user" u WHERE oc."userId" = u."id";
UPDATE "coworker" c SET "userId" = u."_new_id"::text FROM "user" u WHERE c."userId" = u."id";
UPDATE "coworker_api_key" cak SET "coworkerId" = c."_new_id"::text FROM "coworker" c WHERE cak."coworkerId" = c."id";
UPDATE "task" t SET "userId" = u."_new_id"::text FROM "user" u WHERE t."userId" = u."id";
UPDATE "task" t SET "organizationId" = o."_new_id"::text FROM "organization" o WHERE t."organizationId" = o."id";
UPDATE "task" t SET "coworkerId" = c."_new_id"::text FROM "coworker" c WHERE t."coworkerId" = c."id";
UPDATE "task_link" tl SET "fromTaskId" = t."_new_id"::text FROM "task" t WHERE tl."fromTaskId" = t."id";
UPDATE "task_link" tl SET "toTaskId" = t."_new_id"::text FROM "task" t WHERE tl."toTaskId" = t."id";
UPDATE "taskEvent" te SET "taskId" = t."_new_id"::text FROM "task" t WHERE te."taskId" = t."id";
UPDATE "taskEvent" te SET "userId" = u."_new_id"::text FROM "user" u WHERE te."userId" = u."id";
UPDATE "taskEvent" te SET "coworkerId" = c."_new_id"::text FROM "coworker" c WHERE te."coworkerId" = c."id";
UPDATE "taskEvent" te SET "transactionId" = tr."_new_id"::text FROM "Transaction" tr WHERE te."transactionId" = tr."id";
UPDATE "coworker_usage" cu SET "coworkerId" = c."_new_id"::text FROM "coworker" c WHERE cu."coworkerId" = c."id";
UPDATE "coworker_usage" cu SET "userId" = u."_new_id"::text FROM "user" u WHERE cu."userId" = u."id";
UPDATE "coworker_usage" cu SET "organizationId" = o."_new_id"::text FROM "organization" o WHERE cu."organizationId" = o."id";
UPDATE "coworker_usage" cu SET "transactionId" = tr."_new_id"::text FROM "Transaction" tr WHERE cu."transactionId" = tr."id";
UPDATE "conversation" c SET "userId" = u."_new_id"::text FROM "user" u WHERE c."userId" = u."id";
UPDATE "conversationItem" ci SET "conversationId" = c."_new_id"::text FROM "conversation" c WHERE ci."conversationId" = c."id";
UPDATE "_AgentToAgentList" j SET "A" = a."_new_id"::text FROM "Agent" a WHERE j."A" = a."id";
UPDATE "_AgentToAgentList" j SET "B" = al."_new_id"::text FROM "AgentList" al WHERE j."B" = al."id";
UPDATE "_AgentTag" j SET "A" = a."_new_id"::text FROM "Agent" a WHERE j."A" = a."id";
UPDATE "_AgentTag" j SET "B" = t."_new_id"::text FROM "Tag" t WHERE j."B" = t."id";
UPDATE "_AgentTagOverride" j SET "A" = a."_new_id"::text FROM "Agent" a WHERE j."A" = a."id";
UPDATE "_AgentTagOverride" j SET "B" = t."_new_id"::text FROM "Tag" t WHERE j."B" = t."id";
UPDATE "_AgentCategory" j SET "A" = a."_new_id"::text FROM "Agent" a WHERE j."A" = a."id";
UPDATE "_AgentCategory" j SET "B" = c."_new_id"::text FROM "Category" c WHERE j."B" = c."id";
UPDATE "subscription" s SET "referenceId" = u."_new_id"::text FROM "user" u WHERE s."referenceId" = u."id";
UPDATE "subscription" s SET "referenceId" = o."_new_id"::text FROM "organization" o WHERE s."referenceId" = o."id";

-- Rewrite PK ids (as TEXT for now).
UPDATE "user" SET "id" = "_new_id"::text;
UPDATE "session" SET "id" = "_new_id"::text;
UPDATE "account" SET "id" = "_new_id"::text;
UPDATE "verification" SET "id" = "_new_id"::text;
UPDATE "passkey" SET "id" = "_new_id"::text;
UPDATE "subscription" SET "id" = "_new_id"::text;
UPDATE "organization" SET "id" = "_new_id"::text;
UPDATE "member" SET "id" = "_new_id"::text;
UPDATE "invitation" SET "id" = "_new_id"::text;
UPDATE "utmAttribution" SET "id" = "_new_id"::text;
UPDATE "notice" SET "id" = "_new_id"::text;
UPDATE "noticeAcknowledgment" SET "id" = "_new_id"::text;
UPDATE "rateLimit" SET "id" = "_new_id"::text;
UPDATE "UnitValue" SET "id" = "_new_id"::text;
UPDATE "AgentPricing" SET "id" = "_new_id"::text;
UPDATE "AgentFixedPricing" SET "id" = "_new_id"::text;
UPDATE "ExampleOutput" SET "id" = "_new_id"::text;
UPDATE "UserAgentRating" SET "id" = "_new_id"::text;
UPDATE "Agent" SET "id" = "_new_id"::text;
UPDATE "Category" SET "id" = "_new_id"::text;
UPDATE "Lock" SET "id" = "_new_id"::text;
UPDATE "Tag" SET "id" = "_new_id"::text;
UPDATE "sync_metadata" SET "id" = "_new_id"::text;
UPDATE "AgentList" SET "id" = "_new_id"::text;
UPDATE "Transaction" SET "id" = "_new_id"::text;
UPDATE "credit_bucket" SET "id" = "_new_id"::text;
UPDATE "credit_consumption" SET "id" = "_new_id"::text;
UPDATE "Job" SET "id" = "_new_id"::text;
UPDATE "jobPurchase" SET "id" = "_new_id"::text;
UPDATE "jobEvent" SET "id" = "_new_id"::text;
UPDATE "jobInput" SET "id" = "_new_id"::text;
UPDATE "CreditCost" SET "id" = "_new_id"::text;
UPDATE "apikey" SET "id" = "_new_id"::text;
UPDATE "blob" SET "id" = "_new_id"::text;
UPDATE "link" SET "id" = "_new_id"::text;
UPDATE "jobShare" SET "id" = "_new_id"::text;
UPDATE "jobSchedule" SET "id" = "_new_id"::text;
UPDATE "oauthClient" SET "id" = "_new_id"::text;
UPDATE "oauthAccessToken" SET "id" = "_new_id"::text;
UPDATE "oauthRefreshToken" SET "id" = "_new_id"::text;
UPDATE "oauthConsent" SET "id" = "_new_id"::text;
UPDATE "jwks" SET "id" = "_new_id"::text;
UPDATE "coworker" SET "id" = "_new_id"::text;
UPDATE "coworker_api_key" SET "id" = "_new_id"::text;
UPDATE "task" SET "id" = "_new_id"::text;
UPDATE "task_link" SET "id" = "_new_id"::text;
UPDATE "taskEvent" SET "id" = "_new_id"::text;
UPDATE "coworker_usage" SET "id" = "_new_id"::text;
UPDATE "conversation" SET "id" = "_new_id"::text;
UPDATE "conversationItem" SET "id" = "_new_id"::text;

-- Soft org references (no FK): JOIN rewrites above only run when the org row
-- still exists. Deleted-org CUIDs would remain here and break ::uuid casts.
UPDATE "user" u
SET "preferredOrganizationId" = NULL
WHERE u."preferredOrganizationId" IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM "organization" o WHERE o."id" = u."preferredOrganizationId"
  );
UPDATE "session" s
SET "activeOrganizationId" = NULL
WHERE s."activeOrganizationId" IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM "organization" o WHERE o."id" = s."activeOrganizationId"
  );

-- Convert columns from TEXT to UUID (now safe since values are UUID strings).
ALTER TABLE "user" ALTER COLUMN "id" TYPE UUID USING "id"::uuid;
ALTER TABLE "user" ALTER COLUMN "preferredOrganizationId" TYPE UUID USING "preferredOrganizationId"::uuid;
ALTER TABLE "session" ALTER COLUMN "id" TYPE UUID USING "id"::uuid;
ALTER TABLE "session" ALTER COLUMN "activeOrganizationId" TYPE UUID USING "activeOrganizationId"::uuid;
ALTER TABLE "session" ALTER COLUMN "userId" TYPE UUID USING "userId"::uuid;
ALTER TABLE "account" ALTER COLUMN "id" TYPE UUID USING "id"::uuid;
ALTER TABLE "account" ALTER COLUMN "userId" TYPE UUID USING "userId"::uuid;
ALTER TABLE "verification" ALTER COLUMN "id" TYPE UUID USING "id"::uuid;
ALTER TABLE "passkey" ALTER COLUMN "id" TYPE UUID USING "id"::uuid;
ALTER TABLE "passkey" ALTER COLUMN "userId" TYPE UUID USING "userId"::uuid;
ALTER TABLE "subscription" ALTER COLUMN "id" TYPE UUID USING "id"::uuid;
ALTER TABLE "organization" ALTER COLUMN "id" TYPE UUID USING "id"::uuid;
ALTER TABLE "member" ALTER COLUMN "id" TYPE UUID USING "id"::uuid;
ALTER TABLE "member" ALTER COLUMN "userId" TYPE UUID USING "userId"::uuid;
ALTER TABLE "member" ALTER COLUMN "organizationId" TYPE UUID USING "organizationId"::uuid;
ALTER TABLE "invitation" ALTER COLUMN "id" TYPE UUID USING "id"::uuid;
ALTER TABLE "invitation" ALTER COLUMN "organizationId" TYPE UUID USING "organizationId"::uuid;
ALTER TABLE "invitation" ALTER COLUMN "inviterId" TYPE UUID USING "inviterId"::uuid;
ALTER TABLE "utmAttribution" ALTER COLUMN "id" TYPE UUID USING "id"::uuid;
ALTER TABLE "utmAttribution" ALTER COLUMN "userId" TYPE UUID USING "userId"::uuid;
ALTER TABLE "workspace" ALTER COLUMN "userId" TYPE UUID USING "userId"::uuid;
ALTER TABLE "workspace" ALTER COLUMN "organizationId" TYPE UUID USING "organizationId"::uuid;
ALTER TABLE "notice" ALTER COLUMN "id" TYPE UUID USING "id"::uuid;
ALTER TABLE "noticeAcknowledgment" ALTER COLUMN "id" TYPE UUID USING "id"::uuid;
ALTER TABLE "noticeAcknowledgment" ALTER COLUMN "userId" TYPE UUID USING "userId"::uuid;
ALTER TABLE "noticeAcknowledgment" ALTER COLUMN "noticeId" TYPE UUID USING "noticeId"::uuid;
ALTER TABLE "rateLimit" ALTER COLUMN "id" TYPE UUID USING "id"::uuid;
ALTER TABLE "UnitValue" ALTER COLUMN "id" TYPE UUID USING "id"::uuid;
ALTER TABLE "UnitValue" ALTER COLUMN "agentFixedPricingId" TYPE UUID USING "agentFixedPricingId"::uuid;
ALTER TABLE "AgentPricing" ALTER COLUMN "id" TYPE UUID USING "id"::uuid;
ALTER TABLE "AgentPricing" ALTER COLUMN "agentFixedPricingId" TYPE UUID USING "agentFixedPricingId"::uuid;
ALTER TABLE "AgentFixedPricing" ALTER COLUMN "id" TYPE UUID USING "id"::uuid;
ALTER TABLE "ExampleOutput" ALTER COLUMN "id" TYPE UUID USING "id"::uuid;
ALTER TABLE "ExampleOutput" ALTER COLUMN "agentId" TYPE UUID USING "agentId"::uuid;
ALTER TABLE "ExampleOutput" ALTER COLUMN "agentIdOverride" TYPE UUID USING "agentIdOverride"::uuid;
ALTER TABLE "UserAgentRating" ALTER COLUMN "id" TYPE UUID USING "id"::uuid;
ALTER TABLE "UserAgentRating" ALTER COLUMN "userId" TYPE UUID USING "userId"::uuid;
ALTER TABLE "UserAgentRating" ALTER COLUMN "agentId" TYPE UUID USING "agentId"::uuid;
ALTER TABLE "Agent" ALTER COLUMN "id" TYPE UUID USING "id"::uuid;
ALTER TABLE "Agent" ALTER COLUMN "pricingId" TYPE UUID USING "pricingId"::uuid;
ALTER TABLE "Category" ALTER COLUMN "id" TYPE UUID USING "id"::uuid;
ALTER TABLE "Lock" ALTER COLUMN "id" TYPE UUID USING "id"::uuid;
ALTER TABLE "Tag" ALTER COLUMN "id" TYPE UUID USING "id"::uuid;
ALTER TABLE "sync_metadata" ALTER COLUMN "id" TYPE UUID USING "id"::uuid;
ALTER TABLE "AgentList" ALTER COLUMN "id" TYPE UUID USING "id"::uuid;
ALTER TABLE "AgentList" ALTER COLUMN "userId" TYPE UUID USING "userId"::uuid;
ALTER TABLE "Transaction" ALTER COLUMN "id" TYPE UUID USING "id"::uuid;
ALTER TABLE "Transaction" ALTER COLUMN "userId" TYPE UUID USING "userId"::uuid;
ALTER TABLE "Transaction" ALTER COLUMN "organizationId" TYPE UUID USING "organizationId"::uuid;
ALTER TABLE "credit_bucket" ALTER COLUMN "id" TYPE UUID USING "id"::uuid;
ALTER TABLE "credit_bucket" ALTER COLUMN "sourceTransactionId" TYPE UUID USING "sourceTransactionId"::uuid;
ALTER TABLE "credit_bucket" ALTER COLUMN "userId" TYPE UUID USING "userId"::uuid;
ALTER TABLE "credit_bucket" ALTER COLUMN "organizationId" TYPE UUID USING "organizationId"::uuid;
ALTER TABLE "credit_consumption" ALTER COLUMN "id" TYPE UUID USING "id"::uuid;
ALTER TABLE "credit_consumption" ALTER COLUMN "bucketId" TYPE UUID USING "bucketId"::uuid;
ALTER TABLE "credit_consumption" ALTER COLUMN "transactionId" TYPE UUID USING "transactionId"::uuid;
ALTER TABLE "Job" ALTER COLUMN "id" TYPE UUID USING "id"::uuid;
ALTER TABLE "Job" ALTER COLUMN "userId" TYPE UUID USING "userId"::uuid;
ALTER TABLE "Job" ALTER COLUMN "organizationId" TYPE UUID USING "organizationId"::uuid;
ALTER TABLE "Job" ALTER COLUMN "agentId" TYPE UUID USING "agentId"::uuid;
ALTER TABLE "Job" ALTER COLUMN "transactionId" TYPE UUID USING "transactionId"::uuid;
ALTER TABLE "Job" ALTER COLUMN "refundedTransactionId" TYPE UUID USING "refundedTransactionId"::uuid;
ALTER TABLE "Job" ALTER COLUMN "jobScheduleId" TYPE UUID USING "jobScheduleId"::uuid;
ALTER TABLE "Job" ALTER COLUMN "taskId" TYPE UUID USING "taskId"::uuid;
ALTER TABLE "jobPurchase" ALTER COLUMN "id" TYPE UUID USING "id"::uuid;
ALTER TABLE "jobPurchase" ALTER COLUMN "jobId" TYPE UUID USING "jobId"::uuid;
ALTER TABLE "jobEvent" ALTER COLUMN "id" TYPE UUID USING "id"::uuid;
ALTER TABLE "jobEvent" ALTER COLUMN "jobId" TYPE UUID USING "jobId"::uuid;
ALTER TABLE "jobInput" ALTER COLUMN "id" TYPE UUID USING "id"::uuid;
ALTER TABLE "jobInput" ALTER COLUMN "eventId" TYPE UUID USING "eventId"::uuid;
ALTER TABLE "CreditCost" ALTER COLUMN "id" TYPE UUID USING "id"::uuid;
ALTER TABLE "apikey" ALTER COLUMN "id" TYPE UUID USING "id"::uuid;
ALTER TABLE "blob" ALTER COLUMN "id" TYPE UUID USING "id"::uuid;
ALTER TABLE "blob" ALTER COLUMN "eventId" TYPE UUID USING "eventId"::uuid;
ALTER TABLE "link" ALTER COLUMN "id" TYPE UUID USING "id"::uuid;
ALTER TABLE "link" ALTER COLUMN "eventId" TYPE UUID USING "eventId"::uuid;
ALTER TABLE "jobShare" ALTER COLUMN "id" TYPE UUID USING "id"::uuid;
ALTER TABLE "jobShare" ALTER COLUMN "jobId" TYPE UUID USING "jobId"::uuid;
ALTER TABLE "jobShare" ALTER COLUMN "taskId" TYPE UUID USING "taskId"::uuid;
ALTER TABLE "jobSchedule" ALTER COLUMN "id" TYPE UUID USING "id"::uuid;
ALTER TABLE "jobSchedule" ALTER COLUMN "userId" TYPE UUID USING "userId"::uuid;
ALTER TABLE "jobSchedule" ALTER COLUMN "organizationId" TYPE UUID USING "organizationId"::uuid;
ALTER TABLE "jobSchedule" ALTER COLUMN "agentId" TYPE UUID USING "agentId"::uuid;
ALTER TABLE "oauthClient" ALTER COLUMN "id" TYPE UUID USING "id"::uuid;
ALTER TABLE "oauthClient" ALTER COLUMN "userId" TYPE UUID USING "userId"::uuid;
ALTER TABLE "oauthAccessToken" ALTER COLUMN "id" TYPE UUID USING "id"::uuid;
ALTER TABLE "oauthAccessToken" ALTER COLUMN "sessionId" TYPE UUID USING "sessionId"::uuid;
ALTER TABLE "oauthAccessToken" ALTER COLUMN "refreshId" TYPE UUID USING "refreshId"::uuid;
ALTER TABLE "oauthAccessToken" ALTER COLUMN "userId" TYPE UUID USING "userId"::uuid;
ALTER TABLE "oauthRefreshToken" ALTER COLUMN "id" TYPE UUID USING "id"::uuid;
ALTER TABLE "oauthRefreshToken" ALTER COLUMN "sessionId" TYPE UUID USING "sessionId"::uuid;
ALTER TABLE "oauthRefreshToken" ALTER COLUMN "userId" TYPE UUID USING "userId"::uuid;
ALTER TABLE "oauthConsent" ALTER COLUMN "id" TYPE UUID USING "id"::uuid;
ALTER TABLE "oauthConsent" ALTER COLUMN "userId" TYPE UUID USING "userId"::uuid;
ALTER TABLE "jwks" ALTER COLUMN "id" TYPE UUID USING "id"::uuid;
ALTER TABLE "coworker" ALTER COLUMN "id" TYPE UUID USING "id"::uuid;
ALTER TABLE "coworker" ALTER COLUMN "userId" TYPE UUID USING "userId"::uuid;
ALTER TABLE "coworker_api_key" ALTER COLUMN "id" TYPE UUID USING "id"::uuid;
ALTER TABLE "coworker_api_key" ALTER COLUMN "coworkerId" TYPE UUID USING "coworkerId"::uuid;
ALTER TABLE "task" ALTER COLUMN "id" TYPE UUID USING "id"::uuid;
ALTER TABLE "task" ALTER COLUMN "userId" TYPE UUID USING "userId"::uuid;
ALTER TABLE "task" ALTER COLUMN "organizationId" TYPE UUID USING "organizationId"::uuid;
ALTER TABLE "task" ALTER COLUMN "coworkerId" TYPE UUID USING "coworkerId"::uuid;
ALTER TABLE "task_link" ALTER COLUMN "id" TYPE UUID USING "id"::uuid;
ALTER TABLE "task_link" ALTER COLUMN "fromTaskId" TYPE UUID USING "fromTaskId"::uuid;
ALTER TABLE "task_link" ALTER COLUMN "toTaskId" TYPE UUID USING "toTaskId"::uuid;
ALTER TABLE "taskEvent" ALTER COLUMN "id" TYPE UUID USING "id"::uuid;
ALTER TABLE "taskEvent" ALTER COLUMN "taskId" TYPE UUID USING "taskId"::uuid;
ALTER TABLE "taskEvent" ALTER COLUMN "userId" TYPE UUID USING "userId"::uuid;
ALTER TABLE "taskEvent" ALTER COLUMN "coworkerId" TYPE UUID USING "coworkerId"::uuid;
ALTER TABLE "taskEvent" ALTER COLUMN "transactionId" TYPE UUID USING "transactionId"::uuid;
ALTER TABLE "coworker_usage" ALTER COLUMN "id" TYPE UUID USING "id"::uuid;
ALTER TABLE "coworker_usage" ALTER COLUMN "coworkerId" TYPE UUID USING "coworkerId"::uuid;
ALTER TABLE "coworker_usage" ALTER COLUMN "userId" TYPE UUID USING "userId"::uuid;
ALTER TABLE "coworker_usage" ALTER COLUMN "organizationId" TYPE UUID USING "organizationId"::uuid;
ALTER TABLE "coworker_usage" ALTER COLUMN "transactionId" TYPE UUID USING "transactionId"::uuid;
ALTER TABLE "conversation" ALTER COLUMN "id" TYPE UUID USING "id"::uuid;
ALTER TABLE "conversation" ALTER COLUMN "userId" TYPE UUID USING "userId"::uuid;
ALTER TABLE "conversationItem" ALTER COLUMN "id" TYPE UUID USING "id"::uuid;
ALTER TABLE "conversationItem" ALTER COLUMN "conversationId" TYPE UUID USING "conversationId"::uuid;
ALTER TABLE "_AgentToAgentList" ALTER COLUMN "A" TYPE UUID USING "A"::uuid;
ALTER TABLE "_AgentToAgentList" ALTER COLUMN "B" TYPE UUID USING "B"::uuid;
ALTER TABLE "_AgentTag" ALTER COLUMN "A" TYPE UUID USING "A"::uuid;
ALTER TABLE "_AgentTag" ALTER COLUMN "B" TYPE UUID USING "B"::uuid;
ALTER TABLE "_AgentTagOverride" ALTER COLUMN "A" TYPE UUID USING "A"::uuid;
ALTER TABLE "_AgentTagOverride" ALTER COLUMN "B" TYPE UUID USING "B"::uuid;
ALTER TABLE "_AgentCategory" ALTER COLUMN "A" TYPE UUID USING "A"::uuid;
ALTER TABLE "_AgentCategory" ALTER COLUMN "B" TYPE UUID USING "B"::uuid;

-- Remove temporary columns.
ALTER TABLE "user" DROP COLUMN "_new_id";
ALTER TABLE "session" DROP COLUMN "_new_id";
ALTER TABLE "account" DROP COLUMN "_new_id";
ALTER TABLE "verification" DROP COLUMN "_new_id";
ALTER TABLE "passkey" DROP COLUMN "_new_id";
ALTER TABLE "subscription" DROP COLUMN "_new_id";
ALTER TABLE "organization" DROP COLUMN "_new_id";
ALTER TABLE "member" DROP COLUMN "_new_id";
ALTER TABLE "invitation" DROP COLUMN "_new_id";
ALTER TABLE "utmAttribution" DROP COLUMN "_new_id";
ALTER TABLE "notice" DROP COLUMN "_new_id";
ALTER TABLE "noticeAcknowledgment" DROP COLUMN "_new_id";
ALTER TABLE "rateLimit" DROP COLUMN "_new_id";
ALTER TABLE "UnitValue" DROP COLUMN "_new_id";
ALTER TABLE "AgentPricing" DROP COLUMN "_new_id";
ALTER TABLE "AgentFixedPricing" DROP COLUMN "_new_id";
ALTER TABLE "ExampleOutput" DROP COLUMN "_new_id";
ALTER TABLE "UserAgentRating" DROP COLUMN "_new_id";
ALTER TABLE "Agent" DROP COLUMN "_new_id";
ALTER TABLE "Category" DROP COLUMN "_new_id";
ALTER TABLE "Lock" DROP COLUMN "_new_id";
ALTER TABLE "Tag" DROP COLUMN "_new_id";
ALTER TABLE "sync_metadata" DROP COLUMN "_new_id";
ALTER TABLE "AgentList" DROP COLUMN "_new_id";
ALTER TABLE "Transaction" DROP COLUMN "_new_id";
ALTER TABLE "credit_bucket" DROP COLUMN "_new_id";
ALTER TABLE "credit_consumption" DROP COLUMN "_new_id";
ALTER TABLE "Job" DROP COLUMN "_new_id";
ALTER TABLE "jobPurchase" DROP COLUMN "_new_id";
ALTER TABLE "jobEvent" DROP COLUMN "_new_id";
ALTER TABLE "jobInput" DROP COLUMN "_new_id";
ALTER TABLE "CreditCost" DROP COLUMN "_new_id";
ALTER TABLE "apikey" DROP COLUMN "_new_id";
ALTER TABLE "blob" DROP COLUMN "_new_id";
ALTER TABLE "link" DROP COLUMN "_new_id";
ALTER TABLE "jobShare" DROP COLUMN "_new_id";
ALTER TABLE "jobSchedule" DROP COLUMN "_new_id";
ALTER TABLE "oauthClient" DROP COLUMN "_new_id";
ALTER TABLE "oauthAccessToken" DROP COLUMN "_new_id";
ALTER TABLE "oauthRefreshToken" DROP COLUMN "_new_id";
ALTER TABLE "oauthConsent" DROP COLUMN "_new_id";
ALTER TABLE "jwks" DROP COLUMN "_new_id";
ALTER TABLE "coworker" DROP COLUMN "_new_id";
ALTER TABLE "coworker_api_key" DROP COLUMN "_new_id";
ALTER TABLE "task" DROP COLUMN "_new_id";
ALTER TABLE "task_link" DROP COLUMN "_new_id";
ALTER TABLE "taskEvent" DROP COLUMN "_new_id";
ALTER TABLE "coworker_usage" DROP COLUMN "_new_id";
ALTER TABLE "conversation" DROP COLUMN "_new_id";
ALTER TABLE "conversationItem" DROP COLUMN "_new_id";

-- Recreate FKs.
ALTER TABLE "workspace" ADD CONSTRAINT "workspace_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "workspace" ADD CONSTRAINT "workspace_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "session" ADD CONSTRAINT "session_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "account" ADD CONSTRAINT "account_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "passkey" ADD CONSTRAINT "passkey_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "member" ADD CONSTRAINT "member_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "member" ADD CONSTRAINT "member_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "invitation" ADD CONSTRAINT "invitation_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "invitation" ADD CONSTRAINT "invitation_inviterId_fkey" FOREIGN KEY ("inviterId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "utmAttribution" ADD CONSTRAINT "utmAttribution_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "noticeAcknowledgment" ADD CONSTRAINT "noticeAcknowledgment_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "noticeAcknowledgment" ADD CONSTRAINT "noticeAcknowledgment_noticeId_fkey" FOREIGN KEY ("noticeId") REFERENCES "notice"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "UnitValue" ADD CONSTRAINT "UnitValue_agentFixedPricingId_fkey" FOREIGN KEY ("agentFixedPricingId") REFERENCES "AgentFixedPricing"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "AgentPricing" ADD CONSTRAINT "AgentPricing_agentFixedPricingId_fkey" FOREIGN KEY ("agentFixedPricingId") REFERENCES "AgentFixedPricing"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "ExampleOutput" ADD CONSTRAINT "ExampleOutput_agentId_fkey" FOREIGN KEY ("agentId") REFERENCES "Agent"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "ExampleOutput" ADD CONSTRAINT "ExampleOutput_agentIdOverride_fkey" FOREIGN KEY ("agentIdOverride") REFERENCES "Agent"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "UserAgentRating" ADD CONSTRAINT "UserAgentRating_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "UserAgentRating" ADD CONSTRAINT "UserAgentRating_agentId_fkey" FOREIGN KEY ("agentId") REFERENCES "Agent"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Agent" ADD CONSTRAINT "Agent_pricingId_fkey" FOREIGN KEY ("pricingId") REFERENCES "AgentPricing"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "AgentList" ADD CONSTRAINT "AgentList_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Transaction" ADD CONSTRAINT "Transaction_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Transaction" ADD CONSTRAINT "Transaction_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organization"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "credit_bucket" ADD CONSTRAINT "credit_bucket_sourceTransactionId_fkey" FOREIGN KEY ("sourceTransactionId") REFERENCES "Transaction"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "credit_bucket" ADD CONSTRAINT "credit_bucket_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "credit_bucket" ADD CONSTRAINT "credit_bucket_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organization"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "credit_consumption" ADD CONSTRAINT "credit_consumption_bucketId_fkey" FOREIGN KEY ("bucketId") REFERENCES "credit_bucket"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "credit_consumption" ADD CONSTRAINT "credit_consumption_transactionId_fkey" FOREIGN KEY ("transactionId") REFERENCES "Transaction"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Job" ADD CONSTRAINT "Job_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Job" ADD CONSTRAINT "Job_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organization"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Job" ADD CONSTRAINT "Job_agentId_fkey" FOREIGN KEY ("agentId") REFERENCES "Agent"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Job" ADD CONSTRAINT "Job_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "workspace"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Job" ADD CONSTRAINT "Job_transactionId_fkey" FOREIGN KEY ("transactionId") REFERENCES "Transaction"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Job" ADD CONSTRAINT "Job_refundedTransactionId_fkey" FOREIGN KEY ("refundedTransactionId") REFERENCES "Transaction"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Job" ADD CONSTRAINT "Job_jobScheduleId_fkey" FOREIGN KEY ("jobScheduleId") REFERENCES "jobSchedule"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Job" ADD CONSTRAINT "Job_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "task"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "jobPurchase" ADD CONSTRAINT "jobPurchase_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "Job"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "jobEvent" ADD CONSTRAINT "jobEvent_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "Job"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "jobInput" ADD CONSTRAINT "jobInput_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "jobEvent"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "blob" ADD CONSTRAINT "blob_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "jobEvent"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "link" ADD CONSTRAINT "link_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "jobEvent"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "jobShare" ADD CONSTRAINT "jobShare_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "Job"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "jobShare" ADD CONSTRAINT "jobShare_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "task"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "jobSchedule" ADD CONSTRAINT "jobSchedule_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "jobSchedule" ADD CONSTRAINT "jobSchedule_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organization"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "jobSchedule" ADD CONSTRAINT "jobSchedule_agentId_fkey" FOREIGN KEY ("agentId") REFERENCES "Agent"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "jobSchedule" ADD CONSTRAINT "jobSchedule_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "workspace"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "oauthClient" ADD CONSTRAINT "oauthClient_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "oauthAccessToken" ADD CONSTRAINT "oauthAccessToken_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "session"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "oauthAccessToken" ADD CONSTRAINT "oauthAccessToken_refreshId_fkey" FOREIGN KEY ("refreshId") REFERENCES "oauthRefreshToken"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "oauthAccessToken" ADD CONSTRAINT "oauthAccessToken_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "oauthRefreshToken" ADD CONSTRAINT "oauthRefreshToken_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "session"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "oauthRefreshToken" ADD CONSTRAINT "oauthRefreshToken_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "oauthConsent" ADD CONSTRAINT "oauthConsent_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "coworker" ADD CONSTRAINT "coworker_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "coworker_api_key" ADD CONSTRAINT "coworker_api_key_coworkerId_fkey" FOREIGN KEY ("coworkerId") REFERENCES "coworker"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "task" ADD CONSTRAINT "task_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "task" ADD CONSTRAINT "task_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organization"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "task" ADD CONSTRAINT "task_coworkerId_fkey" FOREIGN KEY ("coworkerId") REFERENCES "coworker"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "task" ADD CONSTRAINT "task_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "workspace"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "task_link" ADD CONSTRAINT "task_link_fromTaskId_fkey" FOREIGN KEY ("fromTaskId") REFERENCES "task"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "task_link" ADD CONSTRAINT "task_link_toTaskId_fkey" FOREIGN KEY ("toTaskId") REFERENCES "task"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "taskEvent" ADD CONSTRAINT "taskEvent_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "task"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "taskEvent" ADD CONSTRAINT "taskEvent_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "taskEvent" ADD CONSTRAINT "taskEvent_coworkerId_fkey" FOREIGN KEY ("coworkerId") REFERENCES "coworker"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "taskEvent" ADD CONSTRAINT "taskEvent_transactionId_fkey" FOREIGN KEY ("transactionId") REFERENCES "Transaction"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "coworker_usage" ADD CONSTRAINT "coworker_usage_coworkerId_fkey" FOREIGN KEY ("coworkerId") REFERENCES "coworker"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "coworker_usage" ADD CONSTRAINT "coworker_usage_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "coworker_usage" ADD CONSTRAINT "coworker_usage_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organization"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "coworker_usage" ADD CONSTRAINT "coworker_usage_transactionId_fkey" FOREIGN KEY ("transactionId") REFERENCES "Transaction"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "conversation" ADD CONSTRAINT "conversation_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "conversationItem" ADD CONSTRAINT "conversationItem_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "conversation"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "_AgentToAgentList" ADD CONSTRAINT "_AgentToAgentList_A_fkey" FOREIGN KEY ("A") REFERENCES "Agent"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "_AgentToAgentList" ADD CONSTRAINT "_AgentToAgentList_B_fkey" FOREIGN KEY ("B") REFERENCES "AgentList"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "_AgentTag" ADD CONSTRAINT "_AgentTag_A_fkey" FOREIGN KEY ("A") REFERENCES "Agent"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "_AgentTag" ADD CONSTRAINT "_AgentTag_B_fkey" FOREIGN KEY ("B") REFERENCES "Tag"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "_AgentTagOverride" ADD CONSTRAINT "_AgentTagOverride_A_fkey" FOREIGN KEY ("A") REFERENCES "Agent"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "_AgentTagOverride" ADD CONSTRAINT "_AgentTagOverride_B_fkey" FOREIGN KEY ("B") REFERENCES "Tag"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "_AgentCategory" ADD CONSTRAINT "_AgentCategory_A_fkey" FOREIGN KEY ("A") REFERENCES "Agent"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "_AgentCategory" ADD CONSTRAINT "_AgentCategory_B_fkey" FOREIGN KEY ("B") REFERENCES "Category"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Recreate the task-link unordered-pair unique index (see 20260323120002_add_task_link).
CREATE UNIQUE INDEX "task_link_task_pair_key" ON "task_link" (
  LEAST("fromTaskId", "toTaskId"),
  GREATEST("fromTaskId", "toTaskId")
);

DROP FUNCTION IF EXISTS migration_rekey_text_pk_to_uuid(TEXT);
