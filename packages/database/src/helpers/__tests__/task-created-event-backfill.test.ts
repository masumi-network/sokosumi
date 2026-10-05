import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const packageRoot = join(dirname(fileURLToPath(import.meta.url)), "../../..");
const backfillSql = readFileSync(
  join(
    packageRoot,
    "prisma/migrations/20261005131023_task_created_event_backfill/migration.sql",
  ),
  "utf8",
);

describe("task CREATED event backfill", () => {
  it("skips tasks that already have a CREATED event", () => {
    expect(backfillSql).toContain("WHERE NOT EXISTS (");
    expect(backfillSql).toContain('existing."taskId" = earliest."taskId"');
    expect(backfillSql).toContain("existing.status = 'CREATED'");
  });
});
