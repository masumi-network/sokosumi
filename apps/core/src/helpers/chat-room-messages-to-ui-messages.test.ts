import { validateUIMessages } from "ai";
import { describe, expect, it } from "vitest";

import { chatRoomMessagesToUiMessages } from "./chat-room-messages-to-ui-messages";

const baseCreatedAt = new Date("2026-01-01T00:00:00.000Z");

describe("chatRoomMessagesToUiMessages", () => {
  it("maps coworker sender to assistant role and user sender to user role", async () => {
    const messages = chatRoomMessagesToUiMessages([
      {
        id: "m1",
        content: "Hi",
        senderUserId: "user_1",
        senderCoworkerId: null,
        metadata: null,
        createdAt: baseCreatedAt,
      },
      {
        id: "m2",
        content: "Hello back",
        senderUserId: null,
        senderCoworkerId: "coworker_1",
        metadata: null,
        createdAt: baseCreatedAt,
      },
    ]);

    expect(messages[0]?.role).toBe("user");
    expect(messages[1]?.role).toBe("assistant");
    await expect(validateUIMessages({ messages })).resolves.toBeDefined();
  });

  it("maps orchestrator sender to assistant role", async () => {
    const messages = chatRoomMessagesToUiMessages([
      {
        id: "m1",
        content: "On it.",
        senderUserId: null,
        senderCoworkerId: null,
        senderOrchestratorId: "orch_1",
        metadata: null,
        createdAt: baseCreatedAt,
      },
    ]);

    expect(messages[0]?.role).toBe("assistant");
    await expect(validateUIMessages({ messages })).resolves.toBeDefined();
  });

  it("rehydrates assistant generated image file parts from metadata", async () => {
    const messages = chatRoomMessagesToUiMessages([
      {
        id: "m1",
        content: "Here's the generated image.",
        senderUserId: null,
        senderCoworkerId: "coworker_1",
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
        createdAt: baseCreatedAt,
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

  it("strips reasoning metadata from user messages", async () => {
    const messages = chatRoomMessagesToUiMessages([
      {
        id: "m1",
        content: "Hi",
        senderUserId: "user_1",
        senderCoworkerId: null,
        metadata: {
          reasoning: [{ type: "reasoning", text: "corrupt or migrated" }],
          ui_message_v1: {
            parts: [{ type: "text", text: "Hi" }],
          },
        },
        createdAt: baseCreatedAt,
      },
    ]);

    expect(messages[0]?.parts).toEqual([{ type: "text", text: "Hi" }]);
    await expect(validateUIMessages({ messages })).resolves.toBeDefined();
  });

  it("rehydrates image generation intent from user message metadata", async () => {
    const messages = chatRoomMessagesToUiMessages([
      {
        id: "m1",
        content: "Make an image",
        senderUserId: "user_1",
        senderCoworkerId: null,
        metadata: {
          image_generation: true,
          ui_message_v1: {
            parts: [{ type: "text", text: "Make an image" }],
          },
        },
        createdAt: baseCreatedAt,
      },
    ]);

    expect(messages[0]?.metadata).toEqual({ imageGeneration: true });
    await expect(validateUIMessages({ messages })).resolves.toBeDefined();
  });
});
