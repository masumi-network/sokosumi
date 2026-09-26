import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const packageRoot = join(dirname(fileURLToPath(import.meta.url)), "../../..");
const migration = readFileSync(
  join(
    packageRoot,
    "prisma/migrations/20260914120000_calendar_collaboration_live/migration.sql",
  ),
  "utf8",
);

describe("Calendar collaboration migration", () => {
  it("erases only the deleted workspace outbox after legacy parent cascades", () => {
    const erasureMigration = readFileSync(
      join(
        packageRoot,
        "prisma/migrations/20260922140000_calendar_workspace_erasure/migration.sql",
      ),
      "utf8",
    );
    expect(erasureMigration).toMatch(
      /CREATE OR REPLACE FUNCTION erase_calendar_outbox_for_workspace_delete\(\)/,
    );
    expect(erasureMigration).toMatch(
      /DELETE FROM "calendar_invalidation_outbox"\s+WHERE "workspaceId" = OLD.id;/,
    );
    expect(erasureMigration).toContain(
      'DROP TRIGGER IF EXISTS calendar_workspace_outbox_erasure ON "workspace"',
    );
    expect(erasureMigration).toMatch(
      /CREATE TRIGGER calendar_workspace_outbox_erasure\s+AFTER DELETE ON "workspace"\s+FOR EACH ROW EXECUTE FUNCTION erase_calendar_outbox_for_workspace_delete\(\);/,
    );
  });
  it("captures pending emails before the membership FK cascades notifications", () => {
    const cleanupOrderMigration = readFileSync(
      join(
        packageRoot,
        "prisma/migrations/20260921190000_calendar_email_cleanup_before_cascade/migration.sql",
      ),
      "utf8",
    );
    expect(cleanupOrderMigration).toMatch(
      /CREATE TRIGGER calendar_access_cleanup_member_delete\s+BEFORE DELETE ON "member"/,
    );
  });

  it("activates atomic revisions and a durable outbox for every Calendar surface", () => {
    expect(migration).toContain("enqueue_calendar_invalidation");
    expect(migration).toContain("calendar_invalidation_revision_seq");
    expect(migration).toContain("txid_current()::TEXT");
    expect(migration).toContain("calendar_task_invalidation");
    expect(migration).toContain("calendar_occurrence_invalidation");
    expect(migration).toContain("calendar_project_invalidation");
    expect(migration).toContain('INSERT INTO "calendar_invalidation_outbox"');
  });

  it("keeps trigger-time outbox writes independent of parent row locks", () => {
    expect(migration).toContain(
      'DROP CONSTRAINT "calendar_invalidation_outbox_workspaceId_fkey"',
    );
    expect(migration).toContain(
      'DROP CONSTRAINT "calendar_invalidation_outbox_projectId_fkey"',
    );
  });

  it.each([
    'OLD."workspaceId"',
    'OLD."projectId"',
    'OLD."ownerId"',
    "OLD.name",
    "OLD.status",
    'OLD."assigneeId"',
    'OLD."assigneeUserId"',
    'OLD."assigneeSokoBotId"',
    'OLD."scheduleRevision"',
    'OLD."nextRunAt"',
    "OLD.metadata",
    'OLD."archivedAt"',
    'OLD."effectiveScheduledAt"',
    "OLD.state",
    'OLD."sourceWorkspaceId"',
    'OLD."sourceType"',
    'OLD."sourceProjectId"',
    'OLD."sourceAccuracy"',
    'OLD."timeAccuracy"',
  ])("tracks filter/source/occurrence field %s", (field) => {
    expect(migration).toContain(field);
  });

  it("revokes member access durably and erases inaccessible notifications", () => {
    expect(migration).toContain("calendar_access_cleanup_member_delete");
    expect(migration).toContain("'calendar_access_revoked'");
    expect(migration).toMatch(
      /DELETE FROM "notification"[\s\S]+"userId" = OLD\."userId"[\s\S]+"workspaceId" = organization_workspace_id/,
    );
    expect(migration).toMatch(
      /UPDATE "notification" AS notification_row[\s\S]+SET "workspaceId" = "task"\."workspaceId"/,
    );
    expect(migration).toMatch(
      /UPDATE "notification" AS notification_row[\s\S]+SET "workspaceId" = "job"\."workspaceId"/,
    );
    expect(migration).toContain(
      "notification_row.metadata::JSONB->>'workspaceId'",
    );
    expect(migration).toContain(
      "pg_input_is_valid(notification_row.metadata, 'jsonb')",
    );
    expect(migration).toContain(
      'notification_row."referenceId" = "chat_room".id::TEXT',
    );
    expect(migration).toContain("\"chat_room_user_member\".access = 'member'");
    expect(migration).toContain('FROM "Job" AS "job"');
    expect(migration).toMatch(
      /CREATE TRIGGER calendar_membership_fence_member_insert\s+AFTER INSERT ON "member"/,
    );
  });

  it("does not replay terminal Project notifications from before rollout", () => {
    expect(migration).toContain(
      'ADD COLUMN "notificationHandledAt" TIMESTAMP(3)',
    );
    expect(migration).toMatch(
      /UPDATE "project_event"\s+SET "notificationHandledAt" = "createdAt"\s+WHERE kind = 'CLOSE_FINALIZED'/,
    );
  });

  it("infers Workspace scope for rolling-deploy notification writers", () => {
    expect(migration).toContain('IF NEW."workspaceId" IS NULL THEN');
    expect(migration).toContain("IF NEW.kind = 'TASK' THEN");
    expect(migration).toContain("ELSIF NEW.kind = 'JOB' THEN");
    expect(migration).toContain("ELSIF NEW.kind = 'CHAT' THEN");
    expect(migration).toContain("ELSIF NEW.kind = 'SYSTEM'");
  });

  it("invalidates both sides when a Calendar row changes workspace", () => {
    expect(migration).toContain(
      "old_workspace_id IS DISTINCT FROM new_workspace_id",
    );
    expect(migration).toContain(
      "old_workspace_id,\n        old_project_id,\n        NULL",
    );
    expect(migration).toContain(
      "new_workspace_id,\n        NULL,\n        new_project_id",
    );
  });

  it("keeps identity references out of durable invalidation payloads", () => {
    expect(migration).not.toContain("'ownerId'");
    expect(migration).not.toContain("'assigneeUserId'");
    expect(migration).not.toContain("'actorUserId'");
    expect(migration).not.toContain("calendar_task_snapshot");
    expect(migration).not.toContain("calendar_occurrence_snapshot");
  });

  it("uses foreign keys to erase actor references and recipient notifications", () => {
    expect(migration).toContain("notification_userId_fkey");
    expect(migration).toContain("task_schedule_occurrence_actorUserId_fkey");
    expect(migration).toContain("project_close_operation_actorUserId_fkey");
    expect(migration).toContain("project_event_actorUserId_fkey");
    expect(migration).toContain("notification_organization_member_fkey");
    expect(migration).toContain("notification_workspace_membership_scope");
    expect(migration.match(/ON DELETE SET NULL/g)).toHaveLength(3);
  });
});
