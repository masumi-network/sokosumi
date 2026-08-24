import { describe, expect, it } from "vitest";

import type { ChatRoomMessage } from "@/schemas/chat-room.schema";

import {
  ABLY_MAX_MESSAGE_SIZE,
  ablyPublishSize,
  CHAT_ROOM_MESSAGE_EVENT_NAME,
  chatRoomMessagePublishBody,
  isChatRoomMessageIdEnvelope,
} from "./ably-message-size";

function baseMessage(
  overrides: Partial<ChatRoomMessage> = {},
): ChatRoomMessage {
  return {
    id: "550e8400-e29b-41d4-a716-446655440000",
    roomId: "660e8400-e29b-41d4-a716-446655440000",
    parentMessageId: null,
    content: "hello",
    createdAt: "2026-08-03T12:00:00.000Z",
    deletedAt: null,
    editedAt: null,
    sender: {
      type: "coworker",
      coworker: {
        id: "cow_123",
        name: "Hermes",
        slug: "hermes",
        caption: null,
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
    ...overrides,
  };
}

describe("chatRoomMessagePublishBody", () => {
  it("keeps the full DTO when it already fits maxMessageSize", () => {
    const message = baseMessage();
    const body = chatRoomMessagePublishBody("create", message);
    expect(body).toEqual({ eventType: "create", message });
    expect(
      ablyPublishSize(CHAT_ROOM_MESSAGE_EVENT_NAME, body),
    ).toBeLessThanOrEqual(ABLY_MAX_MESSAGE_SIZE);
  });

  it("switches to an id envelope when the full create is over the limit", () => {
    const message = baseMessage({
      content: "x".repeat(70_000),
      metadata: {
        reasoning: [{ type: "reasoning", text: "y".repeat(400) }],
      },
    });
    const full = { eventType: "create" as const, message };
    expect(ablyPublishSize(CHAT_ROOM_MESSAGE_EVENT_NAME, full)).toBeGreaterThan(
      ABLY_MAX_MESSAGE_SIZE,
    );

    const body = chatRoomMessagePublishBody("create", message);
    expect(isChatRoomMessageIdEnvelope(body)).toBe(true);
    expect(body).toEqual({
      eventType: "create",
      messageId: message.id,
      roomId: message.roomId,
      parentMessageId: null,
    });
    expect(
      ablyPublishSize(CHAT_ROOM_MESSAGE_EVENT_NAME, body),
    ).toBeLessThanOrEqual(ABLY_MAX_MESSAGE_SIZE);
  });
});
