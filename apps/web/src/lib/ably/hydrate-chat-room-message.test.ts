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
      pinnedAt: "2026-08-03T12:10:00.000Z",
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
    expect(hydrated.pinnedAt).toEqual(new Date("2026-08-03T12:10:00.000Z"));
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
      pinnedAt: null,
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

  it("preserves a Group name change from realtime payloads", () => {
    const groupNameChange = {
      action: "named",
      name: "Launch crew",
      actor: { id: "user_1", name: "Alice" },
    };
    const hydrated = hydrateChatRoomMessageFromRealtime({
      id: "550e8400-e29b-41d4-a716-446655440003",
      roomId: "660e8400-e29b-41d4-a716-446655440000",
      parentMessageId: null,
      content: "Alice named the group Launch crew",
      createdAt: "2026-08-03T12:00:00.000Z",
      deletedAt: null,
      editedAt: null,
      pinnedAt: null,
      sender: { type: "unknown" },
      mentions: [],
      reactions: [],
      threadReplyCount: 0,
      threadLastReplyAt: null,
      metadata: { groupNameChange },
      quote: null,
      membership: null,
      groupNameChange,
      unfurls: null,
    });

    expect(hydrated.groupNameChange).toEqual(groupNameChange);
  });

  // Web and Core deploy apart, so an event from a Core without the field
  // must still hydrate as an ordinary message.
  it("reads a missing Group name change as none", () => {
    const hydrated = hydrateChatRoomMessageFromRealtime({
      id: "550e8400-e29b-41d4-a716-446655440004",
      roomId: "660e8400-e29b-41d4-a716-446655440000",
      parentMessageId: null,
      content: "hello",
      createdAt: "2026-08-03T12:00:00.000Z",
      deletedAt: null,
      editedAt: null,
      pinnedAt: null,
      sender: { type: "unknown" },
      mentions: [],
      reactions: [],
      threadReplyCount: 0,
      threadLastReplyAt: null,
      metadata: null,
      quote: null,
      membership: null,
      unfurls: null,
    });

    expect(hydrated.groupNameChange).toBeNull();
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
      pinnedAt: null,
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

  it("preserves client_message_id in metadata for outbound confirm merge", () => {
    const hydrated = hydrateChatRoomMessageFromRealtime({
      id: "550e8400-e29b-41d4-a716-446655440003",
      roomId: "660e8400-e29b-41d4-a716-446655440000",
      parentMessageId: null,
      content: "hello",
      createdAt: "2026-08-03T12:00:00.000Z",
      deletedAt: null,
      editedAt: null,
      pinnedAt: null,
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
      metadata: { client_message_id: "turn-1" },
      quote: null,
      membership: null,
      unfurls: null,
    });

    expect(hydrated.metadata).toEqual({ client_message_id: "turn-1" });
  });

  it("preserves thread repliers from realtime payloads", () => {
    const threadRepliers = [
      {
        type: "user",
        user: {
          id: "user_2",
          name: "Grace",
          email: "grace@example.com",
          image: null,
          presence: "offline",
        },
      },
    ];

    const hydrated = hydrateChatRoomMessageFromRealtime({
      id: "550e8400-e29b-41d4-a716-446655440003",
      roomId: "660e8400-e29b-41d4-a716-446655440000",
      parentMessageId: null,
      content: "Thread parent",
      createdAt: "2026-08-03T12:00:00.000Z",
      deletedAt: null,
      editedAt: "2026-08-03T12:05:00.000Z",
      pinnedAt: null,
      sender: { type: "unknown" },
      mentions: [],
      reactions: [],
      threadReplyCount: 1,
      threadLastReplyAt: "2026-08-03T12:04:00.000Z",
      threadRepliers,
      metadata: null,
      quote: null,
      membership: null,
      unfurls: null,
    });

    expect(hydrated.threadRepliers).toEqual(threadRepliers);
  });
});
