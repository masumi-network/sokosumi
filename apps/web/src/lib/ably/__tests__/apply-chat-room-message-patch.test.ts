import { describe, expect, it } from "vitest";

import type { ChatRoomMessage } from "@/lib/clients/generated/core";

import { applyChatRoomMessagePatch } from "../apply-chat-room-message-patch";

function baseMessage(
  overrides: Partial<ChatRoomMessage> = {},
): ChatRoomMessage {
  return {
    id: "msg-1",
    roomId: "room-1",
    parentMessageId: null,
    content: "hello world",
    createdAt: new Date("2026-08-06T12:00:00.000Z"),
    deletedAt: null,
    editedAt: null,
    sender: {
      type: "user",
      user: {
        id: "user-1",
        name: "Alice",
        email: "alice@example.com",
        image: null,
        presence: "online",
      },
    },
    mentions: [],
    reactions: [],
    threadReplyCount: 0,
    threadLastReplyAt: null,
    metadata: { keep: true },
    quote: null,
    membership: null,
    unfurls: null,
    ...overrides,
  };
}

describe("applyChatRoomMessagePatch", () => {
  it("merges reactions without clobbering content or metadata", () => {
    const existing = baseMessage({
      content: "keep me",
      metadata: { keep: true },
    });
    const reactions = [
      {
        emoji: "👍",
        count: 2,
        reactedByCurrentUser: true,
        reactors: [{ id: "user-1", name: "Alice" }],
      },
    ];

    const merged = applyChatRoomMessagePatch(existing, {
      eventType: "reaction",
      messageId: "msg-1",
      roomId: "room-1",
      parentMessageId: null,
      patch: { reactions },
    });

    expect(merged.content).toBe("keep me");
    expect(merged.metadata).toEqual({ keep: true });
    expect(merged.reactions).toEqual(reactions);
    expect(merged.sender).toEqual(existing.sender);
  });

  it("merges unfurls only", () => {
    const unfurls = [
      {
        url: "https://example.com",
        title: "Example",
        description: null,
        imageUrl: null,
        siteName: null,
      },
    ];
    const merged = applyChatRoomMessagePatch(baseMessage(), {
      eventType: "unfurl",
      messageId: "msg-1",
      roomId: "room-1",
      parentMessageId: null,
      patch: { unfurls },
    });

    expect(merged.unfurls).toEqual(unfurls);
    expect(merged.content).toBe("hello world");
  });

  it("merges mentions only", () => {
    const mentions = [
      {
        id: "men-1",
        coworkerId: "cow-1",
        status: "completed" as const,
        responseMessageId: "resp-1",
      },
    ];
    const merged = applyChatRoomMessagePatch(baseMessage(), {
      eventType: "mention_status",
      messageId: "msg-1",
      roomId: "room-1",
      parentMessageId: null,
      patch: { mentions },
    });

    expect(merged.mentions).toEqual(mentions);
    expect(merged.reactions).toEqual([]);
  });
});
