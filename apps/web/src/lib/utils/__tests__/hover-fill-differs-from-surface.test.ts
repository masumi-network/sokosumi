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
 * under the pointer. The agent cards had this on every size variant, which
 * left the whole gallery with no hover response; the project module tiles and
 * the Soko Bots "you" row had it too. `--card-background-hover` is the step
 * that exists for this case.
 *
 * Whether an element sits on a card is not something a regex can decide.
 * A file-wide match is wrong in both directions: in a `cva` the resting fill
 * and the variant hover are separate strings, so a same-string rule misses
 * the agent cards entirely, while a same-file rule flags
 * `project-module-tiles.tsx`, where the calendar tile paints no background of
 * its own and its `hover:bg-card-background` is a genuine lift off the page.
 *
 * So this pins the four call sites that had the bug, the way
 * `panel-divider-spans-panel` pins the panel that had its own.
 */
const FIXED_SITES: ReadonlyArray<readonly [string, string]> = [
  ["components/agents/agent-card.tsx", 'xs: "hover:bg-card-background-hover'],
  ["components/agents/agent-card.tsx", 'sm: "hover:bg-card-background-hover'],
  ["components/agents/agent-card.tsx", "md:hover:bg-card-background-hover"],
  [
    "app/(app)/projects/components/project-module-tiles.tsx",
    '? "hover:bg-card-background-hover transition-colors"',
  ],
  [
    "app/(app)/soko-bots/components/team-chart.tsx",
    'className="hover:bg-card-background-hover group',
  ],
  [
    "components/notifications/notification-center-row.tsx",
    'className="hover:bg-card-background-hover -mx-1',
  ],
];

describe("hover fills differ from the surface they sit on", () => {
  it.each(FIXED_SITES)("%s keeps the hover step on %s", (file, expected) => {
    expect(read(file)).toContain(expected);
  });

  it("leaves the agent card's resting fill as the card surface", () => {
    // The pairing is what matters: if this base ever stops being
    // bg-card-background, the hover step above is the wrong one.
    expect(read("components/agents/agent-card.tsx")).toContain(
      "shadow-none bg-card-background",
    );
  });

  it("keeps the lift on the module tile that paints no background", () => {
    // The calendar tile is transparent on the page, so card-background is a
    // real step up for it. Guards against a blanket rename of the token.
    expect(
      read("app/(app)/projects/components/project-module-tiles.tsx"),
    ).toContain("hover:border-primary-tertiary hover:bg-card-background ");
  });
});
