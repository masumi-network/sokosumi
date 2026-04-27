import { describe, expect, it } from "vitest";

import {
  buildConversationContentParts,
  extractMessageText,
  extractPersistableUiParts,
  extractUiMessageParts,
  readReasoningPartsFromMetadata,
} from "../message-content";

describe("readRawMessagePartItems (via extractMessageText)", () => {
  it("prefers string content over an empty parts array", () => {
    expect(
      extractMessageText({
        parts: [],
        content: "Hello",
      }),
    ).toBe("Hello");
  });

  it("prefers array content over parts when content is an array", () => {
    expect(
      extractMessageText({
        parts: [{ type: "text", text: "ignored" }],
        content: [{ type: "text", text: "From content" }],
      }),
    ).toBe("From content");
  });

  it("maps input_text segments to extracted plain text", () => {
    expect(
      extractMessageText({
        content: [{ type: "input_text", text: "Hi" }],
      }),
    ).toBe("Hi");
  });
});

describe("readReasoningPartsFromMetadata", () => {
  it("preserves provider-specific reasoning type labels", () => {
    expect(
      readReasoningPartsFromMetadata({
        reasoning: [{ type: "redacted_reasoning", text: "  hidden  " }],
      }),
    ).toEqual([{ type: "redacted_reasoning", text: "hidden" }]);
  });
});

describe("buildConversationContentParts", () => {
  it("echoes fallbackPrimaryContentType for the synthesized body part", () => {
    expect(
      buildConversationContentParts({
        contentText: "Answer",
        metadata: null,
        fallbackPrimaryContentType: "output_text",
      }),
    ).toEqual([{ type: "output_text", text: "Answer" }]);
  });

  it("emits a primary body when contentType is set but contentText is empty", () => {
    expect(
      buildConversationContentParts({
        contentText: "",
        metadata: null,
        fallbackPrimaryContentType: "output_text",
      }),
    ).toEqual([{ type: "output_text", text: "" }]);
  });
});

describe("extractPersistableUiParts", () => {
  it("normalizes input_text to a persistable text part", () => {
    expect(
      extractPersistableUiParts({
        content: [{ type: "input_text", text: "Hello" }],
      }),
    ).toEqual([{ type: "text", text: "Hello" }]);
  });
});

describe("extractUiMessageParts", () => {
  it("includes reasoning for assistant-shaped payloads", () => {
    expect(
      extractUiMessageParts({
        parts: [
          { type: "reasoning", text: "thinking" },
          { type: "text", text: "Hi" },
        ],
      }),
    ).toEqual([
      { type: "reasoning", text: "thinking" },
      { type: "text", text: "Hi" },
    ]);
  });
});
