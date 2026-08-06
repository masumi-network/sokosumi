import { describe, expect, it } from "vitest";

import {
  chatRoomMessageEventDataSchema,
  isChatRoomMessagePatchEvent,
} from "../schema";

const baseMessage = {
  id: "msg-1",
  roomId: "room-1",
  parentMessageId: null,
  content: "hello",
  createdAt: "2026-08-06T12:00:00.000Z",
  deletedAt: null,
  editedAt: null,
  sender: { type: "user" },
  mentions: [],
  reactions: [],
  threadReplyCount: 0,
  threadLastReplyAt: null,
  metadata: null,
  quote: null,
  membership: null,
  unfurls: null,
};

const fullEventTypes = ["create", "update", "delete"] as const;

describe("chatRoomMessageEventDataSchema", () => {
  it.each([...fullEventTypes])(
    "accepts eventType %s with a full message DTO",
    (eventType) => {
      const parsed = chatRoomMessageEventDataSchema.safeParse({
        eventType,
        message: baseMessage,
      });
      expect(parsed.success).toBe(true);
      if (parsed.success) {
        expect(parsed.data.eventType).toBe(eventType);
        expect(isChatRoomMessagePatchEvent(parsed.data)).toBe(false);
        if (!isChatRoomMessagePatchEvent(parsed.data)) {
          expect(parsed.data.message.id).toBe("msg-1");
        }
      }
    },
  );

  it("accepts a reaction patch envelope", () => {
    const parsed = chatRoomMessageEventDataSchema.safeParse({
      eventType: "reaction",
      messageId: "msg-1",
      roomId: "room-1",
      parentMessageId: null,
      patch: {
        reactions: [
          {
            emoji: "👍",
            count: 1,
            reactedByCurrentUser: true,
            reactors: [],
          },
        ],
      },
    });
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(isChatRoomMessagePatchEvent(parsed.data)).toBe(true);
      expect(parsed.data.eventType).toBe("reaction");
    }
  });

  it("accepts an unfurl patch envelope", () => {
    const parsed = chatRoomMessageEventDataSchema.safeParse({
      eventType: "unfurl",
      messageId: "msg-1",
      roomId: "room-1",
      parentMessageId: "parent-1",
      patch: {
        unfurls: [
          {
            url: "https://example.com",
            title: "Example",
            description: null,
            imageUrl: null,
            siteName: null,
          },
        ],
      },
    });
    expect(parsed.success).toBe(true);
  });

  it("accepts a mention_status patch envelope", () => {
    const parsed = chatRoomMessageEventDataSchema.safeParse({
      eventType: "mention_status",
      messageId: "msg-1",
      roomId: "room-1",
      parentMessageId: null,
      patch: {
        mentions: [
          {
            id: "men-1",
            coworkerId: "cow-1",
            status: "completed",
            responseMessageId: "resp-1",
          },
        ],
      },
    });
    expect(parsed.success).toBe(true);
  });

  it("rejects a full message DTO on reaction events", () => {
    const parsed = chatRoomMessageEventDataSchema.safeParse({
      eventType: "reaction",
      message: baseMessage,
    });
    expect(parsed.success).toBe(false);
  });

  it("rejects a missing eventType", () => {
    const parsed = chatRoomMessageEventDataSchema.safeParse({
      message: baseMessage,
    });
    expect(parsed.success).toBe(false);
  });

  it("rejects an invalid eventType", () => {
    const parsed = chatRoomMessageEventDataSchema.safeParse({
      eventType: "not_a_real_type",
      message: baseMessage,
    });
    expect(parsed.success).toBe(false);
  });

  it("rejects a patch missing routing keys", () => {
    const parsed = chatRoomMessageEventDataSchema.safeParse({
      eventType: "reaction",
      patch: { reactions: [] },
    });
    expect(parsed.success).toBe(false);
  });
});
