import { describe, expect, it } from "vitest";

import { contrastOf, GLOBALS_CSS, THEMES } from "@/test/theme-tokens";

/**
 * The Masumi Family guide (5.2) fixes the palette; 5.11 fixes the floors. Where
 * the guide's own role table misses a floor, `globals.css` takes the nearest
 * neutral step that clears it, and this pins the pair rather than the value.
 */
const TEXT = 4.5;
const NON_TEXT = 3;

/** [foreground, background, floor]. Each pair is one the app renders. */
const PAIRS: [string, string, number][] = [
  ["foreground", "background", TEXT],
  ["foreground", "card-background", TEXT],
  ["muted-foreground", "background", TEXT],
  ["muted-foreground", "card-background", TEXT],
  ["muted-foreground", "muted", TEXT],
  ["muted-foreground", "quinary", TEXT],
  ["muted-foreground", "quaternary", TEXT],
  ["primary-foreground", "primary", TEXT],
  ["secondary-foreground", "secondary", TEXT],
  ["background-muted", "foreground", TEXT],
  ["input", "background", NON_TEXT],
  ["ring", "background", NON_TEXT],
];

describe("token contrast", () => {
  for (const [theme, block] of Object.entries(THEMES)) {
    it.each(PAIRS)(
      `${theme}: --%s on --%s clears its floor`,
      (fg, bg, floor) => {
        expect(contrastOf(block, fg, bg)).toBeGreaterThanOrEqual(floor);
      },
    );

    it(`${theme}: the primary is Iris Flower`, () => {
      // Guide 5.2: Iris stays the same in light and dark.
      expect(block).toMatch(/--primary:\s*#ff51ff;/i);
    });
  }

  it("keeps the retired info ramp retired", () => {
    // Every consumer of --semantic-info meant "in flight", never
    // "information". Reintroducing it recreates the duplicate role.
    expect(GLOBALS_CSS).not.toMatch(/--semantic-info(-[a-z]+)?:/);
    expect(GLOBALS_CSS).not.toContain("--color-semantic-info");
  });
});
