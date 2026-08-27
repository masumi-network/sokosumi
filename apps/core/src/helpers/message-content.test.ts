import { describe, expect, it } from "vitest";

import {
  buildConversationContentParts,
  buildMessageTitleSource,
  extractMessageText,
  extractPersistableUiParts,
  extractReasoningPartsFromMessage,
  extractUiMessageParts,
  hasModelVisibleMessageContent,
  readReasoningPartsFromMetadata,
} from "./message-content";

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

  it("keeps string content when parts are attachment-only", () => {
    expect(
      extractMessageText({
        content: "Summarize this",
        parts: [
          {
            type: "file",
            url: "https://example.com/brief.pdf",
            mediaType: "application/pdf",
          },
        ],
      }),
    ).toBe("Summarize this");
  });
});

describe("readReasoningPartsFromMetadata", () => {
  it("preserves allowlisted reasoning steps and trims text", () => {
    expect(
      readReasoningPartsFromMetadata({
        reasoning: [{ type: "reasoning", text: "  hidden  " }],
      }),
    ).toEqual([{ type: "reasoning", text: "hidden" }]);
  });

  it("drops legacy redacted_reasoning steps", () => {
    expect(
      readReasoningPartsFromMetadata({
        reasoning: [
          { type: "redacted_reasoning", text: "legacy" },
          { type: "reasoning", text: "keep" },
        ],
      }),
    ).toEqual([{ type: "reasoning", text: "keep" }]);
  });
});

describe("extractReasoningPartsFromMessage", () => {
  it("collects reasoning from structured content without mixing text parts", () => {
    expect(
      extractReasoningPartsFromMessage({
        content: [
          { type: "reasoning", text: "Step one" },
          { type: "output_text", text: "Done" },
        ],
      }),
    ).toEqual([{ type: "reasoning", text: "Step one" }]);
  });

  it("does not collect tool/step parts as reasoning even when they have text", () => {
    expect(
      extractReasoningPartsFromMessage({
        content: [
          { type: "tool-call", text: "Calling search" },
          { type: "step-start", text: "Step 1" },
          { type: "reasoning", text: "Only this" },
          { type: "text", text: "Answer" },
        ],
      }),
    ).toEqual([{ type: "reasoning", text: "Only this" }]);
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

  it("preserves output_text parts for storage round-trip", () => {
    expect(
      extractPersistableUiParts({
        content: [
          { type: "reasoning", text: "thinking" },
          { type: "output_text", text: "Final answer" },
        ],
      }),
    ).toEqual([{ type: "output_text", text: "Final answer" }]);
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

  it("prepends string content as text when parts are file-only", () => {
    expect(
      extractPersistableUiParts({
        content: "Summarize this",
        parts: [
          {
            type: "file",
            url: "https://example.com/brief.pdf",
            mediaType: "application/pdf",
            filename: "brief.pdf",
          },
        ],
      }),
    ).toEqual([
      { type: "text", text: "Summarize this" },
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

describe("hasModelVisibleMessageContent", () => {
  it("returns true for attachment-only file messages", () => {
    expect(
      hasModelVisibleMessageContent({
        parts: [
          {
            type: "file",
            url: "https://example.com/brief.pdf",
            mediaType: "application/pdf",
          },
        ],
      }),
    ).toBe(true);
  });

  it("returns false for blank text-only messages", () => {
    expect(
      hasModelVisibleMessageContent({
        parts: [{ type: "text", text: "   " }],
      }),
    ).toBe(false);
  });
});

describe("buildMessageTitleSource", () => {
  it("prefers extracted text when present", () => {
    expect(
      buildMessageTitleSource({
        content: "Summarize this image",
        parts: [
          {
            type: "file",
            url: "https://example.com/cat.png",
            mediaType: "image/png",
          },
        ],
      }),
    ).toBe("Summarize this image");
  });

  it("falls back to the first attachment filename", () => {
    expect(
      buildMessageTitleSource({
        parts: [
          {
            type: "file",
            url: "https://example.com/uploads/brief.pdf",
            mediaType: "application/pdf",
            filename: "brief.pdf",
          },
        ],
      }),
    ).toBe("brief.pdf");
  });

  it("skips blank text parts before attachment fallbacks", () => {
    expect(
      buildMessageTitleSource({
        parts: [
          { type: "text", text: "   " },
          {
            type: "file",
            url: "https://example.com/uploads/brief.pdf",
            mediaType: "application/pdf",
            filename: "brief.pdf",
          },
        ],
      }),
    ).toBe("brief.pdf");
  });

  it("uses an image fallback label when no filename is available", () => {
    expect(
      buildMessageTitleSource({
        parts: [
          {
            type: "file",
            url: "https://example.com/uploads/cat.png",
            mediaType: "image/png",
          },
        ],
      }),
    ).toBe("Image message");
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

  it("prepends string content before file-only parts for the model body", () => {
    expect(
      extractUiMessageParts({
        content: "Summarize this",
        parts: [
          {
            type: "file",
            url: "https://example.com/brief.pdf",
            mediaType: "application/pdf",
          },
        ],
      }),
    ).toEqual([
      { type: "text", text: "Summarize this" },
      {
        type: "file",
        url: "https://example.com/brief.pdf",
        mediaType: "application/pdf",
      },
    ]);
  });

  it("preserves output_text parts instead of coercing them to text", () => {
    expect(
      extractUiMessageParts({
        content: [
          { type: "reasoning", text: "Step" },
          { type: "output_text", text: "Answer" },
        ],
      }),
    ).toEqual([
      { type: "reasoning", text: "Step" },
      { type: "output_text", text: "Answer" },
    ]);
  });
});
