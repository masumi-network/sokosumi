import { describe, expect, it } from "vitest";

import {
  getJumboEmojiCount,
  jumboEmojiClassName,
  MAX_JUMBO_EMOJI_COUNT,
} from "../jumbo-emoji";

describe("getJumboEmojiCount", () => {
  it("returns 1 for a single emoji", () => {
    expect(getJumboEmojiCount("👍")).toBe(1);
  });

  it("ignores surrounding whitespace", () => {
    expect(getJumboEmojiCount("  🎉  \n")).toBe(1);
  });

  it("counts multiple emoji separated by spaces", () => {
    expect(getJumboEmojiCount("👍 ❤️ 😂")).toBe(3);
  });

  it("counts adjacent emoji without spaces", () => {
    expect(getJumboEmojiCount("👍❤️😂")).toBe(3);
  });

  it("treats ZWJ sequences as one emoji", () => {
    expect(getJumboEmojiCount("👨‍👩‍👧‍👦")).toBe(1);
    expect(getJumboEmojiCount("🏳️‍🌈")).toBe(1);
  });

  it("treats skin-tone modifiers as one emoji", () => {
    expect(getJumboEmojiCount("👋🏿")).toBe(1);
  });

  it("treats regional-indicator flags as one emoji", () => {
    expect(getJumboEmojiCount("🇩🇪")).toBe(1);
  });

  it("treats keycap digits as one emoji", () => {
    expect(getJumboEmojiCount("1️⃣")).toBe(1);
  });

  it("returns null for mixed text and emoji", () => {
    expect(getJumboEmojiCount("foobar 👍")).toBeNull();
    expect(getJumboEmojiCount("👍 yes")).toBeNull();
  });

  it("returns null for plain text", () => {
    expect(getJumboEmojiCount("hello")).toBeNull();
  });

  it("returns null for empty / whitespace-only content", () => {
    expect(getJumboEmojiCount("")).toBeNull();
    expect(getJumboEmojiCount("   \n")).toBeNull();
  });

  it(`allows up to ${MAX_JUMBO_EMOJI_COUNT} emoji`, () => {
    const emoji = "👍".repeat(MAX_JUMBO_EMOJI_COUNT);
    expect(getJumboEmojiCount(emoji)).toBe(MAX_JUMBO_EMOJI_COUNT);
  });

  it(`returns null for ${MAX_JUMBO_EMOJI_COUNT + 1}+ emoji`, () => {
    const emoji = "👍".repeat(MAX_JUMBO_EMOJI_COUNT + 1);
    expect(getJumboEmojiCount(emoji)).toBeNull();
  });

  it("returns null when markdown/link syntax is present", () => {
    expect(getJumboEmojiCount("[👍](https://example.com)")).toBeNull();
    expect(getJumboEmojiCount("**👍**")).toBeNull();
  });
});

describe("jumboEmojiClassName", () => {
  it("scales down as count grows", () => {
    expect(jumboEmojiClassName(1)).toContain("text-5xl");
    expect(jumboEmojiClassName(3)).toContain("text-4xl");
    expect(jumboEmojiClassName(6)).toContain("text-3xl");
    expect(jumboEmojiClassName(10)).toContain("text-2xl");
  });
});
