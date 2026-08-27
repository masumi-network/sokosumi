import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const packageRoot = join(dirname(fileURLToPath(import.meta.url)), "../../..");
const schema = readFileSync(join(packageRoot, "prisma/schema.prisma"), "utf8");
const migration = readFileSync(
  join(
    packageRoot,
    "prisma/migrations/20260827200000_soko_bot_deletion/migration.sql",
  ),
  "utf8",
);

function sokoBotModel(): string {
  const match = schema.match(/model SokoBot\s*\{([\s\S]*?)\n\}/);
  expect(match, "model SokoBot in schema.prisma").toBeTruthy();
  return match?.[1] ?? "";
}

describe("one live Soko Bot per user and workspace", () => {
  it("has no plain unique that a tombstone would occupy", () => {
    // A full unique on (userId, workspaceId) counts deleted rows, so an owner
    // whose Tasks keep their bot on record could never create a new one.
    expect(sokoBotModel()).not.toMatch(/@@unique\(\[userId, workspaceId\]\)/);
  });

  it("enforces the rule with a partial unique index instead", () => {
    // Prisma cannot express `WHERE deleted_at IS NULL`, so the index lives in
    // raw SQL and this test is what keeps it from being dropped silently.
    expect(migration).toMatch(
      /CREATE UNIQUE INDEX "orchestrator_user_workspace_live_key"/,
    );
    expect(migration).toMatch(/WHERE "deleted_at" IS NULL/);
    expect(migration).toMatch(
      /DROP INDEX IF EXISTS "orchestrator_userId_workspaceId_key"/,
    );
  });

  it("keeps deleted_at on the bot table", () => {
    expect(sokoBotModel()).toMatch(/deletedAt\s+DateTime\?/);
    expect(migration).toMatch(/ADD COLUMN "deleted_at"/);
  });
});
