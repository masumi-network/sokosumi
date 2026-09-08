import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const packageRoot = join(dirname(fileURLToPath(import.meta.url)), "../../..");
const schemaPath = join(packageRoot, "prisma/schema.prisma");
const migrationPath = join(
  packageRoot,
  "prisma/migrations/20260908010000_notification_kind_reference_index/migration.sql",
);

function notificationModel(): string {
  const schema = readFileSync(schemaPath, "utf8");
  const match = schema.match(/model Notification\s*\{([\s\S]*?)\n\}/);

  expect(match, "model Notification in schema.prisma").toBeTruthy();

  return match?.[1] ?? "";
}

describe("chat notification lookup by room", () => {
  /**
   * Editing or deleting a message has to find the copy of it that its
   * notifications carry, for every recipient at once. Without this index that
   * read is a sequential scan of every notification in the product.
   */
  it("schema.prisma indexes notifications by kind and referenceId", () => {
    expect(notificationModel()).toContain("@@index([kind, referenceId])");
  });

  it("the migration creates that index on the notification table", () => {
    expect(readFileSync(migrationPath, "utf8")).toMatch(
      /CREATE INDEX CONCURRENTLY "notification_kind_referenceId_idx" ON "notification"\("kind", "referenceId"\)/,
    );
  });

  /**
   * Core runs its migrations while the previous instance still serves
   * traffic. A plain build holds a write lock for its whole duration, so
   * every chat message posted in that window would block on it.
   */
  it("builds the index without locking writes on the table", () => {
    const sql = readFileSync(migrationPath, "utf8");

    expect(sql).toContain("CREATE INDEX CONCURRENTLY");
    expect(sql).not.toMatch(/CREATE INDEX "notification_kind/);
  });
});
