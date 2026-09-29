import { describe, expect, it } from "vitest";

import {
  hasSocialPostTextStyle,
  toggleSocialPostTextStyle,
} from "./social-post-text-format";

describe("toggleSocialPostTextStyle", () => {
  it("bolds letters and digits and leaves the rest", () => {
    expect(toggleSocialPostTextStyle("Launch 2!", "bold")).toBe("𝗟𝗮𝘂𝗻𝗰𝗵 𝟮!");
  });

  it("italicizes letters and keeps digits plain", () => {
    expect(toggleSocialPostTextStyle("New 3", "italic")).toBe("𝘕𝘦𝘸 3");
  });

  it("underlines every visible character", () => {
    expect(toggleSocialPostTextStyle("Hi you", "underline")).toBe("H̲i̲ y̲o̲u̲");
  });

  it("turns a style off when it is already on", () => {
    for (const style of ["bold", "italic", "underline"] as const) {
      const styled = toggleSocialPostTextStyle("Ship it 7", style);
      expect(hasSocialPostTextStyle(styled, style)).toBe(true);
      expect(toggleSocialPostTextStyle(styled, style)).toBe("Ship it 7");
    }
  });

  it("swaps bold for italic rather than stacking them", () => {
    const bold = toggleSocialPostTextStyle("Go", "bold");
    expect(toggleSocialPostTextStyle(bold, "italic")).toBe("𝘎𝘰");
  });

  it("keeps underline when bolding underlined text", () => {
    const underlined = toggleSocialPostTextStyle("Go", "underline");
    expect(toggleSocialPostTextStyle(underlined, "bold")).toBe("𝗚̲𝗼̲");
  });

  it("reports no style on text without letters", () => {
    expect(hasSocialPostTextStyle("!!", "bold")).toBe(false);
    expect(hasSocialPostTextStyle("  ", "underline")).toBe(false);
  });
});
