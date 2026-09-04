import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const packageRoot = join(dirname(fileURLToPath(import.meta.url)), "../../..");
const migrationsDir = join(packageRoot, "prisma/migrations");
const schema = readFileSync(join(packageRoot, "prisma/schema.prisma"), "utf8");

/** Every migration, in apply order, so assertions see the final state. */
function migrationSql(): string {
  return readdirSync(migrationsDir)
    .filter((entry) => entry.startsWith("2026"))
    .sort()
    .map((entry) => {
      try {
        return readFileSync(
          join(migrationsDir, entry, "migration.sql"),
          "utf8",
        );
      } catch {
        return "";
      }
    })
    .join("\n");
}

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

  it("maps the entity to soko_bot, not orchestrator", () => {
    expect(sokoBotModel()).toMatch(/@@map\("soko_bot"\)/);
    expect(schema).toMatch(/@@map\("soko_bot_usage"\)/);
    expect(schema).toMatch(/@@map\("chat_room_soko_bot_member"\)/);
    expect(schema).not.toMatch(/@@map\("orchestrator"\)/);
  });

  it("enforces the rule with a partial unique index instead", () => {
    // Prisma cannot express the predicate, so the index lives in raw SQL and
    // this test is what keeps it from being dropped silently.
    const sql = migrationSql();
    const lastLiveKey = sql.lastIndexOf("user_workspace_live_key");
    expect(lastLiveKey).toBeGreaterThan(-1);
    expect(sql.slice(Math.max(0, lastLiveKey - 80))).toMatch(
      /CREATE UNIQUE INDEX "soko_bot_user_workspace_live_key"/,
    );
    expect(sql).toMatch(
      /DROP INDEX IF EXISTS "orchestrator_userId_workspaceId_key"/,
    );
  });

  it("names the column the way Prisma will query it", () => {
    // `soko_bot` maps only its table name, so its columns stay camelCase.
    // Adding `deleted_at` instead made Prisma query a column that did not
    // exist and every Soko Bot read returned 500.
    expect(sokoBotModel()).toMatch(/deletedAt\s+DateTime\?/);
    expect(sokoBotModel()).not.toMatch(/deletedAt[^\n]*@map\(/);

    const sql = migrationSql();
    const lastDeletedAtIndex = sql.lastIndexOf(
      'CREATE UNIQUE INDEX "soko_bot_user_workspace_live_key"',
    );
    const finalIndex = sql.slice(lastDeletedAtIndex);
    expect(finalIndex).toMatch(/WHERE "deletedAt" IS NULL/);
    expect(sql).toMatch(
      /RENAME COLUMN "deleted_at" TO "deletedAt"|ADD COLUMN "deletedAt"/,
    );
  });
});

describe("stored orchestrator: prefixes", () => {
  it("rewrites chat_room.directKey and mention tokens to sokoBot:", () => {
    const sql = migrationSql();
    expect(sql).toMatch(/replace\("directKey", 'orchestrator:', 'sokoBot:'\)/);
    expect(sql).toMatch(/replace\("content", '@orchestrator:', '@sokoBot:'\)/);
  });
});
