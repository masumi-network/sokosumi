import { afterEach, describe, expect, it, vi } from "vitest";

import {
  buildMentionToken,
  getActiveEmojiTrigger,
  getActiveTrigger,
  getPopupPositionFromRect,
  POPUP_HEIGHT_PX,
  serializeEditorText,
  setEditorFromRaw,
} from "@/components/ui/mention-textarea-utils";

function stubViewport(height: number) {
  vi.stubGlobal("visualViewport", undefined);
  vi.stubGlobal("innerHeight", height);
  vi.stubGlobal("innerWidth", 1280);
}

function rectNearBottom(options: {
  top: number;
  bottom: number;
  left?: number;
}): DOMRect {
  const left = options.left ?? 80;
  return {
    x: left,
    y: options.top,
    top: options.top,
    bottom: options.bottom,
    left,
    right: left + 20,
    width: 20,
    height: options.bottom - options.top,
    toJSON() {
      return this;
    },
  };
}

describe("mention-textarea utils", () => {
  it("round-trips mention markup with friendly labels", () => {
    const root = document.createElement("div");
    const raw = "Hello @agent1:stock-photos-agent world";

    setEditorFromRaw(root, raw, (mentionKey, mentionSlug) => ({
      displayName: mentionKey === "agent1" ? "Stock Photos Agent" : mentionSlug,
      isKnown: mentionKey === "agent1",
    }));

    expect(serializeEditorText(root)).toBe(raw);
    const mentionSpan = root.querySelector(
      "span[data-mention-key]",
    ) as HTMLSpanElement | null;
    expect(mentionSpan?.textContent).toBe("@Stock Photos Agent");
  });

  it("round-trips newlines with mentions", () => {
    const root = document.createElement("div");
    const raw = "Hello\n@agent1:stock-photos-agent\nWorld";

    setEditorFromRaw(root, raw, (mentionKey, mentionSlug) => ({
      displayName: mentionKey === "agent1" ? "Stock Photos Agent" : mentionSlug,
      isKnown: mentionKey === "agent1",
    }));

    expect(serializeEditorText(root)).toBe(raw);
    expect(root.querySelectorAll("br")).toHaveLength(2);
  });

  it("adds a trailing space only when needed", () => {
    expect(buildMentionToken("agent", "slug", undefined)).toBe("@agent:slug ");
    expect(buildMentionToken("agent", "slug", " ")).toBe("@agent:slug");
    expect(buildMentionToken("agent", "slug", "\n")).toBe("@agent:slug");
    expect(buildMentionToken("agent", "slug", "x")).toBe("@agent:slug ");
  });

  it("does not activate trigger when caret is before @", () => {
    expect(getActiveTrigger("@writer", 0)).toBeNull();
  });

  it("does not activate trigger for serialized mention tokens", () => {
    const text = "@agent-1:writer-agent";
    expect(getActiveTrigger(text, text.length)).toBeNull();
  });

  it("activates trigger for in-progress mention queries", () => {
    expect(getActiveTrigger("Hello @wr", 9)).toEqual({
      query: "wr",
      triggerStart: 6,
    });
  });

  it("activates emoji trigger for in-progress shortcode queries", () => {
    expect(getActiveEmojiTrigger("Hello :gri", 10)).toEqual({
      query: "gri",
      triggerStart: 6,
    });
    expect(getActiveEmojiTrigger(":", 1)).toEqual({
      query: "",
      triggerStart: 0,
    });
  });

  it("does not activate emoji trigger on space, @, or mid-token colon", () => {
    expect(getActiveEmojiTrigger(":gri ", 5)).toBeNull();
    expect(getActiveEmojiTrigger(":@user", 6)).toBeNull();
    expect(getActiveEmojiTrigger(":smile:", 7)).toBeNull();
    expect(getActiveEmojiTrigger("a:smile", 7)).toBeNull();
  });

  it("keeps mention trigger rejecting queries that contain colon", () => {
    const text = "@agent-1:writer-agent";
    expect(getActiveTrigger(text, text.length)).toBeNull();
  });

  describe("getPopupPositionFromRect", () => {
    afterEach(() => {
      vi.unstubAllGlobals();
    });

    it("opens above when below cannot fit preferred height and above has more room", () => {
      stubViewport(800);
      const position = getPopupPositionFromRect(
        rectNearBottom({ top: 600, bottom: 620 }),
      );

      // belowSpace ≈ 172 (< 240 preferred), aboveSpace ≈ 592
      expect(position.side).toBe("top");
      expect(position.maxHeight).toBeGreaterThanOrEqual(80);
      expect(position.maxHeight).toBeLessThanOrEqual(POPUP_HEIGHT_PX);
    });

    it("stays below when there is room for the preferred height", () => {
      stubViewport(800);
      const position = getPopupPositionFromRect(
        rectNearBottom({ top: 200, bottom: 220 }),
      );

      expect(position.side).toBe("bottom");
    });
  });
});
