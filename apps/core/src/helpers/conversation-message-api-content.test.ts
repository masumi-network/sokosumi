import { describe, expect, it } from "vitest";

import {
  conversationMessageToApiContent,
  thoughtTimingFromMessageMetadata,
} from "./conversation-message-api-content";

describe("conversationMessageToApiContent", () => {
  it("returns plain string when there is no structured content", () => {
    expect(
      conversationMessageToApiContent({
        contentType: null,
        contentText: "Hello",
        metadata: null,
      }),
    ).toBe("Hello");
  });

  it("returns plain string for legacy metadata that only mirrors plain text", () => {
    expect(
      conversationMessageToApiContent({
        contentType: null,
        contentText: "Hello",
        metadata: {
          ui_message_v1: {
            parts: [{ type: "text", text: "Hello" }],
          },
        },
      }),
    ).toBe("Hello");
  });

  it("places reasoning steps before the primary body part type from contentType", () => {
    expect(
      conversationMessageToApiContent({
        contentType: "output_text",
        contentText: "Answer",
        metadata: {
          reasoning: [
            { type: "reasoning", text: "First thought" },
            { text: "Second" },
          ],
        },
      }),
    ).toEqual([
      { type: "reasoning", text: "First thought" },
      { type: "reasoning", text: "Second" },
      { type: "output_text", text: "Answer" },
    ]);
  });

  it("round-trips reasoning plus output_text stored in ui_message_v1", () => {
    expect(
      conversationMessageToApiContent({
        contentType: "output_text",
        contentText: "Answer",
        metadata: {
          reasoning: [{ type: "reasoning", text: "Step A" }],
          ui_message_v1: {
            parts: [{ type: "output_text", text: "Answer" }],
          },
        },
      }),
    ).toEqual([
      { type: "reasoning", text: "Step A" },
      { type: "output_text", text: "Answer" },
    ]);
  });

  it("returns stored ui_message_v1 file parts after reasoning", () => {
    expect(
      conversationMessageToApiContent({
        contentType: "file",
        contentText: "Please review",
        metadata: {
          reasoning: [{ type: "reasoning", text: "Looking at the document" }],
          ui_message_v1: {
            parts: [
              { type: "text", text: "Please review" },
              {
                type: "file",
                url: "https://example.com/brief.pdf",
                mediaType: "application/pdf",
                filename: "brief.pdf",
              },
            ],
          },
        },
      }),
    ).toEqual([
      { type: "reasoning", text: "Looking at the document" },
      { type: "text", text: "Please review" },
      {
        type: "file",
        url: "https://example.com/brief.pdf",
        mediaType: "application/pdf",
        filename: "brief.pdf",
      },
    ]);
  });

  it("returns assistant generated image file parts without markdown content", () => {
    expect(
      conversationMessageToApiContent({
        contentType: "output_text",
        contentText: "Here's the generated image.",
        metadata: {
          ui_message_v1: {
            parts: [
              { type: "output_text", text: "Here's the generated image." },
              {
                type: "file",
                url: "https://blob.example.com/generated.png",
                mediaType: "image/png",
                filename: "generated.png",
              },
            ],
          },
        },
      }),
    ).toEqual([
      { type: "output_text", text: "Here's the generated image." },
      {
        type: "file",
        url: "https://blob.example.com/generated.png",
        mediaType: "image/png",
        filename: "generated.png",
      },
    ]);
  });

  it("falls back to a text body when file contentType has no persisted file metadata", () => {
    expect(
      conversationMessageToApiContent({
        contentType: "file",
        contentText: "",
        metadata: null,
      }),
    ).toEqual([{ type: "text", text: "" }]);
  });

  it("does not append an empty text part when persisted ui is file-only", () => {
    expect(
      conversationMessageToApiContent({
        contentType: "file",
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

  it("returns plain string when contentType is blank after trimming", () => {
    expect(
      conversationMessageToApiContent({
        contentType: "   ",
        contentText: "",
        metadata: null,
      }),
    ).toBe("");
  });
});

describe("thoughtTimingFromMessageMetadata", () => {
  it("returns undefined when absent", () => {
    expect(thoughtTimingFromMessageMetadata(null)).toBeUndefined();
  });

  it("reads numeric start/end", () => {
    expect(
      thoughtTimingFromMessageMetadata({
        thought_timing_ms: { start: 100, end: 200 },
      }),
    ).toEqual({ startedAtMs: 100, endedAtMs: 200 });
  });

  it("coerces string timestamps from JSON", () => {
    expect(
      thoughtTimingFromMessageMetadata({
        thought_timing_ms: { start: "100", end: "200" },
      }),
    ).toEqual({ startedAtMs: 100, endedAtMs: 200 });
  });
});
