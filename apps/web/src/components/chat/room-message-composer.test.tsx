import { describe, expect, it } from "vitest";

import { ROOM_COMPOSER_TEXTAREA_CLASSNAME } from "./room-message-composer";

/**
 * True for `p-*`, `py-*`, `pt-*`, `pb-*` under any variant, bracketed ones
 * included. `p-*` counts: a variant that raises specificity, such as
 * `focus:p-4`, beats `py-*` and changes the box height.
 */
function isVerticalPadding(token: string): boolean {
  return /(?:^|:)!?p[ytb]?-/.test(token);
}

function verticalPadding(className: string): string[] {
  return className.split(/\s+/).filter(isVerticalPadding);
}

describe("ROOM_COMPOSER_TEXTAREA_CLASSNAME", () => {
  it("pads the editor symmetrically at each breakpoint, and nowhere else", () => {
    // 0.875rem * 2 + a 1.25rem line = 3rem below md.
    // 0.9375rem * 2 + a 1.125rem line = 3rem from md up.
    expect(verticalPadding(ROOM_COMPOSER_TEXTAREA_CLASSNAME)).toEqual([
      "py-3.5",
      "md:py-[0.9375rem]",
    ]);
  });

  it("keeps the empty box exactly one line tall", () => {
    expect(ROOM_COMPOSER_TEXTAREA_CLASSNAME).toContain("min-h-12");
  });

  it("survives the font-size merge with a line height of its own", () => {
    // withEditableTextSize appends the font size last, and tailwind-merge drops
    // any leading-* before it. These tokens reaching the merged string is the
    // proof they are appended after it, so the font size no longer sets the
    // line box the caret is drawn in.
    expect(ROOM_COMPOSER_TEXTAREA_CLASSNAME).toMatch(
      /(?:^|\s)leading-5(?=\s|$)/,
    );
    expect(ROOM_COMPOSER_TEXTAREA_CLASSNAME).toMatch(
      /(?:^|\s)md:leading-\[1\.125rem\](?=\s|$)/,
    );
  });
});
