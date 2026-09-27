-- AddForeignKey
-- Guarded so a database that applied the migration under its former folder
-- name (before the prefix collision with 20260904170000_rewrite_soko_bot_avatar_blob_urls
-- was resolved) does not fail when the migration re-runs under the new name.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'project_social_connection_intent_socialConnectionId_fkey'
      AND conrelid = 'project_social_connection_intent'::regclass
  ) THEN
    ALTER TABLE "project_social_connection_intent" ADD CONSTRAINT "project_social_connection_intent_socialConnectionId_fkey" FOREIGN KEY ("socialConnectionId") REFERENCES "project_social_connection"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;
