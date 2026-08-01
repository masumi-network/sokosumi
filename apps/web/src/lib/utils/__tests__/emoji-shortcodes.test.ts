import { describe, expect, it } from "vitest";

import {
  filterEmojiShortcodes,
  listEmojiCategories,
  listEmojisByCategory,
  matchExactEmojiShortcodeClosed,
  recordFrequentlyUsedEmoji,
  searchEmojiCatalog,
} from "@/lib/utils/emoji-shortcodes";

describe("filterEmojiShortcodes", () => {
  it("returns stable alphabetical top-N for empty query", () => {
    const results = filterEmojiShortcodes("", 5);
    expect(results).toHaveLength(5);
    const names = results.map((row) => row.name);
    expect(names).toEqual([...names].toSorted((a, b) => a.localeCompare(b)));
    expect(results.every((row) => row.emoji.length > 0)).toBe(true);
  });

  it("prefers prefix matches before includes and caps results", () => {
    const results = filterEmojiShortcodes("thumb", 20);
    expect(results.length).toBeGreaterThan(0);
    expect(results.length).toBeLessThanOrEqual(20);

    const firstNonPrefix = results.findIndex(
      (row) => !row.name.startsWith("thumb"),
    );
    if (firstNonPrefix >= 0) {
      expect(
        results
          .slice(0, firstNonPrefix)
          .every((row) => row.name.startsWith("thumb")),
      ).toBe(true);
      expect(
        results
          .slice(firstNonPrefix)
          .every((row) => row.name.includes("thumb")),
      ).toBe(true);
    } else {
      expect(results.every((row) => row.name.startsWith("thumb"))).toBe(true);
    }
  });

  it("matches known shortcodes like smile", () => {
    const results = filterEmojiShortcodes("smile", 20);
    const smile = results.find((row) => row.name === "smile");
    expect(smile?.emoji).toBeTruthy();
  });

  it("respects an explicit cap", () => {
    expect(filterEmojiShortcodes("", 3)).toHaveLength(3);
    expect(filterEmojiShortcodes("a", 2).length).toBeLessThanOrEqual(2);
  });
});

describe("matchExactEmojiShortcodeClosed", () => {
  it("returns unicode for exact :name: at caret", () => {
    const text = "hi :smile:";
    expect(matchExactEmojiShortcodeClosed(text, text.length)).toEqual({
      triggerStart: 3,
      end: text.length,
      emoji: expect.any(String),
    });
    expect(
      matchExactEmojiShortcodeClosed(text, text.length)?.emoji,
    ).toBeTruthy();
  });

  it("returns null for unknown or incomplete shortcodes", () => {
    expect(
      matchExactEmojiShortcodeClosed(":not_a_real_emoji_xyz:", 22),
    ).toBeNull();
    expect(matchExactEmojiShortcodeClosed(":smile", 6)).toBeNull();
    expect(matchExactEmojiShortcodeClosed("smile:", 6)).toBeNull();
  });
});

describe("emoji catalog categories", () => {
  it("lists gemoji's 9 categories in order", () => {
    const categories = listEmojiCategories();
    expect(categories).toHaveLength(9);
    expect(categories.map((category) => category.id)).toEqual([
      "smileys-emotion",
      "people-body",
      "animals-nature",
      "food-drink",
      "travel-places",
      "activities",
      "objects",
      "symbols",
      "flags",
    ]);
    expect(categories.every((category) => category.navEmoji.length > 0)).toBe(
      true,
    );
    expect(categories.every((category) => category.messageKey.length > 0)).toBe(
      true,
    );
  });

  it("returns smileys for smileys-emotion", () => {
    const smileys = listEmojisByCategory("smileys-emotion");
    expect(smileys.length).toBeGreaterThan(0);
    expect(
      smileys.every((entry) => entry.categoryId === "smileys-emotion"),
    ).toBe(true);
  });
});

describe("searchEmojiCatalog", () => {
  it("finds smile by name and grinning by tag", () => {
    const results = searchEmojiCatalog("smile", { cap: 40 });
    expect(results.some((entry) => entry.names.includes("smile"))).toBe(true);
    expect(results.some((entry) => entry.names.includes("grinning"))).toBe(
      true,
    );
  });

  it("finds thumbsup by alias name", () => {
    const results = searchEmojiCatalog("thumbsup", { cap: 20 });
    const thumbs = results.find((entry) => entry.names.includes("thumbsup"));
    expect(thumbs?.emoji).toBe("👍");
  });

  it("returns alphabetical slice for empty query", () => {
    const results = searchEmojiCatalog("", { cap: 5 });
    expect(results).toHaveLength(5);
    const primaryNames = results.map((entry) => entry.names[0] ?? "");
    expect(primaryNames).toEqual(
      [...primaryNames].toSorted((a, b) => a.localeCompare(b)),
    );
  });
});

describe("recordFrequentlyUsedEmoji", () => {
  it("prepends MRU, dedupes, and caps", () => {
    expect(recordFrequentlyUsedEmoji(["😀", "🎉"], "👍", 24)).toEqual([
      "👍",
      "😀",
      "🎉",
    ]);
    expect(recordFrequentlyUsedEmoji(["😀", "👍", "🎉"], "👍", 24)).toEqual([
      "👍",
      "😀",
      "🎉",
    ]);
    expect(recordFrequentlyUsedEmoji(["😀", "🎉", "🔥"], "👍", 3)).toEqual([
      "👍",
      "😀",
      "🎉",
    ]);
  });
});
