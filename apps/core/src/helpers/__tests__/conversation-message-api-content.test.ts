import { describe, expect, it } from "vitest";

import {
  conversationMessageToApiContent,
  thoughtTimingFromMessageMetadata,
} from "../conversation-message-api-content";

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
