import { describe, expect, it } from "vitest";

import {
  studioAdBrief,
  studioAdCopyPrompts,
  studioAdVariationIndex,
} from "./studio-ad-prompts.js";

describe("Studio ad briefs", () => {
  it("recovers the same brief from every generated variation", () => {
    const brief = "Show a red shoe. Creative direction: spotlight";
    const copies = studioAdCopyPrompts(brief, 12, 4_000);

    expect(copies).toHaveLength(12);
    for (const [index, prompt] of copies.entries()) {
      expect(studioAdBrief(prompt)).toBe(brief);
      expect(studioAdVariationIndex(prompt)).toBe(index);
    }
  });

  it("keeps custom variation instructions and other user wording", () => {
    const prompt = "A shoe\n\nAd variation: make it blue";
    expect(studioAdBrief(prompt)).toBe(prompt);
    const [generated] = studioAdCopyPrompts("A shoe", 2, 4_000);
    const edited = `${generated}\nMake the logo larger`;
    expect(studioAdBrief(edited)).toBe(edited);
  });

  it("preserves the original brief when variations exceed the length limit", () => {
    const brief = "A shoe";
    expect(studioAdCopyPrompts(brief, 2, brief.length)).toEqual([brief, brief]);
    expect(studioAdBrief(brief)).toBe(brief);
  });
});
