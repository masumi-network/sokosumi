import { globSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

/**
 * A backtick inside a template literal ends it.
 *
 * Two files in this feature embed a long program in a template literal:
 * the PDF child in `pdf.ts` and the raw SQL in
 * `services/file-related.service.ts`. Both are prose-commented, and a
 * comment that quotes an identifier the way the rest of this codebase
 * does — in backticks — terminates the literal. The file then fails to
 * parse, somewhere far from the edit, with a message about a missing
 * semicolon on a line that has nothing wrong with it.
 *
 * I did this four times while writing this branch. Twice it reached a
 * commit attempt and was caught by the pre-commit hook; once it produced
 * a vitest transform error that read as a test-collection failure. It is
 * not an interesting bug and it is not going to stop happening by being
 * careful, so it gets a check.
 *
 * Then I did it a sixth time, in `retrieval.ts`, which this guard did not
 * cover — because the two literals above are a hand-written list and the
 * list is exactly the thing that goes stale. So the list is no longer the
 * whole guard. The second check below scans every SQL comment line in the
 * feature, whatever file it is in: `--` only appears inside a SQL literal,
 * and quoting an identifier in backticks inside one is the specific
 * mistake, every time.
 *
 * Deliberately a whole-file scan for the delimiter rather than a parse:
 * the failure is that the file *cannot* be parsed, so a parser-based
 * check would have nothing to say.
 */

const EMBEDDED_LITERALS = [
  {
    file: "pdf.ts",
    opens: "const CHILD_PROGRAM = `",
    closes: "\n`;\n",
    what: "the PDF child program",
  },
  {
    file: "../../services/file-related.service.ts",
    opens: "PrismaRaw.sql`",
    closes: "\n    `,\n",
    what: "the related-documents SQL",
  },
];

/**
 * Where SQL lives. Both directories, because the queries are split
 * between the retrieval library and the services that own a table.
 */
const SQL_DIRECTORIES = ["../../lib/files", "../../services"];

function sqlCommentLines(): {
  file: string;
  line: number;
  text: string;
}[] {
  const found: { file: string; line: number; text: string }[] = [];
  for (const directory of SQL_DIRECTORIES) {
    const root = fileURLToPath(new URL(directory, import.meta.url));
    for (const entry of globSync("**/*.ts", { cwd: root })) {
      if (entry.includes(".test.")) continue;
      const source = readFileSync(path.join(root, entry), "utf8");
      source.split("\n").forEach((text, index) => {
        // A SQL line comment. It cannot occur outside a SQL literal:
        // TypeScript has no `--` comment, and a decrement operator is
        // never at the start of a line in formatted code.
        if (/^\s*--/.test(text)) {
          found.push({ file: `${directory}/${entry}`, line: index + 1, text });
        }
      });
    }
  }
  return found;
}

describe("embedded programs contain no backticks", () => {
  it.each(EMBEDDED_LITERALS)("$what", ({ file, opens, closes }) => {
    const source = readFileSync(
      fileURLToPath(new URL(file, import.meta.url)),
      "utf8",
    );

    const start = source.indexOf(opens);
    expect(
      start,
      `${opens} is no longer in this file; update this guard rather than ` +
        `deleting it`,
    ).toBeGreaterThan(-1);

    const from = start + opens.length;
    const end = source.indexOf(closes, from);
    expect(end, "could not find the end of the literal").toBeGreaterThan(from);

    const body = source.slice(from, end);
    const at = body.indexOf("`");
    expect(
      at,
      at === -1
        ? ""
        : `a backtick at offset ${at} ends the template literal early: ` +
            `...${body.slice(Math.max(0, at - 60), at + 20)}...`,
    ).toBe(-1);
  });

  it("no SQL comment anywhere in the feature quotes with a backtick", () => {
    const lines = sqlCommentLines();

    // The guard has to be scanning something, or it passes by finding
    // nothing. These files are full of commented SQL.
    expect(
      lines.length,
      "no SQL comment lines were found at all, so this guard is inspecting " +
        "nothing — check SQL_DIRECTORIES before deleting it",
    ).toBeGreaterThan(20);

    const offenders = lines.filter((entry) => entry.text.includes("`"));
    expect(
      offenders.map((entry) => `${entry.file}:${entry.line}${entry.text}`),
      "a backtick in a SQL comment ends the template literal it sits in, " +
        "and the file then fails to parse somewhere else entirely",
    ).toEqual([]);
  });
});
