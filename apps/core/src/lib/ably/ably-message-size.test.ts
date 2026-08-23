import { describe, expect, it } from "vitest";

import type { ChatRoomMessage } from "@/schemas/chat-room.schema";

import {
  ABLY_MAX_MESSAGE_SIZE,
  ablyPublishSize,
  CHAT_ROOM_MESSAGE_EVENT_NAME,
  fitChatRoomMessageFullEvent,
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
        image: null,
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

describe("ablyPublishSize", () => {
  it("matches Ably REST name.length + UTF-8 JSON data bytes", () => {
    const data = { eventType: "create", message: { id: "1", content: "hi" } };
    const expected =
      CHAT_ROOM_MESSAGE_EVENT_NAME.length +
      Buffer.byteLength(JSON.stringify(data), "utf8");
    expect(ablyPublishSize(CHAT_ROOM_MESSAGE_EVENT_NAME, data)).toBe(expected);
  });
});

describe("fitChatRoomMessageFullEvent", () => {
  it("returns the original body when already under the Ably limit", () => {
    const message = baseMessage();
    const fitted = fitChatRoomMessageFullEvent({
      eventType: "create",
      message,
    });
    expect(fitted).toEqual({ eventType: "create", message });
    expect(
      ablyPublishSize(CHAT_ROOM_MESSAGE_EVENT_NAME, fitted),
    ).toBeLessThanOrEqual(ABLY_MAX_MESSAGE_SIZE);
  });

  it("fits a Sentry-scale oversized create (was 65765 > 65536)", () => {
    // Production CORE-38: assistant persist create at 65765 bytes.
    const message = baseMessage({
      content: "x".repeat(65_200),
      metadata: {
        reasoning: [{ type: "reasoning", text: "y".repeat(400) }],
        thought_timing_ms: { start: 1, end: 2 },
      },
    });
    const oversized = { eventType: "create" as const, message };
    expect(
      ablyPublishSize(CHAT_ROOM_MESSAGE_EVENT_NAME, oversized),
    ).toBeGreaterThan(ABLY_MAX_MESSAGE_SIZE);

    const fitted = fitChatRoomMessageFullEvent(oversized);
    expect(
      ablyPublishSize(CHAT_ROOM_MESSAGE_EVENT_NAME, fitted),
    ).toBeLessThanOrEqual(ABLY_MAX_MESSAGE_SIZE);
    expect(fitted.eventType).toBe("create");
    expect(fitted.message.id).toBe(message.id);
    expect(fitted.message.roomId).toBe(message.roomId);
  });

  it("fits content alone far above the Ably limit", () => {
    const message = baseMessage({ content: "z".repeat(200_000) });
    const fitted = fitChatRoomMessageFullEvent({
      eventType: "create",
      message,
    });
    expect(
      ablyPublishSize(CHAT_ROOM_MESSAGE_EVENT_NAME, fitted),
    ).toBeLessThanOrEqual(ABLY_MAX_MESSAGE_SIZE);
    expect(fitted.message.content.length).toBeLessThan(message.content.length);
    expect(fitted.message.content.length).toBeGreaterThan(0);
  });
});
