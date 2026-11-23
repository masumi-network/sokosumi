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

// `SET search_path` or `SET SESSION search_path`, and `set_config` with
// is_local false. `SET LOCAL` and `set_config(…, true)` stay allowed.
const SESSION_SEARCH_PATH =
  /\bSET\s+(?:SESSION\s+)?search_path\b|set_config\(\s*'search_path'[^)]*,\s*false\s*\)/i;

function sourceFiles(directory: string): string[] {
  return readdirSync(join(ROOT, directory), {
    recursive: true,
    withFileTypes: true,
  })
    .filter((entry) => entry.isFile() && /\.[cm]?ts$/.test(entry.name))
    .map((entry) => join(entry.parentPath, entry.name))
    .filter(
      (file) =>
        !file.includes("/generated/") &&
        file !== fileURLToPath(import.meta.url),
    );
}

function sessionSearchPathLines(text: string): number[] {
  return text
    .split("\n")
    .flatMap((line, index) =>
      SESSION_SEARCH_PATH.test(line) ? [index + 1] : [],
    );
}

describe("session state on the shared pool", () => {
  it("finds a plain or session SET search_path, and lets SET LOCAL pass", () => {
    expect(
      sessionSearchPathLines(
        [
          'await tx.$executeRawUnsafe(`SET LOCAL search_path TO "x"`);',
          "await prisma.$executeRawUnsafe(`SET search_path TO x`);",
          "await prisma.$executeRawUnsafe(`set session search_path = x`);",
          "SELECT set_config('search_path', 'x', false)",
          "SELECT set_config('search_path', 'x', true)",
        ].join("\n"),
      ),
    ).toEqual([2, 3, 4]);
  });

  it("never sets search_path for the session: the three clients share connections", () => {
    const found = DIRECTORIES.flatMap(sourceFiles).flatMap((file) =>
      sessionSearchPathLines(readFileSync(file, "utf8")).map(
        (line) => `${relative(ROOT, file)}:${line}`,
      ),
    );
    expect(found, "Use SET LOCAL inside a transaction.").toEqual([]);
  });
});
