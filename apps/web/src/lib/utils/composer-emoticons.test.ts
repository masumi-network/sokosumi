import { describe, expect, it } from "vitest";

import { matchEmoticonClosedAtBoundary } from "@/lib/utils/composer-emoticons";

describe("matchEmoticonClosedAtBoundary", () => {
  it("converts :D before a trailing space", () => {
    const text = "hi :D ";
    const match = matchEmoticonClosedAtBoundary(text, text.length);
    expect(match).toEqual({
      start: 3,
      end: 5,
      emoji: "😄",
    });
  });

  it("converts wink before sentence punctuation", () => {
    const text = "wink ;).";
    const match = matchEmoticonClosedAtBoundary(text, text.length);
    expect(match).toEqual({
      start: 5,
      end: 7,
      emoji: "😉",
    });
  });

  it("prefers longest match :-)", () => {
    const text = ":-) ";
    const match = matchEmoticonClosedAtBoundary(text, text.length);
    expect(match).toEqual({
      start: 0,
      end: 3,
      emoji: "😃",
    });
  });

  it("returns null without a boundary (live mode)", () => {
    const text = ":D";
    expect(matchEmoticonClosedAtBoundary(text, text.length)).toBeNull();
    expect(matchEmoticonClosedAtBoundary(":Dfoo", 5)).toBeNull();
  });

  it("matches at end-of-input in flush mode", () => {
    const text = "ok :)";
    expect(
      matchEmoticonClosedAtBoundary(text, text.length, { flush: true }),
    ).toEqual({
      start: 3,
      end: 5,
      emoji: "😃",
    });
  });

  it("does not match mid-URL (left guard)", () => {
    const text = "http:// ";
    expect(matchEmoticonClosedAtBoundary(text, text.length)).toBeNull();
  });

  it("keeps boundary character outside [start, end)", () => {
    const text = ":D ";
    const match = matchEmoticonClosedAtBoundary(text, text.length);
    expect(match).not.toBeNull();
    expect(text.slice(match!.start, match!.end)).toBe(":D");
    expect(text[match!.end]).toBe(" ");
  });
});
