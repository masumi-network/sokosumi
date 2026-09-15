import { describe, expect, it } from "vitest";

import {
  appendEmojiUse,
  filterEmojiShortcodes,
  getEmojiShortcodeName,
  listEmojiCategories,
  listEmojisByCategory,
  matchExactEmojiShortcodeClosed,
  rankFrequentlyUsedEmojis,
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

  it("returns alphabetical slice for empty query when capped", () => {
    const results = searchEmojiCatalog("", { cap: 5 });
    expect(results).toHaveLength(5);
    const primaryNames = results.map((entry) => entry.names[0] ?? "");
    expect(primaryNames).toEqual(
      [...primaryNames].toSorted((a, b) => a.localeCompare(b)),
    );
  });

  it("returns all ranked matches when cap is omitted", () => {
    const capped = searchEmojiCatalog("a", { cap: 5 });
    const uncapped = searchEmojiCatalog("a");
    expect(capped.length).toBeLessThanOrEqual(5);
    expect(uncapped.length).toBeGreaterThan(capped.length);
    expect(uncapped.slice(0, capped.length)).toEqual(capped);
  });
});

describe("appendEmojiUse", () => {
  it("prepends each use, keeps repeats, and caps the log", () => {
    expect(appendEmojiUse(["😀", "👍"], "👍", 50)).toEqual(["👍", "😀", "👍"]);
    expect(appendEmojiUse(["😀", "🎉", "🔥"], "👍", 3)).toEqual([
      "👍",
      "😀",
      "🎉",
    ]);
  });
});

describe("rankFrequentlyUsedEmojis", () => {
  it("ranks the most used first", () => {
    expect(
      rankFrequentlyUsedEmojis(["🦄", "👍", "🎉", "👍", "🎉", "👍"]),
    ).toEqual(["👍", "🎉", "🦄"]);
  });

  it("breaks a tie in favour of the most recent use", () => {
    expect(rankFrequentlyUsedEmojis(["🦄", "🎉", "👍", "🎉", "👍"])).toEqual([
      "🎉",
      "👍",
      "🦄",
    ]);
  });

  it("caps the ranked list", () => {
    expect(rankFrequentlyUsedEmojis(["🦄", "👍", "🎉"], 2)).toEqual([
      "🦄",
      "👍",
    ]);
  });
});

describe("getEmojiShortcodeName", () => {
  it("returns the primary shortcode name for a catalog emoji", () => {
    expect(getEmojiShortcodeName("😂")).toBe("joy");
    expect(getEmojiShortcodeName("❤️")).toBe("heart");
  });

  it("returns null for a glyph outside the catalog", () => {
    expect(getEmojiShortcodeName("not-an-emoji")).toBeNull();
  });
});
