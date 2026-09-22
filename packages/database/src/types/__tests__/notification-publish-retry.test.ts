import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const packageRoot = join(dirname(fileURLToPath(import.meta.url)), "../../..");
const schema = readFileSync(
  join(packageRoot, "prisma/notification.prisma"),
  "utf8",
);
const migration = readFileSync(
  join(
    packageRoot,
    "prisma/migrations/20260921213000_notification_publish_retry/migration.sql",
  ),
  "utf8",
);

describe("notification publish retry migration", () => {
  it("leaves existing notifications unqueued", () => {
    for (const field of [
      "publishId",
      "publishPush",
      "publishCreated",
      "publishQueuedAt",
      "publishNextAttemptAt",
    ]) {
      expect(schema).toMatch(
        new RegExp(`${field}\\s+(String|Boolean|DateTime)\\?`),
      );
      expect(migration).toContain(`ADD COLUMN "${field}"`);
    }
    expect(migration.split(";")[0]).not.toMatch(/NOT NULL|DEFAULT/);
    expect(migration).not.toMatch(/UPDATE /);
  });

  it("indexes only pending work without a blocking index build", () => {
    expect(migration).toContain(
      'CREATE INDEX CONCURRENTLY "notification_publishNextAttemptAt_idx"',
    );
    expect(migration).toContain('WHERE "publishNextAttemptAt" IS NOT NULL');
    expect(schema).toContain(
      "@@index([publishNextAttemptAt], where: { publishNextAttemptAt: { not: null } })",
    );
  });
});
