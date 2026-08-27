import { describe, expect, it } from "vitest";

import type { ChatRoomMessage } from "@/lib/clients/generated/core";

import { applyReplySoftDeleteToParentIfUnchanged } from "./parent-thread-preview";

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
