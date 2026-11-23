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

// Every mention of search_path fails unless it is `SET LOCAL search_path`,
// which lasts one transaction. SQL comments count as whitespace. No file needs
// an exception today; add one here with its reason if one ever does.
const SEARCH_PATH = /search_path/gi;
const GAP = String.raw`(?:\s|/\*[\s\S]*?\*/|--[^\n]*\n)+`;
const SET_LOCAL_BEFORE = new RegExp(String.raw`\bSET${GAP}LOCAL${GAP}"?$`, "i");

function lineOf(text: string, offset: number): number {
  return text.slice(0, offset).split("\n").length;
}

function sessionSearchPathLines(text: string): number[] {
  return [...text.matchAll(SEARCH_PATH)]
    .filter(
      (match) =>
        !SET_LOCAL_BEFORE.test(
          text.slice(Math.max(0, match.index - 200), match.index),
        ),
    )
    .map((match) => lineOf(text, match.index));
}

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

describe("session state on the shared pool", () => {
  it.each([
    [
      "multi-line SET SESSION",
      "await prisma.$executeRawUnsafe(`SET SESSION\n  search_path TO x`);",
    ],
    [
      "quoted name",
      'await prisma.$executeRawUnsafe(`SET "search_path" TO x`);',
    ],
    [
      "multi-line set_config",
      "await prisma.$queryRaw`\n  SELECT set_config(\n    'search_path',\n    ${schema},\n    false\n  )\n`;",
    ],
    [
      "quote_ident",
      "SELECT set_config('search_path', quote_ident(${schema}), false)",
    ],
    [
      "parameterised false",
      "SELECT set_config('search_path', ${schema}, ${false})",
    ],
    [
      "parameterised flag",
      "SELECT set_config('search_path', ${schema}, ${isLocal})",
    ],
    ["text cast", "SELECT set_config('search_path'::text, 'x', false)"],
    [
      "comment between the words",
      "await prisma.$executeRawUnsafe(`SET /* why */ search_path TO x`);",
    ],
    [
      "set_config with true",
      "SELECT set_config(\n  'search_path',\n  quote_ident(${schema}),\n  TRUE\n)",
    ],
  ])("finds a session search_path written as %s", (_name, source) => {
    expect(sessionSearchPathLines(source)).toHaveLength(1);
  });

  it.each([
    [
      "SET LOCAL",
      'await tx.$executeRawUnsafe(`SET LOCAL "search_path" TO x`);',
    ],
    [
      "multi-line SET LOCAL",
      "await tx.$executeRawUnsafe(`SET\n  LOCAL search_path TO x`);",
    ],
    [
      "comments between the words",
      "await tx.$executeRawUnsafe(`SET /* why */ LOCAL -- note\n search_path TO x`);",
    ],
  ])("allows %s", (_name, source) => {
    expect(sessionSearchPathLines(source)).toEqual([]);
  });

  it("finds every search_path that is not SET LOCAL, with its line", () => {
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
    ).toEqual([2, 3, 4, 5]);
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
