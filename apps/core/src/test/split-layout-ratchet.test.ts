import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { parsePending, ratchetProblems } from "./split-layout-ratchet";

const pending = new Map([["src/a.postgres.test.ts", 20]]);

describe("the split-layout ratchet", () => {
  it("accepts a listed file that fails and an unlisted file that passes", () => {
    expect(
      ratchetProblems(
        [
          { file: "src/a.postgres.test.ts", failed: true },
          { file: "src/b.postgres.test.ts", failed: false },
        ],
        pending,
      ),
    ).toEqual([]);
  });

  it("fails an unlisted file that fails, a new file included", () => {
    expect(
      ratchetProblems(
        [
          { file: "src/a.postgres.test.ts", failed: true },
          { file: "src/new.postgres.test.ts", failed: true },
        ],
        pending,
      ),
    ).toEqual([
      "src/new.postgres.test.ts fails on the split layout. Fix it, or list it with the ticket that will.",
    ]);
  });

  it("fails a listed file that passes, so the list only shrinks", () => {
    expect(
      ratchetProblems(
        [{ file: "src/a.postgres.test.ts", failed: false }],
        pending,
      ),
    ).toEqual([
      "src/a.postgres.test.ts passes on the split layout: remove it from split-layout-pending.txt (ticket 20).",
    ]);
  });

  it("fails a listed file that did not run", () => {
    expect(ratchetProblems([], pending)).toEqual([
      "src/a.postgres.test.ts is listed (ticket 20) but did not run: remove or rename the entry.",
    ]);
  });

  it("reads one file and its ticket per line, with comments", () => {
    expect(
      parsePending(
        "# header\n\nsrc/a.postgres.test.ts 20  # why\nsrc/b.ts 17\n",
      ),
    ).toEqual(
      new Map([
        ["src/a.postgres.test.ts", 20],
        ["src/b.ts", 17],
      ]),
    );
  });

  it.each([
    ["src/a.postgres.test.ts", "line 1"],
    ["src/a.postgres.test.ts twenty", "line 1"],
    ["src/a.postgres.test.ts 20 21", "line 1"],
    ["src/a.ts 20\nsrc/a.ts 21", "twice"],
  ])("refuses the line %j", (text, message) => {
    expect(() => parsePending(text)).toThrow(message);
  });

  it("gives every entry of the real list a ticket", () => {
    const text = readFileSync(
      new URL("./split-layout-pending.txt", import.meta.url),
      "utf8",
    );
    expect(() => parsePending(text)).not.toThrow();
  });
});
