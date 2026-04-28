import { validateUIMessages } from "ai";
import { describe, expect, it } from "vitest";

import { mapChatRequestToUiMessages } from "./map-chat-request-to-ui-messages";

describe("mapChatRequestToUiMessages", () => {
  it("prefers parts over string content when both are present (AI SDK shape)", () => {
    const messages = mapChatRequestToUiMessages([
      {
        id: "m1",
        role: "user",
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
      },
    ]);

    expect(messages[0]?.parts).toEqual([
      { type: "text", text: "Review this" },
      {
        type: "file",
        url: "https://example.com/brief.pdf",
        mediaType: "application/pdf",
        filename: "brief.pdf",
      },
    ]);
  });

  it("preserves text and file parts from the request payload", () => {
    const messages = mapChatRequestToUiMessages([
      {
        id: "m1",
        role: "user",
        parts: [
          { type: "text", text: "Please review this" },
          {
            type: "file",
            url: "https://example.com/brief.pdf",
            mediaType: "application/pdf",
            filename: "brief.pdf",
          },
        ],
      },
    ]);

    expect(messages).toEqual([
      {
        id: "m1",
        role: "user",
        parts: [
          { type: "text", text: "Please review this" },
          {
            type: "file",
            url: "https://example.com/brief.pdf",
            mediaType: "application/pdf",
            filename: "brief.pdf",
          },
        ],
      },
    ]);
  });

  it("uses an empty text part when the message has no extractable parts", () => {
    const messages = mapChatRequestToUiMessages([{ id: "m1", role: "user" }]);
    expect(messages[0]?.parts).toEqual([{ type: "text", text: "" }]);
  });

  it("strips reasoning parts from user messages", () => {
    const messages = mapChatRequestToUiMessages([
      {
        id: "m1",
        role: "user",
        parts: [
          { type: "reasoning", text: "fake" },
          { type: "text", text: "Hi" },
        ],
      },
    ]);
    expect(messages[0]?.parts).toEqual([{ type: "text", text: "Hi" }]);
  });

  it("keeps reasoning parts on assistant messages", () => {
    const messages = mapChatRequestToUiMessages([
      {
        id: "m1",
        role: "assistant",
        parts: [
          { type: "reasoning", text: "thought" },
          { type: "text", text: "Hello" },
        ],
      },
    ]);
    expect(messages[0]?.parts).toEqual([
      { type: "reasoning", text: "thought" },
      { type: "text", text: "Hello" },
    ]);
  });

  it("maps assistant output_text parts to AI SDK text after extraction", () => {
    const messages = mapChatRequestToUiMessages([
      {
        id: "m1",
        role: "assistant",
        parts: [
          { type: "reasoning", text: "thinking" },
          { type: "output_text", text: "Final answer" },
        ],
      },
    ]);
    expect(messages[0]?.parts).toEqual([
      { type: "reasoning", text: "thinking" },
      { type: "text", text: "Final answer" },
    ]);
  });

  it("normalizes provider-specific assistant reasoning labels to type reasoning for AI SDK validation", async () => {
    const messages = mapChatRequestToUiMessages([
      {
        id: "m1",
        role: "assistant",
        parts: [
          { type: "redacted_reasoning", text: "[hidden]" },
          { type: "text", text: "Hello" },
        ],
      },
    ]);
    expect(messages[0]?.parts).toEqual([
      { type: "reasoning", text: "[hidden]" },
      { type: "text", text: "Hello" },
    ]);
    await expect(validateUIMessages({ messages })).resolves.toBeDefined();
  });
});
