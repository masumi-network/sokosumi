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

// `SET [SESSION] search_path`, its name quoted or not, across lines.
// `SET LOCAL` does not match.
const SESSION_SET = /\bSET\s+(?:SESSION\s+)?"?search_path\b/gi;
const SET_CONFIG = /\bset_config\s*\(/gi;

/** The top-level arguments of the call whose `(` ends at `open`. */
function callArguments(text: string, open: number): string[] {
  const args: string[] = [];
  let depth = 0;
  let quote: string | null = null;
  let current = "";
  for (let index = open; index < text.length; index++) {
    const char = text[index];
    if (quote) {
      if (char === quote) quote = null;
    } else if (char === "'" || char === '"') {
      quote = char;
    } else if ("({[".includes(char)) {
      depth++;
    } else if (")}]".includes(char)) {
      depth--;
      if (depth === 0) return [...args, current.trim()];
    } else if (char === "," && depth === 1) {
      args.push(current.trim());
      current = "";
      continue;
    }
    if (index !== open) current += char;
  }
  return [...args, current.trim()];
}

function lineOf(text: string, offset: number): number {
  return text.slice(0, offset).split("\n").length;
}

/**
 * Lines that set search_path for the session. `set_config('search_path', …)`
 * passes only with a literal `true`, which makes it last one transaction.
 */
function sessionSearchPathLines(text: string): number[] {
  const offsets = [...text.matchAll(SESSION_SET)].map((match) => match.index);
  for (const match of text.matchAll(SET_CONFIG)) {
    const [name, , isLocal] = callArguments(
      text,
      match.index + match[0].length - 1,
    );
    if (
      /^['"]search_path['"]$/i.test(name ?? "") &&
      !/^true$/i.test(isLocal ?? "")
    ) {
      offsets.push(match.index);
    }
  }
  return offsets.sort((a, b) => a - b).map((offset) => lineOf(text, offset));
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
      "set_config with true",
      "SELECT set_config(\n  'search_path',\n  quote_ident(${schema}),\n  TRUE\n)",
    ],
  ])("allows %s", (_name, source) => {
    expect(sessionSearchPathLines(source)).toEqual([]);
  });

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
