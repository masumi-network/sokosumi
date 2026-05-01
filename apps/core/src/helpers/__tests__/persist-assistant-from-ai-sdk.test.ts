import { afterEach, describe, expect, it, vi } from "vitest";

const {
  conversationFindFirstMock,
  conversationMessageCreateMock,
  conversationMessageFindFirstMock,
} = vi.hoisted(() => ({
  conversationFindFirstMock: vi.fn(),
  conversationMessageCreateMock: vi.fn(),
  conversationMessageFindFirstMock: vi.fn(),
}));

vi.mock("@/lib/db/prisma", () => ({
  default: {
    conversation: {
      findFirst: conversationFindFirstMock,
    },
    conversationMessage: {
      create: conversationMessageCreateMock,
      findFirst: conversationMessageFindFirstMock,
    },
  },
}));

import { persistAssistantFromAiSdk } from "../persist-assistant-from-ai-sdk";

describe("persistAssistantFromAiSdk", () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it("persists slim caption text with structured ui file parts", async () => {
    conversationFindFirstMock.mockResolvedValue({
      id: "conversation-1",
      metadata: null,
    });

    await persistAssistantFromAiSdk({
      conversationId: "conversation-1",
      userId: "user-1",
      text: "Here's the generated image.",
      responsesApiResponseId: null,
      uiParts: [
        { type: "text", text: "Here's the generated image." },
        {
          type: "file",
          url: "https://blob.example.com/generated.png",
          mediaType: "image/png",
          filename: "generated.png",
        },
      ],
    });

    expect(conversationMessageCreateMock).toHaveBeenCalledWith({
      data: {
        conversationId: "conversation-1",
        role: "assistant",
        contentType: "output_text",
        contentText: "Here's the generated image.",
        metadata: {
          ui_message_v1: {
            parts: [
              { type: "text", text: "Here's the generated image." },
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
    });
  });

  it("persists file-only assistant output instead of dropping the message", async () => {
    conversationFindFirstMock.mockResolvedValue({
      id: "conversation-1",
      metadata: null,
    });

    await persistAssistantFromAiSdk({
      conversationId: "conversation-1",
      userId: "user-1",
      text: "",
      responsesApiResponseId: null,
      uiParts: [
        {
          type: "file",
          url: "https://blob.example.com/generated.png",
          mediaType: "image/png",
          filename: "generated.png",
        },
      ],
    });

    expect(conversationMessageCreateMock).toHaveBeenCalledWith({
      data: {
        conversationId: "conversation-1",
        role: "assistant",
        contentType: "output_text",
        contentText: "",
        metadata: {
          ui_message_v1: {
            parts: [
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
    });
  });

  it("skips empty assistant output when no reasoning or ui parts exist", async () => {
    await persistAssistantFromAiSdk({
      conversationId: "conversation-1",
      userId: "user-1",
      text: "   ",
      responsesApiResponseId: null,
    });

    expect(conversationFindFirstMock).not.toHaveBeenCalled();
    expect(conversationMessageCreateMock).not.toHaveBeenCalled();
    expect(conversationMessageFindFirstMock).not.toHaveBeenCalled();
  });
});
