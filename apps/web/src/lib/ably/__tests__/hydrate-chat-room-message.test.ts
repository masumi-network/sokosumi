import { describe, expect, it } from "vitest";

import { hydrateChatRoomMessageFromRealtime } from "@/lib/ably/hydrate-chat-room-message";

describe("hydrateChatRoomMessageFromRealtime", () => {
  it("converts ISO date strings to Date instances", () => {
    const hydrated = hydrateChatRoomMessageFromRealtime({
      id: "550e8400-e29b-41d4-a716-446655440000",
      roomId: "660e8400-e29b-41d4-a716-446655440000",
      parentMessageId: null,
      content: "hello",
      createdAt: "2026-08-03T12:00:00.000Z",
      deletedAt: null,
      editedAt: "2026-08-03T12:05:00.000Z",
      sender: {
        type: "user",
        user: {
          id: "user_1",
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
      metadata: null,
      quote: null,
      membership: null,
      unfurls: null,
    });

    expect(hydrated.createdAt).toEqual(new Date("2026-08-03T12:00:00.000Z"));
    expect(hydrated.editedAt).toEqual(new Date("2026-08-03T12:05:00.000Z"));
    expect(hydrated.deletedAt).toBeNull();
    expect(hydrated.threadLastReplyAt).toBeNull();
    expect(hydrated.membership).toBeNull();
  });

  it("preserves membership status from realtime payloads", () => {
    const hydrated = hydrateChatRoomMessageFromRealtime({
      id: "550e8400-e29b-41d4-a716-446655440001",
      roomId: "660e8400-e29b-41d4-a716-446655440000",
      parentMessageId: null,
      content: "Alice joined",
      createdAt: "2026-08-03T12:00:00.000Z",
      deletedAt: null,
      editedAt: null,
      sender: { type: "unknown" },
      mentions: [],
      reactions: [],
      threadReplyCount: 0,
      threadLastReplyAt: null,
      metadata: {
        membership: {
          action: "joined",
          subject: { type: "user", id: "user_1", name: "Alice" },
        },
      },
      quote: null,
      membership: {
        action: "joined",
        subject: { type: "user", id: "user_1", name: "Alice" },
      },
      unfurls: null,
    });

    expect(hydrated.membership).toEqual({
      action: "joined",
      subject: { type: "user", id: "user_1", name: "Alice" },
    });
  });

  it("preserves link unfurls from realtime payloads", () => {
    const unfurls = [
      {
        url: "https://example.com/article",
        title: "Example Article",
        description: "A short summary",
        imageUrl: "https://cdn.example.com/og.png",
        siteName: "Example",
      },
    ];
    const hydrated = hydrateChatRoomMessageFromRealtime({
      id: "550e8400-e29b-41d4-a716-446655440002",
      roomId: "660e8400-e29b-41d4-a716-446655440000",
      parentMessageId: null,
      content: "check https://example.com/article",
      createdAt: "2026-08-03T12:00:00.000Z",
      deletedAt: null,
      editedAt: null,
      sender: {
        type: "user",
        user: {
          id: "user_1",
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
      metadata: null,
      quote: null,
      membership: null,
      unfurls,
    });

    expect(hydrated.unfurls).toEqual(unfurls);
  });
});
