import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { expect } from "vitest";

/**
 * Shared fixtures for the schema/migration guard suites in this directory.
 * Deliberately NOT a `*.test.ts` file, so vitest's include skips it.
 *
 * The schema read is hoisted to module scope: the file is immutable for the
 * lifetime of a test run and nearly every guard reads it, so per-test rereads
 * only add I/O.
 */
export const packageRoot = join(
  dirname(fileURLToPath(import.meta.url)),
  "../../..",
);
export const schemaPath = join(packageRoot, "prisma/schema.prisma");
export const migrationsRoot = join(packageRoot, "prisma/migrations");

export const schema = readFileSync(schemaPath, "utf8");

/** The `migration.sql` of one migration directory, by its full name. */
export function readMigrationSql(migrationName: string): string {
  return readFileSync(
    join(migrationsRoot, migrationName, "migration.sql"),
    "utf8",
  );
}

/** Every migration's SQL, in name (= timestamp) order. */
export function listMigrationSql(): Array<{ name: string; sql: string }> {
  return readdirSync(migrationsRoot)
    .filter((name) => /^\d{14}_.+/.test(name))
    .sort()
    .map((name) => ({ name, sql: readMigrationSql(name) }));
}

/** The body of `model <name> { … }` in schema.prisma. */
export function modelBlock(modelName: string): string {
  const match = schema.match(
    new RegExp(`model ${modelName}\\s*\\{([\\s\\S]*?)\\n\\}`),
  );
  expect(match, `model ${modelName} in schema.prisma`).toBeTruthy();
  return match?.[1] ?? "";
}
