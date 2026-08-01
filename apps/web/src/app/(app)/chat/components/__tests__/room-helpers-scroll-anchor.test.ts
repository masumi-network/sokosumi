import { describe, expect, it } from "vitest";

import type { ChatRoomMessage } from "@/lib/clients/generated/core";

import { roomMessageScrollAnchorKey } from "../room-helpers";

function baseMessage(
  overrides: Partial<ChatRoomMessage> &
    Pick<ChatRoomMessage, "id" | "createdAt" | "sender">,
): ChatRoomMessage {
  return {
    roomId: "room-1",
    parentMessageId: null,
    content: "hi",
    mentions: [],
    reactions: [],
    threadReplyCount: 0,
    threadLastReplyAt: null,
    metadata: null,
    quote: null,
    ...overrides,
  };
}

function userMessage(id: string): ChatRoomMessage {
  return baseMessage({
    id,
    createdAt: new Date("2026-08-01T12:00:00.000Z"),
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
  });
}

describe("roomMessageScrollAnchorKey", () => {
  it("returns null for a missing message", () => {
    expect(roomMessageScrollAnchorKey(null)).toBeNull();
    expect(roomMessageScrollAnchorKey(undefined)).toBeNull();
  });

  it("stays stable when footer chrome is unchanged", () => {
    const message = userMessage("msg-1");
    expect(roomMessageScrollAnchorKey(message)).toBe(
      roomMessageScrollAnchorKey({ ...message }),
    );
  });

  it("changes when the newest message id changes", () => {
    expect(roomMessageScrollAnchorKey(userMessage("msg-1"))).not.toBe(
      roomMessageScrollAnchorKey(userMessage("msg-2")),
    );
  });

  it("changes when a reaction is added to the same message", () => {
    const before = userMessage("msg-1");
    const after: ChatRoomMessage = {
      ...before,
      reactions: [
        {
          emoji: "👍",
          count: 1,
          reactedByCurrentUser: true,
          reactors: [],
        },
      ],
    };

    expect(roomMessageScrollAnchorKey(before)).not.toBe(
      roomMessageScrollAnchorKey(after),
    );
  });

  it("changes when a reaction count changes", () => {
    const one: ChatRoomMessage = {
      ...userMessage("msg-1"),
      reactions: [
        {
          emoji: "👍",
          count: 1,
          reactedByCurrentUser: true,
          reactors: [],
        },
      ],
    };
    const two: ChatRoomMessage = {
      ...one,
      reactions: [
        {
          emoji: "👍",
          count: 2,
          reactedByCurrentUser: true,
          reactors: [],
        },
      ],
    };

    expect(roomMessageScrollAnchorKey(one)).not.toBe(
      roomMessageScrollAnchorKey(two),
    );
  });

  it("changes when thread reply count grows", () => {
    const before = userMessage("msg-1");
    const after: ChatRoomMessage = {
      ...before,
      threadReplyCount: 1,
    };

    expect(roomMessageScrollAnchorKey(before)).not.toBe(
      roomMessageScrollAnchorKey(after),
    );
  });

  it("changes when mention badges appear", () => {
    const before = userMessage("msg-1");
    const after: ChatRoomMessage = {
      ...before,
      mentions: [
        {
          id: "mention-1",
          coworkerId: "cow-1",
          status: "pending",
          responseMessageId: null,
        },
      ],
    };

    expect(roomMessageScrollAnchorKey(before)).not.toBe(
      roomMessageScrollAnchorKey(after),
    );
  });
});
