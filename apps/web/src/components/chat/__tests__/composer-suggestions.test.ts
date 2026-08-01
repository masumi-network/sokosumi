import { describe, expect, it } from "vitest";

import { resolveComposerSuggestion } from "@/components/chat/composer-suggestions";

describe("resolveComposerSuggestion", () => {
  it("prefers mention when @ trigger is active", () => {
    expect(
      resolveComposerSuggestion("Hello @wr", 9, { mentionsAvailable: true }),
    ).toEqual({
      kind: "mention",
      query: "wr",
      triggerStart: 6,
    });
  });

  it("does not treat serialized mention tokens as mention or emoji", () => {
    const text = "@agent-id:slug ";
    expect(
      resolveComposerSuggestion(text, text.length, { mentionsAvailable: true }),
    ).toBeNull();
  });

  it("resolves emoji shortcode when mentions unavailable", () => {
    const result = resolveComposerSuggestion("hi :smi", 7, {
      mentionsAvailable: false,
    });
    expect(result?.kind).toBe("emoji");
    if (result?.kind === "emoji") {
      expect(result.query).toBe("smi");
      expect(result.triggerStart).toBe(3);
      expect(result.matches.length).toBeGreaterThan(0);
      expect(result.matches.length).toBeLessThanOrEqual(20);
    }
  });

  it("resolves emoji shortcode when mention catalog exists but caret is on :", () => {
    const result = resolveComposerSuggestion("hi :smi", 7, {
      mentionsAvailable: true,
    });
    expect(result?.kind).toBe("emoji");
    if (result?.kind === "emoji") {
      expect(result.query).toBe("smi");
      expect(result.matches.some((match) => match.name.includes("smi"))).toBe(
        true,
      );
    }
  });

  it("resolves bare colon to capped emoji list", () => {
    const result = resolveComposerSuggestion(":", 1, {
      mentionsAvailable: false,
    });
    expect(result?.kind).toBe("emoji");
    if (result?.kind === "emoji") {
      expect(result.query).toBe("");
      expect(result.matches.length).toBeGreaterThan(0);
      expect(result.matches.length).toBeLessThanOrEqual(20);
    }
  });

  it("skips mention branch when mentionsAvailable is false", () => {
    expect(
      resolveComposerSuggestion("@al", 3, { mentionsAvailable: false }),
    ).toBeNull();
  });
});
