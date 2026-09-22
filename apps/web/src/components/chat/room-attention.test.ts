import { describe, expect, it } from "vitest";

import {
  resolveRoomAttention,
  resolveSectionAttention,
  roomAttentionAfterRead,
} from "./room-attention";

describe("resolveRoomAttention", () => {
  it("bolds unread rooms without a mention badge", () => {
    expect(
      resolveRoomAttention({
        unreadCount: 3,
        unreadMentionCount: 0,
      }),
    ).toEqual({
      bold: true,
      badgeCount: 0,
      mentionCount: 0,
      unreadTextCount: 0,
    });
  });

  it("shows a mention badge only when unreadMentionCount > 0", () => {
    expect(
      resolveRoomAttention({
        unreadCount: 5,
        unreadMentionCount: 2,
      }),
    ).toEqual({
      bold: true,
      badgeCount: 2,
      mentionCount: 2,
      unreadTextCount: 0,
    });
  });

  it("bolds forced-unread rooms even when unreadCount is 0", () => {
    expect(
      resolveRoomAttention({
        unreadCount: 0,
        unreadMentionCount: 0,
        markedUnread: true,
      }),
    ).toEqual({
      bold: true,
      badgeCount: 0,
      mentionCount: 0,
      unreadTextCount: 0,
    });
  });

  it("suppresses bold and badge when the room is muted", () => {
    expect(
      resolveRoomAttention({
        unreadCount: 5,
        unreadMentionCount: 2,
        markedUnread: true,
        isMuted: true,
      }),
    ).toEqual({
      bold: false,
      badgeCount: 0,
      mentionCount: 0,
      unreadTextCount: 0,
    });
  });

  it("reports no count when the reader has not opted in", () => {
    expect(
      resolveRoomAttention({
        unreadCount: 7,
        unreadMentionCount: 0,
      }),
    ).toEqual({
      bold: true,
      badgeCount: 0,
      mentionCount: 0,
      unreadTextCount: 0,
    });
  });

  it("reports the unread message count when the reader opted in", () => {
    expect(
      resolveRoomAttention({
        unreadCount: 7,
        unreadMentionCount: 0,
        showUnreadCount: true,
      }),
    ).toEqual({
      bold: true,
      badgeCount: 0,
      mentionCount: 0,
      unreadTextCount: 7,
    });
  });

  it("reports no count for a read room the reader opted in on", () => {
    expect(
      resolveRoomAttention({
        unreadCount: 0,
        unreadMentionCount: 0,
        showUnreadCount: true,
      }),
    ).toEqual({
      bold: false,
      badgeCount: 0,
      mentionCount: 0,
      unreadTextCount: 0,
    });
  });

  it("suppresses the count on a muted room the reader opted in on", () => {
    expect(
      resolveRoomAttention({
        unreadCount: 12,
        unreadMentionCount: 3,
        isMuted: true,
        showUnreadCount: true,
      }),
    ).toEqual({
      bold: false,
      badgeCount: 0,
      mentionCount: 0,
      unreadTextCount: 0,
    });
  });

  // One number per row. A row that holds something addressed to the reader
  // shows that and nothing else: two numbers in two colours asked the reader
  // to work out which was which, and the badge is the one that matters. The
  // badge still counts mentions only, and bold still says there is more.
  it("lets the badge stand alone when the reader opted in to counts", () => {
    expect(
      resolveRoomAttention({
        unreadCount: 9,
        unreadMentionCount: 2,
        showUnreadCount: true,
      }),
    ).toEqual({
      bold: true,
      badgeCount: 2,
      mentionCount: 2,
      unreadTextCount: 0,
    });
  });

  it("shows the message count when nothing is addressed to the reader", () => {
    expect(
      resolveRoomAttention({
        unreadCount: 9,
        unreadMentionCount: 0,
        showUnreadCount: true,
      }),
    ).toEqual({
      bold: true,
      badgeCount: 0,
      mentionCount: 0,
      unreadTextCount: 9,
    });
  });

  it("keeps a hand-marked unread room bold with no count to show", () => {
    expect(
      resolveRoomAttention({
        unreadCount: 0,
        unreadMentionCount: 0,
        markedUnread: true,
        showUnreadCount: true,
      }),
    ).toEqual({
      bold: true,
      badgeCount: 0,
      mentionCount: 0,
      unreadTextCount: 0,
    });
  });

  // The row draws the count at the name's unread weight with no unbolded
  // variant, which is only safe while a visible count implies bold. Sweep the
  // whole input space that can produce one rather than trusting the reading.
  it("never reports a count to show without also reporting bold", () => {
    for (const unreadCount of [0, 1, 2, 99, 100, 1234]) {
      for (const markedUnread of [true, false]) {
        for (const isMuted of [true, false]) {
          const attention = resolveRoomAttention({
            unreadCount,
            unreadMentionCount: 0,
            markedUnread,
            isMuted,
            showUnreadCount: true,
          });

          if (attention.unreadTextCount > 0) {
            expect(attention.bold).toBe(true);
          }
        }
      }
    }
  });
});

