import { afterEach, describe, expect, it } from "vitest";

import {
  applyRoomReadOverlays,
  clearRoomReadOverlays,
  forgetRoomRead,
  rememberRoomRead,
} from "../room-read-overlay";

function room(overrides: {
  id?: string;
  updatedAt?: string;
  unreadCount?: number;
  unreadMentionCount?: number;
  markedUnread?: boolean;
}) {
  return {
    id: overrides.id ?? "room-1",
    updatedAt: overrides.updatedAt ?? "2026-08-01T12:00:00.000Z",
    unreadCount: overrides.unreadCount ?? 0,
    unreadMentionCount: overrides.unreadMentionCount ?? 0,
    markedUnread: overrides.markedUnread ?? false,
  };
}

afterEach(() => {
  clearRoomReadOverlays();
});

describe("room-read-overlay", () => {
  it("keeps a room cleared after remount with stale unread props (mobile sheet)", () => {
    // Mark-read succeeded while the sheet (and list) was unmounted.
    rememberRoomRead(
      room({
        updatedAt: "2026-08-01T12:00:00.000Z",
        unreadCount: 0,
      }),
    );

    // Remount hydrates from RSC props that still carry pre-read unread.
    const remounted = applyRoomReadOverlays([
      room({
        updatedAt: "2026-08-01T12:00:00.000Z",
        unreadCount: 4,
        unreadMentionCount: 1,
        markedUnread: true,
      }),
    ]);

    expect(remounted[0]).toMatchObject({
      unreadCount: 0,
      unreadMentionCount: 0,
      markedUnread: false,
    });
  });

  it("drops the overlay when the server reports newer room activity", () => {
    rememberRoomRead(
      room({
        updatedAt: "2026-08-01T12:00:00.000Z",
        unreadCount: 0,
      }),
    );

    const withNewMessages = applyRoomReadOverlays([
      room({
        updatedAt: "2026-08-01T12:05:00.000Z",
        unreadCount: 2,
        unreadMentionCount: 1,
      }),
    ]);

    expect(withNewMessages[0]).toMatchObject({
      unreadCount: 2,
      unreadMentionCount: 1,
    });
  });

  it("forgets the overlay when the user marks the room unread again", () => {
    rememberRoomRead(room({ unreadCount: 0 }));
    forgetRoomRead("room-1");

    const rows = applyRoomReadOverlays([
      room({ unreadCount: 0, markedUnread: true }),
    ]);

    expect(rows[0]?.markedUnread).toBe(true);
  });
});
