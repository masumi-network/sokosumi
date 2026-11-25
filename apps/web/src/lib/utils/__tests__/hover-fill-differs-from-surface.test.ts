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
 * An element that paints `bg-card-background` and hovers to
 * `hover:bg-card-background` hovers to its own colour, so nothing happens
 * under the pointer. The old agent cards had this on every size variant, which
 * left the whole gallery with no hover response; the Soko Bots "you" row had
 * it too. `--card-background-hover` is the step
 * that exists for this case.
 *
 * Whether an element sits on a card is not something a regex can decide.
 * A file-wide match is wrong in both directions: in a `cva` the resting fill
 * and the variant hover are separate strings, so a same-string rule misses
 * the agent cards entirely, while a same-file rule flags any file that draws
 * both a card and something sitting on it.
 *
 * So this pins the call sites that had the bug, the way
 * `panel-divider-spans-panel` pins the panel that had its own.
 */
const FIXED_SITES: ReadonlyArray<readonly [string, string]> = [
  ["components/agents/directory/agent-tile.tsx", "HOLDER_ITEM_HOVER_CLASS,"],
  [
    "components/notifications/notification-center-row.tsx",
    'className="hover:bg-accent -mx-1',
  ],
];

describe("hover fills differ from the surface they sit on", () => {
  it.each(FIXED_SITES)("%s keeps the hover step on %s", (file, expected) => {
    expect(read(file)).toContain(expected);
  });

  it("rests the Agents page tile on the page surface, not its hover fill", () => {
    // The tile rests on bg-background (HOLDER_ITEM_CLASS) and hovers to
    // bg-accent (HOLDER_ITEM_HOVER_CLASS); both must stay on it.
    expect(read("components/agents/directory/agent-tile.tsx")).toContain(
      "HOLDER_ITEM_CLASS,",
    );
  });
});
