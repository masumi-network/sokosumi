import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import {
  literalGlob,
  parsePending,
  pendingProblems,
} from "./split-layout-pending";

const pending = new Map([["src/a.postgres.test.ts", 20]]);

describe("the split-layout pending list", () => {
  it("accepts a listed file that still fails", () => {
    expect(
      pendingProblems(
        [{ file: "src/a.postgres.test.ts", status: "failed" }],
        pending,
      ),
    ).toEqual([]);
  });

  it("fails a listed file that passes", () => {
    expect(
      pendingProblems(
        [{ file: "src/a.postgres.test.ts", status: "passed" }],
        pending,
      ),
    ).toEqual([
      "src/a.postgres.test.ts passes on the split layout: remove it from split-layout-pending.txt (ticket 20).",
    ]);
  });

  it("fails a listed file with any other status", () => {
    expect(
      pendingProblems(
        [{ file: "src/a.postgres.test.ts", status: "pending" }],
        pending,
      ),
    ).toEqual([
      'src/a.postgres.test.ts has the status "pending", neither failed nor passed.',
    ]);
  });

  it("fails a listed file that did not run", () => {
    expect(pendingProblems([], pending)).toEqual([
      "src/a.postgres.test.ts is listed (ticket 20) but did not run: remove or rename the entry.",
    ]);
  });

  it("fails a file in the pending run that is not listed", () => {
    expect(
      pendingProblems(
        [
          { file: "src/a.postgres.test.ts", status: "failed" },
          { file: "src/b.postgres.test.ts", status: "failed" },
        ],
        pending,
      ),
    ).toEqual([
      "src/b.postgres.test.ts ran in the pending run but is not listed.",
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

  it("escapes every glob character, so an entry matches only itself", () => {
    expect(literalGlob("src/routes/v1/tasks/[id]/get.postgres.test.ts")).toBe(
      "src/routes/v1/tasks/\\[id\\]/get.postgres.test.ts",
    );
  });

  it("lists only files under src/ that exist", () => {
    const core = fileURLToPath(new URL("../..", import.meta.url));
    const files = [
      ...parsePending(
        readFileSync(`${core}src/test/split-layout-pending.txt`, "utf8"),
      ).keys(),
    ];
    expect(
      files.filter(
        (file) => !file.startsWith("src/") || !existsSync(`${core}${file}`),
      ),
    ).toEqual([]);
  });
});
