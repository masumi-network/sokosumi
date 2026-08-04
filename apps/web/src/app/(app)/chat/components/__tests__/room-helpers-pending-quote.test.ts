import { describe, expect, it } from "vitest";

import type { ChatRoomMessage } from "@/lib/clients/generated/core";

import { pendingQuoteFromMessage } from "../room-helpers";

function userMessage(
  overrides: Partial<ChatRoomMessage> = {},
): ChatRoomMessage {
  return {
    id: "550e8400-e29b-41d4-a716-446655440000",
    roomId: "550e8400-e29b-41d4-a716-446655440001",
    parentMessageId: null,
    content: "Hello",
    createdAt: new Date("2026-07-01T14:35:00.000Z"),
    editedAt: null,
    mentions: [],
    reactions: [],
    threadReplyCount: 0,
    threadLastReplyAt: null,
    metadata: null,
    quote: null,
    membership: null,
    deletedAt: null,
    sender: {
      type: "user",
      user: {
        id: "user-1",
        name: "Ada",
        email: "ada@example.com",
        image: null,
        presence: "offline",
      },
    },
    ...overrides,
  };
}

describe("pendingQuoteFromMessage", () => {
  it("extracts image attachment and text snippet via shared helper", () => {
    const pending = pendingQuoteFromMessage(
      userMessage({
        content:
          "launch risk notes\n[launch.png](https://blob.example/launch.png)",
      }),
    );

    expect(pending).toEqual({
      messageId: "550e8400-e29b-41d4-a716-446655440000",
      authorName: "Ada",
      snippet: "launch risk notes",
      attachment: {
        fileName: "launch.png",
        url: "https://blob.example/launch.png",
        mediaKind: "image",
      },
    });
  });

  it("extracts non-image file attachment", () => {
    const pending = pendingQuoteFromMessage(
      userMessage({
        content: "see [brief.pdf](https://blob.example/brief.pdf)",
      }),
    );

    expect(pending.snippet).toBe("see");
    expect(pending.attachment).toEqual({
      fileName: "brief.pdf",
      url: "https://blob.example/brief.pdf",
      mediaKind: "file",
    });
  });

  it("keeps attachment null for text-only messages", () => {
    const pending = pendingQuoteFromMessage(
      userMessage({ content: "plain text only" }),
    );

    expect(pending.snippet).toBe("plain text only");
    expect(pending.attachment).toBeNull();
  });
});
