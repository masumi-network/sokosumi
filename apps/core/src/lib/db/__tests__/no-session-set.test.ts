import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const ROOT = fileURLToPath(new URL("../../../../../..", import.meta.url));
const DIRECTORIES = [
  "apps/core/src",
  "packages/database/src",
  "packages/database/scripts",
];

// The three clients share connections, so a search_path set on one is seen by
// the others. Production SQL never touches it; it names schemas instead.
// A file that must mention it goes here, with its reason.
const ALLOWED: Record<string, string> = {};

function mentionsSearchPath(text: string): boolean {
  return /search_path/i.test(text);
}

function productionFiles(directory: string): string[] {
  return readdirSync(join(ROOT, directory), {
    recursive: true,
    withFileTypes: true,
  })
    .filter((entry) => entry.isFile() && /\.[cm]?ts$/.test(entry.name))
    .map((entry) => relative(ROOT, join(entry.parentPath, entry.name)))
    .filter(
      (file) =>
        !/\.test\.[cm]?ts$/.test(file) &&
        !file.includes("/__tests__/") &&
        !file.includes("/generated/"),
    );
}

describe("search_path on the shared pool", () => {
  it.each([
    "await tx.$executeRawUnsafe(`SET LOCAL search_path TO x`);",
    "SELECT set_config('SEARCH_PATH', 'x', true)",
    "// search_path",
  ])("finds a mention: %s", (source) => {
    expect(mentionsSearchPath(source)).toBe(true);
  });

  it("passes a file that names its schemas", () => {
    expect(mentionsSearchPath('SELECT key FROM "mainnet"."Lock"')).toBe(false);
  });

  it("is never mentioned in production code of Core or the database package", () => {
    const found = DIRECTORIES.flatMap(productionFiles).filter(
      (file) =>
        !(file in ALLOWED) &&
        mentionsSearchPath(readFileSync(join(ROOT, file), "utf8")),
    );
    expect(found, "Name the schema in the SQL instead.").toEqual([]);
  });
});
