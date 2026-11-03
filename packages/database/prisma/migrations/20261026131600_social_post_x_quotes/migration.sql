ALTER TABLE "social_post"
    ADD COLUMN "quotedPostId" UUID,
    ADD COLUMN "needsAttentionReason" TEXT;

CREATE INDEX "social_post_quotedPostId_idx" ON "social_post"("quotedPostId");

ALTER TABLE "social_post" ADD CONSTRAINT "social_post_quotedPostId_fkey"
    FOREIGN KEY ("quotedPostId") REFERENCES "social_post"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Keep the reason before SET NULL erases the dependency, including deletes outside Core.
CREATE FUNCTION social_post_quote_before_delete() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    UPDATE "social_post"
    SET "needsAttentionReason" = 'The quoted post was cancelled',
        "lastError" = 'The quoted post was cancelled',
        "status" = CASE WHEN "status" IN ('DRAFT', 'NEEDS_APPROVAL') THEN "status" ELSE 'FAILED'::"SocialPostStatus" END,
        "nextAttemptAt" = NULL,
        "leaseToken" = NULL,
        "leaseExpiresAt" = NULL,
        "revision" = "revision" + 1,
        "updatedAt" = CURRENT_TIMESTAMP
    WHERE "quotedPostId" = OLD."id"
      AND "publishedExternalId" IS NULL
      AND "status" NOT IN ('PUBLISHED', 'CANCELED');
    RETURN OLD;
END;
$$;

CREATE TRIGGER social_post_quote_before_delete
    BEFORE DELETE ON "social_post"
    FOR EACH ROW EXECUTE FUNCTION social_post_quote_before_delete();
