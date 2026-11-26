-- Deleting a quoted post also flags its cancelled quotes, which keep their
-- status. The foreign key clears their link either way, so without the flag
-- a cancelled quote restored later would publish as a standalone post.
-- Their revision stays: the flag is not an owner edit, and an undo that
-- restores them still holds the revision it recorded.
CREATE OR REPLACE FUNCTION social_post_quote_before_delete() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    UPDATE "social_post"
    SET "needsAttentionReason" = 'The quoted post was cancelled',
        "lastError" = 'The quoted post was cancelled',
        "status" = CASE WHEN "status" IN ('DRAFT', 'NEEDS_APPROVAL', 'CANCELED') THEN "status" ELSE 'FAILED'::"SocialPostStatus" END,
        "nextAttemptAt" = NULL,
        "leaseToken" = NULL,
        "leaseExpiresAt" = NULL,
        "revision" = CASE WHEN "status" = 'CANCELED' THEN "revision" ELSE "revision" + 1 END,
        "updatedAt" = CURRENT_TIMESTAMP
    WHERE "quotedPostId" = OLD."id"
      AND "publishedExternalId" IS NULL
      AND "status" <> 'PUBLISHED';
    RETURN OLD;
END;
$$;
