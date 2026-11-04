-- SOKD-124: the Calendar shows Social posts, Newsletter issues, Contact
-- follow-ups and the approved Marketing strategy's pieces, so a change to any
-- of them invalidates it live, like a Task change does. Updates signal only
-- when a column the Calendar entry shows changes.

CREATE INDEX "contact_workspaceId_followUpAt_idx"
  ON "contact"("workspaceId", "followUpAt");

-- A row moving between Workspaces invalidates both; otherwise one signal
-- covers the old and new Project.
CREATE OR REPLACE FUNCTION enqueue_calendar_feature_invalidation(
  old_workspace_id UUID,
  new_workspace_id UUID,
  old_project_id UUID,
  new_project_id UUID,
  invalidation_payload JSONB
)
RETURNS VOID
LANGUAGE plpgsql
AS $$
BEGIN
  IF old_workspace_id IS NOT DISTINCT FROM new_workspace_id THEN
    IF new_workspace_id IS NOT NULL THEN
      PERFORM enqueue_calendar_invalidation(
        new_workspace_id,
        old_project_id,
        new_project_id,
        invalidation_payload
      );
    END IF;
    RETURN;
  END IF;

  IF old_workspace_id IS NOT NULL THEN
    PERFORM enqueue_calendar_invalidation(
      old_workspace_id,
      old_project_id,
      NULL,
      invalidation_payload
    );
  END IF;
  IF new_workspace_id IS NOT NULL THEN
    PERFORM enqueue_calendar_invalidation(
      new_workspace_id,
      NULL,
      new_project_id,
      invalidation_payload
    );
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION invalidate_calendar_for_social_post_change()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND ROW(
    OLD."scheduledAt", OLD.status, OLD."projectId", OLD."workspaceId",
    OLD.text, OLD.provider, OLD.revision, OLD."socialConnectionId",
    OLD."quotedPostId", OLD."needsAttentionReason"
  ) IS NOT DISTINCT FROM ROW(
    NEW."scheduledAt", NEW.status, NEW."projectId", NEW."workspaceId",
    NEW.text, NEW.provider, NEW.revision, NEW."socialConnectionId",
    NEW."quotedPostId", NEW."needsAttentionReason"
  ) THEN
    RETURN NULL;
  END IF;

  PERFORM enqueue_calendar_feature_invalidation(
    CASE WHEN TG_OP = 'INSERT' THEN NULL ELSE OLD."workspaceId" END,
    CASE WHEN TG_OP = 'DELETE' THEN NULL ELSE NEW."workspaceId" END,
    CASE WHEN TG_OP = 'INSERT' THEN NULL ELSE OLD."projectId" END,
    CASE WHEN TG_OP = 'DELETE' THEN NULL ELSE NEW."projectId" END,
    jsonb_build_object(
      'kind', 'social_post_changed',
      'operation', lower(TG_OP),
      'socialPostId', COALESCE(NEW.id, OLD.id)
    )
  );
  RETURN NULL;
END;
$$;

CREATE TRIGGER calendar_social_post_invalidation
AFTER INSERT OR UPDATE OR DELETE ON "social_post"
FOR EACH ROW EXECUTE FUNCTION invalidate_calendar_for_social_post_change();

CREATE OR REPLACE FUNCTION invalidate_calendar_for_newsletter_issue_change()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND ROW(
    OLD."scheduledAt", OLD."sentAt", OLD.status, OLD.subject,
    OLD."projectId", OLD."workspaceId"
  ) IS NOT DISTINCT FROM ROW(
    NEW."scheduledAt", NEW."sentAt", NEW.status, NEW.subject,
    NEW."projectId", NEW."workspaceId"
  ) THEN
    RETURN NULL;
  END IF;

  PERFORM enqueue_calendar_feature_invalidation(
    CASE WHEN TG_OP = 'INSERT' THEN NULL ELSE OLD."workspaceId" END,
    CASE WHEN TG_OP = 'DELETE' THEN NULL ELSE NEW."workspaceId" END,
    CASE WHEN TG_OP = 'INSERT' THEN NULL ELSE OLD."projectId" END,
    CASE WHEN TG_OP = 'DELETE' THEN NULL ELSE NEW."projectId" END,
    jsonb_build_object(
      'kind', 'newsletter_issue_changed',
      'operation', lower(TG_OP),
      'issueId', COALESCE(NEW.id, OLD.id)
    )
  );
  RETURN NULL;
END;
$$;

CREATE TRIGGER calendar_newsletter_issue_invalidation
AFTER INSERT OR UPDATE OR DELETE ON "newsletter_issue"
FOR EACH ROW EXECUTE FUNCTION invalidate_calendar_for_newsletter_issue_change();

