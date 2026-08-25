import { afterEach, describe, expect, it, vi } from "vitest";

import {
  buildMentionToken,
  filterNormalizedMentions,
  getActiveChannelTrigger,
  getActiveEmojiTrigger,
  getActiveTrigger,
  getCaretOffset,
  getCaretRect,
  getMentionPopupPositionFromAnchorRect,
  getPopupPositionFromRect,
  getSuggestionPopupFixedStyle,
  MENTION_ANCHOR_SCROLL_MARGIN_TOP_PX,
  MENTION_COMPOSER_GAP_PX,
  type NormalizedMention,
  POPUP_HEIGHT_PX,
  POPUP_MIN_HEIGHT_PX,
  serializeEditorText,
  setEditorFromRaw,
  VIEWPORT_PADDING_PX,
} from "@/components/ui/mention-textarea-utils";

/** Firefox WebIDL: Node.contains throws when the arg is not a Node. */
function installFirefoxContainsGuard(): () => void {
  const original = Node.prototype.contains;
  Node.prototype.contains = function contains(other: Node | null): boolean {
    if (other != null && !(other instanceof Node)) {
      throw new TypeError(
        "Node.contains: Argument 1 does not implement interface Node.",
      );
    }
    return original.call(this, other);
  };
  return () => {
    Node.prototype.contains = original;
  };
}

