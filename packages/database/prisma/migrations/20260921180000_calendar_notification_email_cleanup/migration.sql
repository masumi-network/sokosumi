-- Preserve delayed email IDs in the durable revocation outbox before removing notification rows.
CREATE OR REPLACE FUNCTION calendar_access_cleanup_on_member_delete()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  organization_workspace_id UUID;
  pending_notification_emails JSONB;
BEGIN
  SELECT id INTO organization_workspace_id
  FROM "workspace"
  WHERE "organizationId" = OLD."organizationId";

  IF organization_workspace_id IS NULL THEN
    RETURN OLD;
  END IF;

  -- Hold the same lock as the publisher across cleanup and the revoke event,
  -- so no stale membership snapshot can fan out after removal commits.
  PERFORM pg_advisory_xact_lock(
    hashtextextended(
      'calendar-members:' || organization_workspace_id::TEXT,
      0
    )
  );

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'id', id,
    'emailId', "emailId",
    'emailScheduledAt', "emailScheduledAt"
  )), '[]'::jsonb)
  INTO pending_notification_emails
  FROM "notification"
  WHERE "userId" = OLD."userId"
    AND "workspaceId" = organization_workspace_id
    AND "emailId" IS NOT NULL
    AND "emailScheduledAt" > CURRENT_TIMESTAMP;

  DELETE FROM "notification"
  WHERE "userId" = OLD."userId"
    AND "workspaceId" = organization_workspace_id;

  PERFORM enqueue_calendar_invalidation(
    organization_workspace_id,
    NULL,
    NULL,
    jsonb_build_object(
      'kind', 'calendar_access_revoked',
      'userId', OLD."userId",
      'organizationId', OLD."organizationId",
      'pendingNotificationEmails', pending_notification_emails
    )
  );

  RETURN OLD;
END;
$$;