// ADR-0037: Thread replies stop marking the channel. Room unread is the
// channel half alone; a User mention is the one thing in a Thread that still
// reaches the row.
describe("resolveRoomAttention with the channel half", () => {
  it("does not bold a room whose unread is all thread replies", () => {
    expect(
      resolveRoomAttention({
        unreadCount: 3,
        channelUnreadCount: 0,
        unreadMentionCount: 0,
        showUnreadCount: true,
      }),
    ).toEqual({
      bold: false,
      badgeCount: 0,
      mentionCount: 0,
      unreadTextCount: 0,
    });
  });

  // The rule that fails silently when wrong: a mention reply counts toward
  // the thread half, so bold cannot come from the channel half alone.
  it("bolds and badges a room when a thread reply mentions the reader", () => {
    expect(
      resolveRoomAttention({
        unreadCount: 1,
        channelUnreadCount: 0,
        unreadMentionCount: 1,
      }),
    ).toEqual({
      bold: true,
      badgeCount: 1,
      mentionCount: 1,
      unreadTextCount: 0,
    });
  });

  it("keeps the badge counting mentions only, beside a busy thread", () => {
    expect(
      resolveRoomAttention({
        unreadCount: 9,
        channelUnreadCount: 0,
        unreadMentionCount: 1,
      }).badgeCount,
    ).toBe(1);
  });

  it("counts only the channel half in the reader's opt-in number", () => {
    expect(
      resolveRoomAttention({
        unreadCount: 5,
        channelUnreadCount: 2,
        unreadMentionCount: 0,
        showUnreadCount: true,
      }),
    ).toEqual({
      bold: true,
      badgeCount: 0,
      mentionCount: 0,
      unreadTextCount: 2,
    });
  });

  it("shows no opt-in number for a row bold only by a thread mention", () => {
    expect(
      resolveRoomAttention({
        unreadCount: 1,
        channelUnreadCount: 0,
        unreadMentionCount: 1,
        showUnreadCount: true,
      }).unreadTextCount,
    ).toBe(0);
  });

  it("keeps a muted room silent, thread mention or not", () => {
    expect(
      resolveRoomAttention({
        unreadCount: 4,
        channelUnreadCount: 2,
        unreadMentionCount: 1,
        isMuted: true,
        showUnreadCount: true,
      }),
    ).toEqual({
      bold: false,
      badgeCount: 0,
      mentionCount: 0,
      unreadTextCount: 0,
    });
  });

  it("keeps a hand-marked unread room bold when only threads are unread", () => {
    expect(
      resolveRoomAttention({
        unreadCount: 3,
        channelUnreadCount: 0,
        unreadMentionCount: 0,
        markedUnread: true,
      }).bold,
    ).toBe(true);
  });

  it("falls back to the total when the channel half is absent", () => {
    expect(
      resolveRoomAttention({ unreadCount: 4, unreadMentionCount: 0 }).bold,
    ).toBe(true);
  });

  it("never reports a count to show without also reporting bold", () => {
    for (const channelUnreadCount of [0, 1, 99]) {
      for (const threadUnread of [0, 3]) {
        for (const unreadMentionCount of [0, 1]) {
          const attention = resolveRoomAttention({
            unreadCount: channelUnreadCount + threadUnread,
            channelUnreadCount,
            unreadMentionCount,
            showUnreadCount: true,
          });

          if (attention.unreadTextCount > 0) {
            expect(attention.bold).toBe(true);
          }
        }
      }
    }
  });
});

