import { describe, expect, it } from "vitest";

import { ROOM_COMPOSER_TEXTAREA_CLASSNAME } from "./room-message-composer";

/** True for `py-*`, `pt-*`, `pb-*` under any variant, bracketed ones included. */
function isVerticalPadding(token: string): boolean {
  return /(?:^|:)!?p[ytb]-/.test(token);
}

function verticalPadding(className: string): string[] {
  return className.split(/\s+/).filter(isVerticalPadding);
}

describe("ROOM_COMPOSER_TEXTAREA_CLASSNAME", () => {
  it("pads the editor symmetrically at each breakpoint, and nowhere else", () => {
    // 0.75rem * 2 + a 1.5rem line = 3rem below md.
    // 0.875rem * 2 + a 1.25rem line = 3rem from md up.
    expect(verticalPadding(ROOM_COMPOSER_TEXTAREA_CLASSNAME)).toEqual([
      "py-3",
      "md:py-3.5",
    ]);
  });

  it("keeps the empty box exactly one line tall", () => {
    expect(ROOM_COMPOSER_TEXTAREA_CLASSNAME).toContain("min-h-12");
  });

  it("carries no leading-* that would survive the font-size merge", () => {
    // tailwind-merge drops a bare or `md:` leading-*, so those cannot reach the
    // DOM. One behind another variant does, and would change the line height
    // this padding is cut for.
    expect(ROOM_COMPOSER_TEXTAREA_CLASSNAME).not.toMatch(/(?:^|\s|:)leading-/);
  });
});
