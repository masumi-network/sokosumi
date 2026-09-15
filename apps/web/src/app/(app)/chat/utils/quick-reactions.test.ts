import { describe, expect, it } from "vitest";

import {
  DEFAULT_QUICK_REACTIONS,
  resolveQuickReactions,
} from "./quick-reactions";

describe("resolveQuickReactions", () => {
  it("falls back to the defaults when nothing was used yet", () => {
    expect(resolveQuickReactions([], 3)).toEqual(["👍", "❤️", "😂"]);
    expect(resolveQuickReactions([], 5)).toEqual([...DEFAULT_QUICK_REACTIONS]);
  });

  it("leads with the frequently used emojis in their ranked order", () => {
    expect(resolveQuickReactions(["🚀", "✅", "🙌", "🔥"], 3)).toEqual([
      "🚀",
      "✅",
      "🙌",
    ]);
  });

  it("pads short histories with defaults it does not already show", () => {
    expect(resolveQuickReactions(["❤️", "🚀"], 5)).toEqual([
      "❤️",
      "🚀",
      "👍",
      "😂",
      "🎉",
    ]);
  });
});
