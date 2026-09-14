import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const packageRoot = join(dirname(fileURLToPath(import.meta.url)), "../../..");
const migration = readFileSync(
  join(
    packageRoot,
    "prisma/migrations/20260914130000_protect_calendar_deletion_erasure/migration.sql",
  ),
  "utf8",
);

describe("Calendar deletion and erasure migration", () => {
  it("records exact Project deletion retries without retaining erased actors", () => {
    expect(migration).toMatch(
      /CREATE TABLE "project_deletion_tombstone" \([\s\S]*?"workspaceId" UUID NOT NULL[\s\S]*?"projectId" UUID NOT NULL[\s\S]*?"operationId" UUID NOT NULL[\s\S]*?"actorUserId" TEXT[\s\S]*?\);/,
    );
    expect(migration).toContain(
      'CREATE UNIQUE INDEX "project_deletion_tombstone_workspaceId_operationId_key"',
    );
    expect(migration).toContain(
      'CREATE UNIQUE INDEX "project_deletion_tombstone_workspaceId_projectId_key"',
    );
    expect(migration).toMatch(
      /CONSTRAINT "project_deletion_tombstone_workspaceId_fkey"[\s\S]*?REFERENCES "workspace"\("id"\)[\s\S]*?ON DELETE CASCADE/,
    );
    expect(migration).toMatch(
      /CONSTRAINT "project_deletion_tombstone_actorUserId_fkey"[\s\S]*?REFERENCES "user"\("id"\)[\s\S]*?ON DELETE SET NULL/,
    );
    expect(migration).not.toContain(
      "project_deletion_tombstone_projectId_fkey",
    );
  });

  it("guards Calendar history for every Project without bypasses", () => {
    expect(migration).toContain(
      "CREATE OR REPLACE FUNCTION prevent_project_delete_with_calendar_history()",
    );
    expect(migration).toContain('"task_schedule_quarantine"');
    expect(migration).toContain('FROM "task_link"');
    expect(migration).toContain('FROM "task_schedule_occurrence"');
    expect(migration).toContain('FROM "project_close_operation"');
    expect(migration).toContain('FROM "project_event"');
    expect(migration).not.toContain("@nmkr.io");
    expect(migration).not.toContain("pg_trigger_depth");
  });

  it("publishes Project deletion invalidation only after deletion succeeds", () => {
    expect(migration).toMatch(
      /DROP TRIGGER calendar_project_delete_invalidation ON "project";[\s\S]*?CREATE TRIGGER calendar_project_delete_invalidation\s+AFTER DELETE ON "project"/,
    );
  });

  it("erases durable Calendar outbox rows with their Workspace", () => {
    expect(migration).toMatch(
      /CREATE OR REPLACE FUNCTION erase_calendar_outbox_for_workspace_delete\(\)[\s\S]*?DELETE FROM "calendar_invalidation_outbox"\s+WHERE "workspaceId" = OLD\.id;/,
    );
    expect(migration).toMatch(
      /CREATE TRIGGER calendar_workspace_outbox_erasure\s+AFTER DELETE ON "workspace"\s+FOR EACH ROW EXECUTE FUNCTION erase_calendar_outbox_for_workspace_delete\(\);/,
    );
  });
});
