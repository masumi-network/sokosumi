import { describe, expect, it } from "vitest";

import { appendMessage } from "@/app/chat/components/room-helpers";
import type { ChatRoomMessage } from "@/lib/clients/generated/core";

import { mergeRoomMessages } from "../merge-room-messages";

function message(
  id: string,
  createdAt: string,
  content: string,
  userId: string,
): ChatRoomMessage {
  return {
    id,
    roomId: "room-1",
    parentMessageId: null,
    content,
    createdAt: new Date(createdAt),
    editedAt: null,
    sender: {
      type: "user",
      user: {
        id: userId,
        name: userId,
        email: `${userId}@example.com`,
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
    deletedAt: null,
  };
}

/**
 * Repro for human peer latency: own sends append immediately; a peer message
 * that arrives later (missed Ably / focus-only backstop) is merged by
 * createdAt and jumps between messages already on screen.
 */
describe("live peer message ordering", () => {
  it("inserts a late peer message between already-appended own messages", () => {
    const ownFirst = message(
      "alice-1",
      "2026-08-04T12:00:01.000Z",
      "alice first",
      "alice",
    );
    const ownSecond = message(
      "alice-2",
      "2026-08-04T12:00:03.000Z",
      "alice second",
      "alice",
    );
    const peerBetween = message(
      "bob-1",
      "2026-08-04T12:00:02.000Z",
      "bob in between",
      "bob",
    );

    let state = appendMessage([], ownFirst);
    state = appendMessage(state, ownSecond);
    expect(state.map((row) => row.id)).toEqual(["alice-1", "alice-2"]);

    state = mergeRoomMessages(state, [peerBetween]);

    expect(state.map((row) => row.content)).toEqual([
      "alice first",
      "bob in between",
      "alice second",
    ]);
  });
});
