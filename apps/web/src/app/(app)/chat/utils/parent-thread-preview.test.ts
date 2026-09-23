import { describe, expect, it } from "vitest";

import type { ChatRoomMessage } from "@/lib/clients/generated/core";

import {
  applyReplySoftDeleteToParentIfUnchanged,
  applyReplyToParentThreadPreview,
} from "./parent-thread-preview";

function parentMessage(
  overrides: Partial<ChatRoomMessage> = {},
): ChatRoomMessage {
  return {
    id: "parent-1",
    roomId: "room-1",
    parentMessageId: null,
    content: "root",
    createdAt: new Date("2026-08-01T00:00:00.000Z"),
    deletedAt: null,
    editedAt: null,
    pinnedAt: null,
    sender: {
      type: "user",
      user: {
        id: "user-1",
        name: "Ada",
        email: "ada@example.com",
        image: null,
        presence: "online",
      },
    },
    mentions: [],
    reactions: [],
    threadReplyCount: 4,
    threadLastReplyAt: new Date("2026-08-01T02:00:00.000Z"),
    metadata: null,
    quote: null,
    membership: null,
    unfurls: null,
    ...overrides,
  };
}

function userSender(id: string): ChatRoomMessage["sender"] {
  return {
    type: "user",
    user: {
      id,
      name: id,
      email: `${id}@example.com`,
      image: null,
      presence: "offline",
    },
  };
}

function replierIds(message: ChatRoomMessage): string[] {
  return (message.threadRepliers ?? []).map((replier) =>
    replier.type === "user" ? replier.user.id : replier.type,
  );
}

describe("applyReplyToParentThreadPreview", () => {
  it("adds the first replier and bumps the count and age", () => {
    const parent = parentMessage({ threadReplyCount: 0, threadRepliers: [] });
    const reply = parentMessage({
      id: "reply-1",
      parentMessageId: "parent-1",
      sender: userSender("user-2"),
      createdAt: new Date("2026-08-01T03:00:00.000Z"),
      threadReplyCount: 0,
      threadLastReplyAt: null,
    });

    const next = applyReplyToParentThreadPreview(parent, reply);

    expect(next.threadReplyCount).toBe(1);
    expect(next.threadLastReplyAt).toEqual(reply.createdAt);
    expect(replierIds(next)).toEqual(["user-2"]);
  });

  it("appends a new replier after the ones who joined earlier", () => {
    const parent = parentMessage({
      threadReplyCount: 1,
      threadRepliers: [userSender("user-2")],
    });
    const reply = parentMessage({
      id: "reply-2",
      sender: userSender("user-3"),
      createdAt: new Date("2026-08-01T04:00:00.000Z"),
    });

    const next = applyReplyToParentThreadPreview(parent, reply);

    expect(replierIds(next)).toEqual(["user-2", "user-3"]);
  });

  it("keeps a repeat replier in place without a second face", () => {
    const parent = parentMessage({
      threadReplyCount: 2,
      threadRepliers: [userSender("user-2"), userSender("user-3")],
    });
    const reply = parentMessage({
      id: "reply-2",
      sender: userSender("user-3"),
      createdAt: new Date("2026-08-01T04:00:00.000Z"),
    });

    const next = applyReplyToParentThreadPreview(parent, reply);

    expect(next.threadReplyCount).toBe(3);
    expect(replierIds(next)).toEqual(["user-2", "user-3"]);
  });

  it("keeps the first three repliers when a fourth joins", () => {
    const parent = parentMessage({
      threadRepliers: [
        userSender("user-a"),
        userSender("user-b"),
        userSender("user-c"),
      ],
    });
    const reply = parentMessage({
      id: "reply-3",
      sender: userSender("user-d"),
      createdAt: new Date("2026-08-01T05:00:00.000Z"),
    });

    const next = applyReplyToParentThreadPreview(parent, reply);

    expect(replierIds(next)).toEqual(["user-a", "user-b", "user-c"]);
  });

  it("does not add a face for an unknown sender", () => {
    const parent = parentMessage({
      threadReplyCount: 1,
      threadRepliers: [userSender("user-2")],
    });
    const reply = parentMessage({
      id: "reply-4",
      sender: { type: "unknown" },
      createdAt: new Date("2026-08-01T06:00:00.000Z"),
    });

    const next = applyReplyToParentThreadPreview(parent, reply);

    expect(next.threadReplyCount).toBe(2);
    expect(next.threadLastReplyAt).toEqual(reply.createdAt);
    expect(replierIds(next)).toEqual(["user-2"]);
  });
});

describe("applyReplySoftDeleteToParentIfUnchanged", () => {
  it("decrements when parent still has the pre-delete count", () => {
    const parent = parentMessage({ threadReplyCount: 4 });
    const next = applyReplySoftDeleteToParentIfUnchanged(parent, "parent-1", 4);

    expect(next.threadReplyCount).toBe(3);
    expect(next.threadLastReplyAt).toEqual(parent.threadLastReplyAt);
  });

  it("no-ops when Ably already applied the server parent count", () => {
    const parent = parentMessage({ threadReplyCount: 3 });
    const next = applyReplySoftDeleteToParentIfUnchanged(parent, "parent-1", 4);

    expect(next).toBe(parent);
    expect(next.threadReplyCount).toBe(3);
  });

  it("clears threadLastReplyAt when count hits zero", () => {
    const parent = parentMessage({ threadReplyCount: 1 });
    const next = applyReplySoftDeleteToParentIfUnchanged(parent, "parent-1", 1);

    expect(next.threadReplyCount).toBe(0);
    expect(next.threadLastReplyAt).toBeNull();
  });

  it("ignores a different parent id", () => {
    const parent = parentMessage();
    const next = applyReplySoftDeleteToParentIfUnchanged(parent, "other", 4);

    expect(next).toBe(parent);
  });
});
