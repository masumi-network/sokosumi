import { validateUIMessages } from "ai";
import { describe, expect, it } from "vitest";

import {
  assistantContentPartsToAiSdkUiParts,
  conversationMessagesToUiMessages,
} from "./conversation-messages-to-ui-messages";

describe("conversationMessagesToUiMessages", () => {
  it("rehydrates assistant generated image file parts from metadata", async () => {
    const messages = conversationMessagesToUiMessages([
      {
        id: "m1",
        role: "assistant",
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
      },
    ]);

    expect(messages[0]?.parts).toEqual([
      { type: "text", text: "Here's the generated image." },
      {
        type: "file",
        url: "https://blob.example.com/generated.png",
        mediaType: "image/png",
        filename: "generated.png",
      },
    ]);

    await expect(validateUIMessages({ messages })).resolves.toBeDefined();
  });

  it("rehydrates stored text and file ui parts from metadata", async () => {
    const messages = conversationMessagesToUiMessages([
      {
        id: "m1",
        role: "user",
        contentText: "Please review this file",
        metadata: {
          ui_message_v1: {
            parts: [
              { type: "text", text: "Please review this file" },
              {
                type: "file",
                url: "https://example.com/brief.pdf",
                mediaType: "application/pdf",
                filename: "brief.pdf",
              },
            ],
          },
        },
      },
    ]);

    expect(messages[0]?.parts).toEqual([
      { type: "text", text: "Please review this file" },
      {
        type: "file",
        url: "https://example.com/brief.pdf",
        mediaType: "application/pdf",
        filename: "brief.pdf",
      },
    ]);

    await expect(validateUIMessages({ messages })).resolves.toBeDefined();
  });

  it("rehydrates file-only metadata without a trailing empty text part", async () => {
    const messages = conversationMessagesToUiMessages([
      {
        id: "m1",
        role: "user",
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
      },
    ]);

    expect(messages[0]?.parts).toEqual([
      {
        type: "file",
        url: "https://example.com/brief.pdf",
        mediaType: "application/pdf",
        filename: "brief.pdf",
      },
    ]);

    await expect(validateUIMessages({ messages })).resolves.toBeDefined();
  });

  it("strips reasoning metadata from user messages (parity with mapChatRequestToUiMessages)", async () => {
    const messages = conversationMessagesToUiMessages([
      {
        id: "m1",
        role: "user",
        contentText: "Hi",
        metadata: {
          reasoning: [{ type: "reasoning", text: "corrupt or migrated" }],
          ui_message_v1: {
            parts: [{ type: "text", text: "Hi" }],
          },
        },
      },
    ]);

    expect(messages[0]?.parts).toEqual([{ type: "text", text: "Hi" }]);
    await expect(validateUIMessages({ messages })).resolves.toBeDefined();
  });

  it("rehydrates image generation intent from user message metadata", async () => {
    const messages = conversationMessagesToUiMessages([
      {
        id: "m1",
        role: "user",
        contentText: "Make an image",
        metadata: {
          image_generation: true,
          ui_message_v1: {
            parts: [{ type: "text", text: "Make an image" }],
          },
        },
      },
    ]);

    expect(messages[0]?.metadata).toEqual({ imageGeneration: true });
    await expect(validateUIMessages({ messages })).resolves.toBeDefined();
  });
});

describe("assistantContentPartsToAiSdkUiParts", () => {
  it("maps only allowlisted reasoning to ReasoningUIPart", () => {
    expect(
      assistantContentPartsToAiSdkUiParts([
        { type: "reasoning", text: "Thought beat" },
        { type: "output_text", text: "Answer" },
      ]),
    ).toEqual([
      { type: "reasoning", text: "Thought beat" },
      { type: "text", text: "Answer" },
    ]);
  });

  it("maps exotic primary body types and legacy labels to text, not Thought", () => {
    expect(
      assistantContentPartsToAiSdkUiParts([
        { type: "redacted_reasoning", text: "legacy" },
        { type: "custom_primary", text: "Body from contentType" },
        { type: "reasoning", text: "Real Thought" },
      ]),
    ).toEqual([
      { type: "text", text: "legacy" },
      { type: "text", text: "Body from contentType" },
      { type: "reasoning", text: "Real Thought" },
    ]);
  });
});
