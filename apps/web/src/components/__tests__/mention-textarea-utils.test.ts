import {
  buildMentionToken,
  serializeEditorText,
  setEditorFromRaw,
} from "@/components/ui/mention-textarea-utils";

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
});
