import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const packageRoot = join(dirname(fileURLToPath(import.meta.url)), "../../..");
const migration = readFileSync(
  join(
    packageRoot,
    "prisma/migrations/20260817190000_add_soko_bot_control_plane/migration.sql",
  ),
  "utf8",
);

function sqlBlock(pattern: RegExp, name: string): string {
  const match = migration.match(pattern);
  expect(match, name).toBeTruthy();
  return match?.[0] ?? "";
}

describe("Soko Bot control-plane migration", () => {
  it("fails before backfill when any Hermes message owner lacks a bot", () => {
    const invariant = sqlBlock(
      /DO \$\$[\s\S]*?unmapped_message_count[\s\S]*?\$\$;/,
      "Hermes owner mapping invariant",
    );
    const invariantPosition = migration.indexOf(invariant);
    const firstDdlPosition = migration.indexOf('CREATE TYPE "SokoBotStatus"');
    const backfillPosition = migration.indexOf(
      'INSERT INTO "soko_bot_legacy_message"',
    );

    expect(invariant).toMatch(/LEFT JOIN "orchestrator"/);
    expect(invariant).toMatch(/WHERE bot\."id" IS NULL/);
    expect(invariant).toContain("have no Soko Bot owner mapping");
    expect(invariant).toContain("ERRCODE = 'check_violation'");
    expect(invariantPosition).toBeLessThan(firstDdlPosition);
    expect(invariantPosition).toBeLessThan(backfillPosition);
  });

  it("enforces insert-only administrator audit at the database boundary", () => {
    const trigger = sqlBlock(
      /CREATE TRIGGER soko_bot_admin_action_append_only[\s\S]*?;/,
      "append-only audit trigger",
    );

    expect(trigger).toMatch(/BEFORE UPDATE OR DELETE OR TRUNCATE/);
    expect(trigger).toMatch(/FOR EACH STATEMENT/);
    expect(trigger).not.toMatch(/BEFORE[\s\S]*INSERT/);
    expect(migration).toMatch(
      /RAISE EXCEPTION 'soko_bot_admin_action is append-only; % is forbidden'/,
    );
  });

  it("projects legacy step count without persisting raw step payloads", () => {
    const table = sqlBlock(
      /CREATE TABLE "soko_bot_legacy_message" \([\s\S]*?\n\);/,
      "legacy message table",
    );
    const insert = sqlBlock(
      /INSERT INTO "soko_bot_legacy_message" \([\s\S]*?\)\nSELECT/,
      "legacy message insert projection",
    );

    expect(table).toContain('"stepCount" INTEGER NOT NULL DEFAULT 0');
    expect(table).not.toMatch(/"steps"\s+JSONB/);
    expect(table).not.toMatch(/reasoning/i);
    expect(insert).toContain('"stepCount"');
    expect(insert).not.toContain('"steps"');
    expect(migration).toContain('jsonb_array_length(message."steps")');
  });
});
