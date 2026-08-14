import { describe, expect, it } from "vitest";

import { resolveRoomAttention } from "../room-attention";

describe("resolveRoomAttention", () => {
  it("bolds unread rooms without a mention badge", () => {
    expect(
      resolveRoomAttention({
        unreadCount: 3,
        unreadMentionCount: 0,
        isActive: false,
      }),
    ).toEqual({ bold: true, badgeCount: 0 });
  });

  it("shows a mention badge only when unreadMentionCount > 0", () => {
    expect(
      resolveRoomAttention({
        unreadCount: 5,
        unreadMentionCount: 2,
        isActive: false,
      }),
    ).toEqual({ bold: true, badgeCount: 2 });
  });

  it("suppresses bold and badge when the room is active", () => {
    expect(
      resolveRoomAttention({
        unreadCount: 5,
        unreadMentionCount: 2,
        markedUnread: true,
        isActive: true,
      }),
    ).toEqual({ bold: false, badgeCount: 0 });
  });

  it("bolds forced-unread rooms even when unreadCount is 0", () => {
    expect(
      resolveRoomAttention({
        unreadCount: 0,
        unreadMentionCount: 0,
        markedUnread: true,
        isActive: false,
      }),
    ).toEqual({ bold: true, badgeCount: 0 });
  });

  it("suppresses bold and badge when the room is muted", () => {
    expect(
      resolveRoomAttention({
        unreadCount: 5,
        unreadMentionCount: 2,
        markedUnread: true,
        isMuted: true,
        isActive: false,
      }),
    ).toEqual({ bold: false, badgeCount: 0 });
  });
});
