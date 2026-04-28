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

  it("falls back to an empty text part for file contentType without ui_message_v1 parts", () => {
    expect(
      buildConversationContentParts({
        contentText: "",
        metadata: null,
        fallbackPrimaryContentType: "file",
      }),
    ).toEqual([{ type: "text", text: "" }]);
  });

  it("does not append an empty text part when metadata is file-only and contentType is file", () => {
    expect(
      buildConversationContentParts({
        contentText: "",
        metadata: {
          ui_message_v1: {
            parts: [
              {
                type: "file",
                url: "https://example.com/brief.pdf",
                mediaType: "application/pdf",
                filename: "brief.pdf",
              },
            ],
          },
        },
        fallbackPrimaryContentType: "file",
      }),
    ).toEqual([
      {
        type: "file",
        url: "https://example.com/brief.pdf",
        mediaType: "application/pdf",
        filename: "brief.pdf",
      },
    ]);
  });
});

describe("extractPersistableUiParts", () => {
  it("does not synthesize ui_message_v1 parts from plain string content", () => {
    expect(
      extractPersistableUiParts({
        content: "Hello",
      }),
    ).toEqual([]);
  });

  it("normalizes input_text to a persistable text part", () => {
    expect(
      extractPersistableUiParts({
        content: [{ type: "input_text", text: "Hello" }],
      }),
    ).toEqual([{ type: "text", text: "Hello" }]);
  });

  it("prefers non-empty parts over string content so file parts are not dropped", () => {
    expect(
      extractPersistableUiParts({
        content: "Review this",
        parts: [
          { type: "text", text: "Review this" },
          {
            type: "file",
            url: "https://example.com/brief.pdf",
            mediaType: "application/pdf",
            filename: "brief.pdf",
          },
        ],
      }),
    ).toEqual([
      { type: "text", text: "Review this" },
      {
        type: "file",
        url: "https://example.com/brief.pdf",
        mediaType: "application/pdf",
        filename: "brief.pdf",
      },
    ]);
  });

  it("drops file parts with unsafe schemes", () => {
    expect(
      extractPersistableUiParts({
        parts: [
          {
            type: "file",
            url: "javascript:alert(document.cookie)",
            mediaType: "text/html",
          },
        ],
      }),
    ).toEqual([]);
  });

  it("keeps safe https file parts", () => {
    expect(
      extractPersistableUiParts({
        parts: [
          {
            type: "file",
            url: "https://example.com/brief.pdf",
            mediaType: "application/pdf",
          },
        ],
      }),
    ).toEqual([
      {
        type: "file",
        url: "https://example.com/brief.pdf",
        mediaType: "application/pdf",
      },
    ]);
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
