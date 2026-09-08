import { describe, expect, it } from "vitest";

import {
  buildConversationContentParts,
  extractMessageText,
  extractUiMessageParts,
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
