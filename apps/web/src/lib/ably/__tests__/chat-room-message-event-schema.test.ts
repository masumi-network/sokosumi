import { CHAT_ROOM_MESSAGE_EVENT_TYPES } from "@sokosumi/utils";
import { describe, expect, it } from "vitest";

import { chatRoomMessageEventDataSchema } from "../schema";

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

describe("chatRoomMessageEventDataSchema", () => {
  it.each([...CHAT_ROOM_MESSAGE_EVENT_TYPES])(
    "accepts eventType %s with a full message DTO",
    (eventType) => {
      const parsed = chatRoomMessageEventDataSchema.safeParse({
        eventType,
        message: baseMessage,
      });
      expect(parsed.success).toBe(true);
      if (parsed.success) {
        expect(parsed.data.eventType).toBe(eventType);
        expect(parsed.data.message.id).toBe("msg-1");
      }
    },
  );

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
});
