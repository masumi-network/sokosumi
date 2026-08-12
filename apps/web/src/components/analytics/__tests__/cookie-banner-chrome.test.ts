import { describe, expect, it } from "vitest";

import { mainChromeLeftPx } from "@/components/analytics/cookie-banner";
import { MOBILE_BREAKPOINT } from "@/hooks/use-mobile";

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
