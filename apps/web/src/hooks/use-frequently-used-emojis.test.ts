import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  recordEmojiUse,
  useFrequentlyUsedEmojis,
} from "./use-frequently-used-emojis";

const STORAGE_KEY = "sokosumi.emoji-picker.recent.v1";

describe("useFrequentlyUsedEmojis", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  afterEach(() => {
    window.localStorage.clear();
  });

  it("reads the stored history", () => {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(["🚀", "✅"]));

    const { result } = renderHook(() => useFrequentlyUsedEmojis());

    expect(result.current).toEqual(["🚀", "✅"]);
  });

  it("ignores a corrupt entry", () => {
    window.localStorage.setItem(STORAGE_KEY, "{not json");

    const { result } = renderHook(() => useFrequentlyUsedEmojis());

    expect(result.current).toEqual([]);
  });

  it("logs a use, persists it, and updates subscribers", () => {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(["🚀", "✅"]));
    const { result } = renderHook(() => useFrequentlyUsedEmojis());

    act(() => {
      recordEmojiUse("✅");
    });

    expect(result.current).toEqual(["✅", "🚀"]);
    expect(JSON.parse(window.localStorage.getItem(STORAGE_KEY) ?? "")).toEqual([
      "✅",
      "🚀",
      "✅",
    ]);
  });

  it("keeps an often-used emoji ahead of a one-off newer one", () => {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(["👍", "👍"]));
    const { result } = renderHook(() => useFrequentlyUsedEmojis());

    act(() => {
      recordEmojiUse("🦄");
    });

    expect(result.current).toEqual(["👍", "🦄"]);
  });

  it("follows picks made in another tab", () => {
    const { result } = renderHook(() => useFrequentlyUsedEmojis());

    act(() => {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(["🎉"]));
      window.dispatchEvent(new StorageEvent("storage", { key: STORAGE_KEY }));
    });

    expect(result.current).toEqual(["🎉"]);
  });
});
