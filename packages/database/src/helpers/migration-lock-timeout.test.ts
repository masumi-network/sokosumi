import {
  mkdirSync,
  mkdtempDisposableSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";
import { findLockTimeoutViolations } from "./migration-lock-timeout.js";

const migrationsDir = join(import.meta.dirname, "../../prisma/migrations");
const alterTable = 'ALTER TABLE "example" ADD COLUMN "new" TEXT;';

function checkMigration(sql: string, name = "20261126114237_alter"): string[] {
  using dir = mkdtempDisposableSync(join(tmpdir(), "migration-lock-timeout-"));
  const folder = join(dir.path, name);
  mkdirSync(folder);
  writeFileSync(join(folder, "migration.sql"), sql);
  return findLockTimeoutViolations(dir.path);
}

it.each([
  ["without a lock timeout", "", 1],
  ["with a lock timeout", "SET lock_timeout = '5s';", 0],
  ["with an exception reason", "-- lock-timeout: not needed, validation", 0],
  ["with a blank exception reason", "-- lock-timeout: not needed, \t", 1],
])("checks a new ALTER TABLE %s", (_case, prefix, count) => {
  expect(checkMigration(`${prefix}\n${alterTable}`)).toHaveLength(count);
});

it("ignores migrations at or before the cutoff", () => {
  expect(checkMigration(alterTable, "20261126114235_older")).toEqual([]);
  expect(checkMigration(alterTable, "20261126114236_at_cutoff")).toEqual([]);
});

it("accepts a new migration without ALTER TABLE", () => {
  expect(checkMigration("SELECT 1;")).toEqual([]);
});

it("accepts the network column migration as an example for future migrations", () => {
  const sql = readFileSync(
    join(migrationsDir, "20261126114236_network_column/migration.sql"),
    "utf8",
  );
  expect(checkMigration(sql)).toEqual([]);
});

it("requires lock timeouts for new migrations in prisma/migrations", () => {
  const violations = findLockTimeoutViolations(migrationsDir);
  if (violations.length > 0) {
    throw new Error(violations.join("\n\n"));
  }
});
