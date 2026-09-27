import { readFileSync } from "node:fs";
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
});
