import { describe, expect, it } from "vitest";

import type { ChatRoomMessage } from "@/lib/clients/generated/core";

import {
  chatRoomMessageIdEnvelopeAction,
  tombstoneChatRoomMessage,
} from "../apply-chat-room-message-id-envelope";
import type { ChatRoomMessageIdEnvelopeData } from "../schema";

function envelope(
  overrides: Partial<ChatRoomMessageIdEnvelopeData> = {},
): ChatRoomMessageIdEnvelopeData {
  return {
    eventType: "create",
    messageId: "msg-1",
    roomId: "room-1",
    parentMessageId: null,
    ...overrides,
  };
}

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
    mentions: [
      {
        id: "men-1",
        coworkerId: "cow-1",
        status: "responded",
        responseMessageId: null,
      },
    ],
    reactions: [
      {
        emoji: "👍",
        count: 1,
        reactedByCurrentUser: true,
        reactors: [{ id: "user-1", name: "Alice" }],
      },
    ],
    threadReplyCount: 0,
    threadLastReplyAt: null,
    metadata: { reasoning: [{ type: "reasoning", text: "secret" }] },
    quote: null,
    membership: null,
    unfurls: null,
    ...overrides,
  };
}

describe("chatRoomMessageIdEnvelopeAction", () => {
  it("ignores envelopes for a room that is not focused", () => {
    expect(chatRoomMessageIdEnvelopeAction(envelope(), "room-other")).toEqual({
      kind: "ignore",
    });
  });

  it("refreshes on create and update for the focused room", () => {
    expect(
      chatRoomMessageIdEnvelopeAction(
        envelope({ eventType: "create" }),
        "room-1",
      ),
    ).toEqual({ kind: "refresh" });
    expect(
      chatRoomMessageIdEnvelopeAction(
        envelope({ eventType: "update" }),
        "room-1",
      ),
    ).toEqual({ kind: "refresh" });
  });

  it("tombstones by id on delete for the focused room", () => {
    expect(
      chatRoomMessageIdEnvelopeAction(
        envelope({ eventType: "delete", parentMessageId: "parent-1" }),
        "room-1",
      ),
    ).toEqual({
      kind: "tombstone",
      messageId: "msg-1",
      parentMessageId: "parent-1",
    });
  });
});

describe("tombstoneChatRoomMessage", () => {
  it("clears body and marks deletedAt without changing id or sender", () => {
    const existing = baseMessage();
    const tombstoned = tombstoneChatRoomMessage(existing);
    expect(tombstoned.id).toBe(existing.id);
    expect(tombstoned.sender).toEqual(existing.sender);
    expect(tombstoned.content).toBe("");
    expect(tombstoned.deletedAt).toBeInstanceOf(Date);
    expect(tombstoned.metadata).toBeNull();
    expect(tombstoned.mentions).toEqual([]);
    expect(tombstoned.reactions).toEqual([]);
    expect(tombstoned.quote).toBeNull();
    expect(tombstoned.unfurls).toBeNull();
    expect(tombstoned.membership).toBeNull();
  });

  it("keeps an existing deletedAt", () => {
    const deletedAt = new Date("2026-08-01T00:00:00.000Z");
    const tombstoned = tombstoneChatRoomMessage(baseMessage({ deletedAt }));
    expect(tombstoned.deletedAt).toEqual(deletedAt);
  });
});
