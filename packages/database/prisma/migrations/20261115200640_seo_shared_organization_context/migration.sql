ALTER TABLE "project_seo_observation" ADD COLUMN "visibility" TEXT NOT NULL DEFAULT 'PRIVATE';
ALTER TABLE "seo_audit_chat_turn" ADD COLUMN "visibility" TEXT NOT NULL DEFAULT 'PRIVATE';

ALTER TABLE "project_seo_observation" ADD CONSTRAINT "project_seo_observation_visibility_check" CHECK ("visibility" IN ('PRIVATE', 'SHARED'));
ALTER TABLE "seo_audit_chat_turn" ADD CONSTRAINT "seo_audit_chat_turn_visibility_check" CHECK ("visibility" IN ('PRIVATE', 'SHARED'));
