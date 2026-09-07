import { describe, expect, it } from "vitest";

import { resolveRoomAttention } from "./room-attention";

describe("resolveRoomAttention", () => {
  it("bolds unread rooms without a mention badge", () => {
    expect(
      resolveRoomAttention({
        unreadCount: 3,
        unreadMentionCount: 0,
        isActive: false,
      }),
    ).toEqual({ bold: true, badgeCount: 0, unreadTextCount: 0 });
  });

  it("shows a mention badge only when unreadMentionCount > 0", () => {
    expect(
      resolveRoomAttention({
        unreadCount: 5,
        unreadMentionCount: 2,
        isActive: false,
      }),
    ).toEqual({ bold: true, badgeCount: 2, unreadTextCount: 0 });
  });

  it("suppresses bold and badge when the room is active", () => {
    expect(
      resolveRoomAttention({
        unreadCount: 5,
        unreadMentionCount: 2,
        markedUnread: true,
        isActive: true,
      }),
    ).toEqual({ bold: false, badgeCount: 0, unreadTextCount: 0 });
  });

  it("bolds forced-unread rooms even when unreadCount is 0", () => {
    expect(
      resolveRoomAttention({
        unreadCount: 0,
        unreadMentionCount: 0,
        markedUnread: true,
        isActive: false,
      }),
    ).toEqual({ bold: true, badgeCount: 0, unreadTextCount: 0 });
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
    ).toEqual({ bold: false, badgeCount: 0, unreadTextCount: 0 });
  });

  it("reports no count when the reader has not opted in", () => {
    expect(
      resolveRoomAttention({
        unreadCount: 7,
        unreadMentionCount: 0,
        isActive: false,
      }),
    ).toEqual({ bold: true, badgeCount: 0, unreadTextCount: 0 });
  });

  it("reports the unread message count when the reader opted in", () => {
    expect(
      resolveRoomAttention({
        unreadCount: 7,
        unreadMentionCount: 0,
        isActive: false,
        showUnreadCount: true,
      }),
    ).toEqual({ bold: true, badgeCount: 0, unreadTextCount: 7 });
  });

  it("reports no count for a read room the reader opted in on", () => {
    expect(
      resolveRoomAttention({
        unreadCount: 0,
        unreadMentionCount: 0,
        isActive: false,
        showUnreadCount: true,
      }),
    ).toEqual({ bold: false, badgeCount: 0, unreadTextCount: 0 });
  });

  it("suppresses the count on a muted room the reader opted in on", () => {
    expect(
      resolveRoomAttention({
        unreadCount: 12,
        unreadMentionCount: 3,
        isMuted: true,
        isActive: false,
        showUnreadCount: true,
      }),
    ).toEqual({ bold: false, badgeCount: 0, unreadTextCount: 0 });
  });

  it("suppresses the count on the room the reader has open", () => {
    expect(
      resolveRoomAttention({
        unreadCount: 12,
        unreadMentionCount: 3,
        isActive: true,
        showUnreadCount: true,
      }),
    ).toEqual({ bold: false, badgeCount: 0, unreadTextCount: 0 });
  });

  // The regression guard for the mistake this design exists to avoid: the badge
  // keeps counting mentions and the text keeps counting messages, and turning
  // the setting on changes neither one's meaning.
  it("reports a mention and a message count side by side, each unchanged", () => {
    expect(
      resolveRoomAttention({
        unreadCount: 9,
        unreadMentionCount: 2,
        isActive: false,
        showUnreadCount: true,
      }),
    ).toEqual({ bold: true, badgeCount: 2, unreadTextCount: 9 });
  });

  it("keeps a hand-marked unread room bold with no count to show", () => {
    expect(
      resolveRoomAttention({
        unreadCount: 0,
        unreadMentionCount: 0,
        markedUnread: true,
        isActive: false,
        showUnreadCount: true,
      }),
    ).toEqual({ bold: true, badgeCount: 0, unreadTextCount: 0 });
  });

  // The row draws the count at the name's unread weight with no unbolded
  // variant, which is only safe while a visible count implies bold. Sweep the
  // whole input space that can produce one rather than trusting the reading.
  it("never reports a count to show without also reporting bold", () => {
    for (const unreadCount of [0, 1, 2, 99, 100, 1234]) {
      for (const markedUnread of [true, false]) {
        for (const isMuted of [true, false]) {
          for (const isActive of [true, false]) {
            const attention = resolveRoomAttention({
              unreadCount,
              unreadMentionCount: 0,
              markedUnread,
              isMuted,
              isActive,
              showUnreadCount: true,
            });

            if (attention.unreadTextCount > 0) {
              expect(attention.bold).toBe(true);
            }
          }
        }
      }
    }
  });
});