-- Contacts belong to the Workspace, not a Project. Only a contact with a
-- follow-up date (before or after the change) is on the Calendar.
CREATE OR REPLACE FUNCTION invalidate_calendar_for_contact_change()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'UPDATE' THEN
    IF (OLD."followUpAt" IS NULL AND NEW."followUpAt" IS NULL) OR ROW(
      OLD."followUpAt", OLD.name, OLD.organization, OLD."avatarUrl",
      OLD."nextStep", OLD."archivedAt", OLD."mergedIntoId", OLD."workspaceId"
    ) IS NOT DISTINCT FROM ROW(
      NEW."followUpAt", NEW.name, NEW.organization, NEW."avatarUrl",
      NEW."nextStep", NEW."archivedAt", NEW."mergedIntoId", NEW."workspaceId"
    ) THEN
      RETURN NULL;
    END IF;
  ELSIF COALESCE(NEW."followUpAt", OLD."followUpAt") IS NULL THEN
    RETURN NULL;
  END IF;

  PERFORM enqueue_calendar_feature_invalidation(
    CASE WHEN TG_OP = 'INSERT' THEN NULL ELSE OLD."workspaceId" END,
    CASE WHEN TG_OP = 'DELETE' THEN NULL ELSE NEW."workspaceId" END,
    NULL,
    NULL,
    jsonb_build_object(
      'kind', 'contact_changed',
      'operation', lower(TG_OP),
      'contactId', COALESCE(NEW.id, OLD.id)
    )
  );
  RETURN NULL;
END;
$$;

CREATE TRIGGER calendar_contact_invalidation
AFTER INSERT OR UPDATE OR DELETE ON "contact"
FOR EACH ROW EXECUTE FUNCTION invalidate_calendar_for_contact_change();

-- Only the approved version is on the Calendar. A Project or Workspace delete
-- removes the row with its parent, and their own triggers cover it.
CREATE OR REPLACE FUNCTION invalidate_calendar_for_marketing_strategy_change()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  target_workspace_id UUID;
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW."approvedAt" IS NULL THEN RETURN NULL; END IF;
  ELSIF TG_OP = 'DELETE' THEN
    IF OLD."approvedAt" IS NULL THEN RETURN NULL; END IF;
  ELSIF (OLD."approvedAt" IS NULL AND NEW."approvedAt" IS NULL)
    OR ROW(OLD."approvedAt", OLD.plan)
      IS NOT DISTINCT FROM ROW(NEW."approvedAt", NEW.plan) THEN
    RETURN NULL;
  END IF;

  SELECT "workspaceId" INTO target_workspace_id
  FROM "project"
  WHERE id = COALESCE(NEW."projectId", OLD."projectId");
  IF target_workspace_id IS NULL THEN
    RETURN NULL;
  END IF;

  PERFORM enqueue_calendar_invalidation(
    target_workspace_id,
    COALESCE(NEW."projectId", OLD."projectId"),
    NULL,
    jsonb_build_object(
      'kind', 'marketing_strategy_changed',
      'operation', lower(TG_OP),
      'strategyId', COALESCE(NEW.id, OLD.id)
    )
  );
  RETURN NULL;
END;
$$;

CREATE TRIGGER calendar_marketing_strategy_invalidation
AFTER INSERT OR UPDATE OR DELETE ON "marketing_strategy"
FOR EACH ROW EXECUTE FUNCTION invalidate_calendar_for_marketing_strategy_change();

-- A written piece links its file to a calendar entry of the approved version.
CREATE OR REPLACE FUNCTION invalidate_calendar_for_marketing_strategy_file_change()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  strategy_id UUID := COALESCE(NEW."marketingStrategyId", OLD."marketingStrategyId");
  target_workspace_id UUID;
  target_project_id UUID;
BEGIN
  SELECT project.id, project."workspaceId"
  INTO target_project_id, target_workspace_id
  FROM "marketing_strategy" AS strategy
  JOIN "project" ON project.id = strategy."projectId"
  WHERE strategy.id = strategy_id AND strategy."approvedAt" IS NOT NULL;
  IF target_workspace_id IS NULL THEN
    RETURN NULL;
  END IF;

  PERFORM enqueue_calendar_invalidation(
    target_workspace_id,
    target_project_id,
    NULL,
    jsonb_build_object(
      'kind', 'marketing_strategy_changed',
      'operation', lower(TG_OP),
      'strategyId', strategy_id
    )
  );
  RETURN NULL;
END;
$$;

CREATE TRIGGER calendar_marketing_strategy_file_invalidation
AFTER INSERT OR DELETE ON "marketing_strategy_file"
FOR EACH ROW EXECUTE FUNCTION invalidate_calendar_for_marketing_strategy_file_change();
