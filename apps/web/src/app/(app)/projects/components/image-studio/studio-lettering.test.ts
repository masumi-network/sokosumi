import { describe, expect, it } from "vitest";

import { usesExactFontOverlay } from "./studio-lettering";

const backdrop = { id: "backdrop", lettering: "ideogram" as const };

describe("usesExactFontOverlay", () => {
  it("uses the exact font only as a fallback when Ideogram lettering fails", () => {
    expect(usesExactFontOverlay({ id: "a", lettering: "overlay" })).toBe(true);
    expect(usesExactFontOverlay(backdrop)).toBe(false);
    expect(
      usesExactFontOverlay(backdrop, [
        {
          parentAssetId: "backdrop",
          lettering: "ideogram",
          status: "RUNNING",
        },
      ]),
    ).toBe(false);
    expect(
      usesExactFontOverlay(backdrop, [
        {
          parentAssetId: "backdrop",
          lettering: "ideogram",
          status: "FAILED",
        },
      ]),
    ).toBe(true);
  });
});
