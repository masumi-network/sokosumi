import type { UIMessage } from "ai";
import { describe, expect, it } from "vitest";

import {
  hasImageGenerationUiMessage,
  readConversationImageGenerationFromMetadata,
  readImageGenerationFromUiMessage,
} from "../conversation-metadata";

describe("conversation image generation metadata", () => {
  it("reads sticky image mode from conversation metadata", () => {
    expect(
      readConversationImageGenerationFromMetadata({
        image_generation: true,
      }),
    ).toBe(true);
    expect(
      readConversationImageGenerationFromMetadata({
        image_generation: false,
      }),
    ).toBe(false);
    expect(readConversationImageGenerationFromMetadata(null)).toBe(false);
  });

  it("reads image mode from persisted user UI messages", () => {
    const userImageMessage = {
      id: "u1",
      role: "user",
      parts: [{ type: "text", text: "Make an image" }],
      metadata: { imageGeneration: true },
    } satisfies UIMessage;
    const assistantImageMessage = {
      id: "a1",
      role: "assistant",
      parts: [{ type: "text", text: "Done" }],
      metadata: { imageGeneration: true },
    } satisfies UIMessage;

    expect(readImageGenerationFromUiMessage(userImageMessage)).toBe(true);
    expect(readImageGenerationFromUiMessage(assistantImageMessage)).toBe(false);
    expect(hasImageGenerationUiMessage([assistantImageMessage])).toBe(false);
    expect(
      hasImageGenerationUiMessage([assistantImageMessage, userImageMessage]),
    ).toBe(true);
  });
});