function stubSelectionRange(endContainer: unknown, endOffset = 0): () => void {
  const range = {
    endContainer,
    endOffset,
    getBoundingClientRect: () => new DOMRect(0, 0, 0, 0),
    cloneRange: () => range,
    collapse: () => undefined,
    insertNode: () => undefined,
  };
  const selection = {
    rangeCount: 1,
    getRangeAt: () => range,
    removeAllRanges: () => undefined,
    addRange: () => undefined,
  } as unknown as Selection;
  const spy = vi.spyOn(window, "getSelection").mockReturnValue(selection);
  return () => {
    spy.mockRestore();
  };
}

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
  afterEach(() => {
    document.body.replaceChildren();
  });

  it("sizes scroll margin to preferred picker height plus composer gap", () => {
    expect(MENTION_ANCHOR_SCROLL_MARGIN_TOP_PX).toBe(
      POPUP_HEIGHT_PX + MENTION_COMPOSER_GAP_PX + VIEWPORT_PADDING_PX,
    );
  });

  it("getCaretOffset returns null when selection endContainer is not a Node (Firefox)", () => {
    const restoreContains = installFirefoxContainsGuard();
    const restoreSelection = stubSelectionRange({});
    const root = document.createElement("div");
    root.textContent = "hello";
    document.body.append(root);

    try {
      expect(getCaretOffset(root)).toBeNull();
    } finally {
      restoreSelection();
      restoreContains();
    }
  });

  it("getCaretRect returns null when selection endContainer is not a Node (Firefox)", () => {
    const restoreContains = installFirefoxContainsGuard();
    const restoreSelection = stubSelectionRange({});
    const root = document.createElement("div");
    root.textContent = "hello";
    document.body.append(root);

    try {
      expect(getCaretRect(root)).toBeNull();
    } finally {
      restoreSelection();
      restoreContains();
    }
  });

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

  it("activates channel trigger for in-progress # queries including empty", () => {
    expect(getActiveChannelTrigger("Hello #lau", 10)).toEqual({
      query: "lau",
      triggerStart: 6,
    });
    expect(getActiveChannelTrigger("#", 1)).toEqual({
      query: "",
      triggerStart: 0,
    });
  });

  it("does not activate channel trigger for headings, hash runs, or mid-token", () => {
    expect(getActiveChannelTrigger("# general", 9)).toBeNull();
    expect(getActiveChannelTrigger("##gen", 5)).toBeNull();
    expect(getActiveChannelTrigger("issue#gen", 9)).toBeNull();
  });

  it("activates emoji trigger for in-progress shortcode queries", () => {
    expect(getActiveEmojiTrigger("Hello :gri", 10)).toEqual({
      query: "gri",
      triggerStart: 6,
    });
    expect(getActiveEmojiTrigger(":da", 3)).toEqual({
      query: "da",
      triggerStart: 0,
    });
  });

  it("does not activate emoji trigger for bare colon or single-char query", () => {
    expect(getActiveEmojiTrigger(":", 1)).toBeNull();
    expect(getActiveEmojiTrigger(":d", 2)).toBeNull();
    expect(getActiveEmojiTrigger(":D", 2)).toBeNull();
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

  describe("getSuggestionPopupFixedStyle", () => {
    afterEach(() => {
      vi.unstubAllGlobals();
    });

    it("pins top-side popups with bottom and no translateY", () => {
      stubViewport(800);
      const style = getSuggestionPopupFixedStyle({
        top: 500,
        left: 24,
        side: "top",
        maxHeight: 200,
        width: 420,
      });

      expect(style).toEqual({
        left: 24,
        maxHeight: 200,
        width: 420,
        bottom: 800 - 500,
      });
      expect(style).not.toHaveProperty("top");
      expect(style).not.toHaveProperty("transform");
    });
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

      expect(position.side).toBe("top");
      expect(position.maxHeight).toBeGreaterThanOrEqual(POPUP_MIN_HEIGHT_PX);
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

  describe("getMentionPopupPositionFromAnchorRect", () => {
    afterEach(() => {
      vi.unstubAllGlobals();
    });

    function anchorRect(options: {
      left: number;
      width: number;
      top: number;
      height?: number;
    }): DOMRect {
      const height = options.height ?? 80;
      return {
        x: options.left,
        y: options.top,
        top: options.top,
        bottom: options.top + height,
        left: options.left,
        right: options.left + options.width,
        width: options.width,
        height,
        toJSON() {
          return this;
        },
      };
    }

    it("anchors above the card with a small bottom gap and matching width", () => {
      stubViewport(800);
      const left = 40;
      const width = 360;
      const top = 500;
      const position = getMentionPopupPositionFromAnchorRect(
        anchorRect({ left, width, top }),
      );

      expect(position.side).toBe("top");
      expect(position.top).toBe(top - MENTION_COMPOSER_GAP_PX);
      expect(position.left).toBe(left);
      expect(position.width).toBe(width);
      expect(position.maxHeight).toBe(
        Math.min(
          POPUP_HEIGHT_PX,
          Math.max(
            POPUP_MIN_HEIGHT_PX,
            top - VIEWPORT_PADDING_PX - MENTION_COMPOSER_GAP_PX,
          ),
        ),
      );
    });

    it("floors maxHeight and clamps top when less than 80px remains above", () => {
      stubViewport(800);
      const top = 50;
      const aboveSpace = top - VIEWPORT_PADDING_PX - MENTION_COMPOSER_GAP_PX;
      expect(aboveSpace).toBeLessThan(POPUP_MIN_HEIGHT_PX);

      const position = getMentionPopupPositionFromAnchorRect(
        anchorRect({ left: 40, width: 360, top }),
      );

      expect(position.maxHeight).toBe(POPUP_MIN_HEIGHT_PX);
      expect(position.top).toBe(VIEWPORT_PADDING_PX + POPUP_MIN_HEIGHT_PX);
    });

    it("keeps min height when aboveSpace collapses (iOS keyboard scroll)", () => {
      stubViewport(800);
      const top = VIEWPORT_PADDING_PX + MENTION_COMPOSER_GAP_PX;
      const aboveSpace = top - VIEWPORT_PADDING_PX - MENTION_COMPOSER_GAP_PX;
      expect(aboveSpace).toBe(0);

      const position = getMentionPopupPositionFromAnchorRect(
        anchorRect({ left: 40, width: 360, top }),
      );

      expect(position.maxHeight).toBe(POPUP_MIN_HEIGHT_PX);
      expect(position.top).toBe(VIEWPORT_PADDING_PX + POPUP_MIN_HEIGHT_PX);
    });

    it("recovers aboveSpace when offsetTop collapses a visual-relative rect", () => {
      stubViewport(800);
      vi.stubGlobal("visualViewport", {
        offsetTop: 120,
        offsetLeft: 0,
        width: 390,
        height: 400,
      });
      const top = 120 + VIEWPORT_PADDING_PX + MENTION_COMPOSER_GAP_PX;
      const position = getMentionPopupPositionFromAnchorRect(
        anchorRect({ left: 40, width: 360, top }),
      );

      expect(position.maxHeight).toBe(
        Math.min(
          POPUP_HEIGHT_PX,
          top - VIEWPORT_PADDING_PX - MENTION_COMPOSER_GAP_PX,
        ),
      );
      expect(position.top).toBe(top - MENTION_COMPOSER_GAP_PX);
    });

    it("does not under-count aboveSpace when client rects are visual-relative", () => {
      stubViewport(800);
      vi.stubGlobal("visualViewport", {
        offsetTop: 320,
        offsetLeft: 0,
        width: 390,
        height: 420,
      });
      const position = getMentionPopupPositionFromAnchorRect(
        anchorRect({ left: 16, width: 360, top: 340, height: 72 }),
      );

      expect(position.maxHeight).toBe(POPUP_HEIGHT_PX);
      expect(position.top).toBe(340 - MENTION_COMPOSER_GAP_PX);
    });

    it("clamps left and width into the viewport padding", () => {
      stubViewport(800);
      vi.stubGlobal("innerWidth", 400);
      const position = getMentionPopupPositionFromAnchorRect(
        anchorRect({ left: -20, width: 440, top: 300 }),
      );

      expect(position.left).toBe(VIEWPORT_PADDING_PX);
      expect(position.width).toBe(400 - 2 * VIEWPORT_PADDING_PX);
    });

    it("clamps left and width against visualViewport offsetLeft when zoomed", () => {
      stubViewport(800);
      vi.stubGlobal("visualViewport", {
        offsetTop: 0,
        offsetLeft: 120,
        width: 320,
        height: 800,
      });
      const position = getMentionPopupPositionFromAnchorRect(
        anchorRect({ left: 40, width: 400, top: 400 }),
      );

      expect(position.left).toBe(120 + VIEWPORT_PADDING_PX);
      expect(position.width).toBe(320 - 2 * VIEWPORT_PADDING_PX);
    });
  });

  describe("filterNormalizedMentions", () => {
    const sandro: NormalizedMention = {
      key: "sandro",
      value: "Sandro",
      slug: "sandro",
    };
    const andreas: NormalizedMention = {
      key: "andreas",
      value: "Andreas Osberghaus",
      slug: "andreas-osberghaus",
    };
    const allMention: NormalizedMention = {
      key: "all",
      value: "all",
      slug: "all",
    };
    const alice: NormalizedMention = {
      key: "alice",
      value: "Alice",
      slug: "alice",
    };
    const bob: NormalizedMention = {
      key: "bob",
      value: "Bob",
      slug: "bob",
    };

    it("preserves input order for empty query including @all pin", () => {
      const items = [allMention, sandro, andreas];
      expect(filterNormalizedMentions(items, "").map((m) => m.key)).toEqual([
        "all",
        "sandro",
        "andreas",
      ]);
    });

    it("ranks prefix matches before substring includes for andr", () => {
      const items = [sandro, andreas];
      const result = filterNormalizedMentions(items, "andr");
      expect(result.map((m) => m.key)).toEqual(["andreas", "sandro"]);
    });

    it("still returns includes-only matches when no prefix peer", () => {
      expect(
        filterNormalizedMentions([sandro, andreas], "ndr").map((m) => m.key),
      ).toEqual(["sandro", "andreas"]);
    });

    it("keeps within-tier input order for multiple prefix matches", () => {
      const items = [alice, bob];
      expect(filterNormalizedMentions(items, "a").map((m) => m.key)).toEqual([
        "alice",
      ]);
      const prefixPeers: NormalizedMention[] = [
        { key: "anna", value: "Anna", slug: "anna" },
        { key: "andrew", value: "Andrew", slug: "andrew" },
      ];
      expect(
        filterNormalizedMentions(prefixPeers, "an").map((m) => m.key),
      ).toEqual(["anna", "andrew"]);
    });

    it("matches slug when value does not contain query", () => {
      const bySlug: NormalizedMention = {
        key: "u1",
        value: "Display Name",
        slug: "andreas-osberghaus",
      };
      expect(
        filterNormalizedMentions([sandro, bySlug], "andr").map((m) => m.key),
      ).toEqual(["u1", "sandro"]);
    });

    it("returns empty when nothing matches", () => {
      expect(filterNormalizedMentions([sandro, andreas], "zzz")).toEqual([]);
    });

    it("does not mutate the input array", () => {
      const items = [sandro, andreas];
      const before = [...items];
      filterNormalizedMentions(items, "andr");
      expect(items).toEqual(before);
    });
  });
});
