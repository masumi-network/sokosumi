import { describe, expect, it } from "vitest";

import { makeRoom } from "./__tests__/chat-room-fixtures";
import { earlierThreadsFingerprint } from "./earlier-threads-list";
import { unreadThreadsFingerprint } from "./unread-threads-list";

function thread(id: string, unreadReplyCount: number) {
  return {
    parentMessageId: id,
    firstUnreadReplyId: `${id}r`,
    parentContent: "",
    unreadReplyCount,
    unreadMentionCount: 0,
  };
}

// The lists read Core again only when these keys move, so each must move
// whenever what the list shows could have (PR #5119 review).
describe("unreadThreadsFingerprint", () => {
  it("moves when one Thread is read and another gains a reply, the reply total level", () => {
    const before = makeRoom({
      threadUnreadCount: 2,
      unreadThreadCount: 1,
      unreadThreads: [thread("a", 2)],
    });
    const after = makeRoom({
      threadUnreadCount: 2,
      unreadThreadCount: 1,
      unreadThreads: [thread("b", 2)],
    });

    expect(unreadThreadsFingerprint([after])).not.toBe(
      unreadThreadsFingerprint([before]),
    );
  });

  it("holds while nothing unread moved, whatever else the room did", () => {
    const room = makeRoom({
      threadUnreadCount: 2,
      unreadThreadCount: 1,
      unreadThreads: [thread("a", 2)],
    });

    expect(
      unreadThreadsFingerprint([
        { ...room, updatedAt: new Date("2026-09-23T12:00:00.000Z") },
      ]),
    ).toBe(unreadThreadsFingerprint([room]));
  });
});

describe("earlierThreadsFingerprint", () => {
  it("moves on any new message, since a reply can reorder read Threads", () => {
    const room = makeRoom({});

    expect(
      earlierThreadsFingerprint([
        { ...room, updatedAt: new Date("2026-09-23T12:00:00.000Z") },
      ]),
    ).not.toBe(earlierThreadsFingerprint([room]));
  });
});
