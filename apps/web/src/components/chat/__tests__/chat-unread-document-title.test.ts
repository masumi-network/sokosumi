import { describe, expect, it } from "vitest";

import {
  formatChatUnreadDocumentTitle,
  stripChatUnreadTitlePrefix,
  sumChatRoomsUnreadAttention,
} from "../chat-unread-document-title";

describe("sumChatRoomsUnreadAttention", () => {
  it("sums unreadCount across rooms", () => {
    expect(
      sumChatRoomsUnreadAttention([
        { id: "a", unreadCount: 2 },
        { id: "b", unreadCount: 3 },
      ]),
    ).toBe(5);
  });

  it("skips the active room", () => {
    expect(
      sumChatRoomsUnreadAttention(
        [
          { id: "a", unreadCount: 2 },
          { id: "b", unreadCount: 3 },
        ],
        { activeRoomId: "a" },
      ),
    ).toBe(3);
  });

  it("counts forced-unread rooms with unreadCount 0 as 1", () => {
    expect(
      sumChatRoomsUnreadAttention([
        { id: "a", unreadCount: 0, markedUnread: true },
        { id: "b", unreadCount: 2 },
      ]),
    ).toBe(3);
  });

  it("does not double-count markedUnread when unreadCount is already > 0", () => {
    expect(
      sumChatRoomsUnreadAttention([
        { id: "a", unreadCount: 4, markedUnread: true },
      ]),
    ).toBe(4);
  });

  it("skips an active forced-unread room", () => {
    expect(
      sumChatRoomsUnreadAttention(
        [
          { id: "a", unreadCount: 0, markedUnread: true },
          { id: "b", unreadCount: 1 },
        ],
        { activeRoomId: "a" },
      ),
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