// A Direct of two is written to, not named: Core counts every message there
// toward the badge. So it draws no mention pill, and its number is the same
// muted count a channel shows. The badge still bolds the row and marks the
// rail, which is unchanged.
describe("resolveRoomAttention in a Direct of two", () => {
  it("draws no mention pill and shows the message count instead", () => {
    expect(
      resolveRoomAttention({
        unreadCount: 5,
        channelUnreadCount: 5,
        unreadMentionCount: 5,
        badgeCountsMentions: false,
        showUnreadCount: true,
      }),
    ).toEqual({
      bold: true,
      badgeCount: 5,
      mentionCount: 0,
      unreadTextCount: 5,
    });
  });

  it("stays bold with no number when the reader switched counts off", () => {
    expect(
      resolveRoomAttention({
        unreadCount: 5,
        channelUnreadCount: 5,
        unreadMentionCount: 5,
        badgeCountsMentions: false,
      }),
    ).toEqual({
      bold: true,
      badgeCount: 5,
      mentionCount: 0,
      unreadTextCount: 0,
    });
  });

  it("draws the mention pill everywhere else", () => {
    expect(
      resolveRoomAttention({
        unreadCount: 3,
        channelUnreadCount: 3,
        unreadMentionCount: 1,
        showUnreadCount: true,
      }),
    ).toMatchObject({ mentionCount: 1, unreadTextCount: 0 });
  });
});

describe("roomAttentionAfterRead", () => {
  it("empties the channel half and everything a read clears", () => {
    expect(
      roomAttentionAfterRead({
        unreadCount: 7,
        channelUnreadCount: 4,
        threadUnreadCount: 3,
        unreadMentionCount: 2,
        markedUnread: true,
      }),
    ).toEqual({
      // Reading a channel does not Look its Threads, so their half stays.
      unreadCount: 3,
      channelUnreadCount: 0,
      threadUnreadCount: 3,
      unreadMentionCount: 0,
      markedUnread: false,
    });
  });

  it("leaves a read room quiet on its row", () => {
    const after = roomAttentionAfterRead({
      unreadCount: 7,
      channelUnreadCount: 4,
      threadUnreadCount: 3,
      unreadMentionCount: 0,
    });

    expect(resolveRoomAttention(after).bold).toBe(false);
  });

  it("clears everything for a snapshot that predates the split", () => {
    expect(
      roomAttentionAfterRead({ unreadCount: 5, unreadMentionCount: 1 }),
    ).toEqual({
      unreadCount: 0,
      channelUnreadCount: 0,
      threadUnreadCount: 0,
      unreadMentionCount: 0,
      markedUnread: false,
    });
  });
});

describe("resolveSectionAttention", () => {
  it("holds nothing for a section whose only unread is in threads", () => {
    expect(
      resolveSectionAttention([
        { unreadCount: 3, channelUnreadCount: 0, unreadMentionCount: 0 },
      ]),
    ).toBeNull();
  });

  it("is a mention when a thread reply in the section names the reader", () => {
    expect(
      resolveSectionAttention([
        { unreadCount: 1, channelUnreadCount: 0, unreadMentionCount: 1 },
      ]),
    ).toBe("mention");
  });

  const read = { unreadCount: 0, unreadMentionCount: 0 };
  const unread = { unreadCount: 3, unreadMentionCount: 0 };
  const mentioned = { unreadCount: 1, unreadMentionCount: 1 };

  it("holds nothing when every room is read, or there are none", () => {
    expect(resolveSectionAttention([])).toBeNull();
    expect(resolveSectionAttention([read, read])).toBeNull();
  });

  it("is unread when a room is unread or marked unread", () => {
    expect(resolveSectionAttention([read, unread])).toBe("unread");
    expect(resolveSectionAttention([{ ...read, markedUnread: true }])).toBe(
      "unread",
    );
  });

  it("lets a mention win over unread, wherever it sits", () => {
    expect(resolveSectionAttention([unread, mentioned, read])).toBe("mention");
  });

  it("stays quiet for a muted room, as the room's own row does", () => {
    expect(
      resolveSectionAttention([{ ...mentioned, mutedAt: new Date() }]),
    ).toBeNull();
  });

  it("counts a pending invitation as a mention", () => {
    expect(resolveSectionAttention([], { hasPendingInvitation: true })).toBe(
      "mention",
    );
    expect(
      resolveSectionAttention([unread], { hasPendingInvitation: true }),
    ).toBe("mention");
  });
});
