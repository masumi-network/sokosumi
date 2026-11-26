import { describe, expect, it } from "vitest";

import { mainChromeLeftPx } from "@/hooks/effects/use-cookie-banner-chrome-left";
import { MOBILE_BREAKPOINT } from "@/hooks/effects/use-mobile";

describe("mainChromeLeftPx", () => {
  it("sits flush on mobile even when a sidebar gap exists", () => {
    expect(mainChromeLeftPx(MOBILE_BREAKPOINT - 1, 224)).toBe(0);
  });

  it("follows the desktop sidebar gap", () => {
    expect(mainChromeLeftPx(1280, 224)).toBe(224);
  });

  it("is viewport-wide on desktop routes with no sidebar", () => {
    expect(mainChromeLeftPx(1280, null)).toBe(0);
  });
});
