import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const SRC_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../..",
);

function read(rel: string): string {
  return readFileSync(path.join(SRC_ROOT, rel), "utf8");
}

/**
 * A vertical divider between two columns is a border on one of them. It runs
 * the height of that column, so it reaches the panel's edges only when no
 * ancestor holds the vertical padding. The new-task wizard put `py-3` on the
 * modal body, and the rule stopped 12px short at the top and 12px short at the
 * bottom.
 *
 * Measured in a browser against these exact class strings: with the padding on
 * the body the divider was 228px inside a 252px panel; with it on the columns
 * the divider is 252px and both gaps are 0.
 *
 * Whether an ancestor holds vertical padding is not something a regex can
 * decide in general, so this does not try. It pins the mechanism for the one
 * panel that had the bug: the body gives its vertical padding up at `md`, and
 * the column that paints the divider takes it.
 */
const WIZARD_BODY = "flex min-h-0 flex-1 flex-col px-6 py-3 md:px-8 md:py-0";

describe("panel dividers span their panel", () => {
  it("keeps the wizard body free of vertical padding where the divider shows", () => {
    for (const file of [
      "app/(app)/tasks/components/create-task-modal.tsx",
      "app/(app)/tasks/components/task-form.tsx",
    ]) {
      expect(read(file)).toContain(WIZARD_BODY);
    }
  });

  it("puts that padding on the column that paints the divider", () => {
    const source = read("app/(app)/tasks/components/agent-spotlight.tsx");

    // Newlines are excluded so a match cannot run from one class string,
    // through a comment that names the class, and into the next string.
    const dividers = [...source.matchAll(/"[^"\n]*md:border-l[^"\n]*"/g)].map(
      ([match]) => match,
    );

    expect(dividers.length).toBeGreaterThan(0);
    for (const divider of dividers) {
      expect(divider).toContain("md:py-4");
      // md:pt-1 was the old value, and it left the rule short at both ends.
      expect(divider).not.toContain("md:pt-1");
    }
  });
});
