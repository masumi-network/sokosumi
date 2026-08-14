import { describe, expect, it } from "vitest";

import {
  countChatRoomsWithUnreadAttention,
  formatChatUnreadDocumentTitle,
  stripChatUnreadTitlePrefix,
} from "../chat-unread-document-title";

describe("countChatRoomsWithUnreadAttention", () => {
  it("counts rooms with unread, not message totals", () => {
    expect(
      countChatRoomsWithUnreadAttention([
        { id: "a", unreadCount: 2 },
        { id: "b", unreadCount: 3 },
      ]),
    ).toBe(2);
  });

  it("skips the active room", () => {
    expect(
      countChatRoomsWithUnreadAttention(
        [
          { id: "a", unreadCount: 2 },
          { id: "b", unreadCount: 3 },
        ],
        { activeRoomId: "a" },
      ),
    ).toBe(1);
  });

  it("counts forced-unread rooms with unreadCount 0 as one room", () => {
    expect(
      countChatRoomsWithUnreadAttention([
        { id: "a", unreadCount: 0, markedUnread: true },
        { id: "b", unreadCount: 2 },
      ]),
    ).toBe(2);
  });

  it("does not double-count markedUnread when unreadCount is already > 0", () => {
    expect(
      countChatRoomsWithUnreadAttention([
        { id: "a", unreadCount: 4, markedUnread: true },
      ]),
    ).toBe(1);
  });

  it("skips an active forced-unread room", () => {
    expect(
      countChatRoomsWithUnreadAttention(
        [
          { id: "a", unreadCount: 0, markedUnread: true },
          { id: "b", unreadCount: 1 },
        ],
        { activeRoomId: "a" },
      ),
    ).toBe(1);
  });

  it("skips muted rooms even when they have unread", () => {
    expect(
      countChatRoomsWithUnreadAttention([
        { id: "a", unreadCount: 5, mutedAt: "2026-08-03T12:00:00.000Z" },
        { id: "b", unreadCount: 1 },
        { id: "c", unreadCount: 0, markedUnread: true, mutedAt: new Date() },
      ]),
    ).toBe(1);
  });

  it("ignores rooms with no unread and not marked unread", () => {
    expect(
      countChatRoomsWithUnreadAttention([
        { id: "a", unreadCount: 0 },
        { id: "b", unreadCount: 0, mutedAt: null },
      ]),
    ).toBe(0);
  });

  it("does not count thread-only unread toward the tab title", () => {
    expect(
      countChatRoomsWithUnreadAttention([
        { id: "a", unreadCount: 0, unreadThreadReplyCount: 5 },
        { id: "b", unreadCount: 1 },
      ]),
    ).toBe(1);
  });
});

describe("stripChatUnreadTitlePrefix", () => {
  it("strips a leading (N) prefix", () => {
    expect(stripChatUnreadTitlePrefix("(3) Sokosumi")).toBe("Sokosumi");
  });

  it("leaves titles without a prefix unchanged", () => {
    expect(stripChatUnreadTitlePrefix("Sokosumi")).toBe("Sokosumi");
  });

  it("only strips a leading digit group prefix", () => {
    expect(stripChatUnreadTitlePrefix("(3) Chat (2) room")).toBe(
      "Chat (2) room",
    );
  });
});

describe("formatChatUnreadDocumentTitle", () => {
  it("prefixes when unreadTotal is greater than 0", () => {
    expect(formatChatUnreadDocumentTitle("Sokosumi", 2)).toBe("(2) Sokosumi");
  });

  it("replaces an existing unread prefix", () => {
    expect(formatChatUnreadDocumentTitle("(1) Sokosumi", 4)).toBe(
      "(4) Sokosumi",
    );
  });

  it("strips the prefix when unreadTotal is 0", () => {
    expect(formatChatUnreadDocumentTitle("(2) Sokosumi", 0)).toBe("Sokosumi");
  });

  it("leaves a clean title unchanged when unreadTotal is 0", () => {
    expect(formatChatUnreadDocumentTitle("Sokosumi", 0)).toBe("Sokosumi");
  });
});
