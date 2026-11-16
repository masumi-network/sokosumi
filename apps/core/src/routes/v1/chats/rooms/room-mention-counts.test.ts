import { NotificationKind } from "@sokosumi/database";
import {
  CHAT_DIRECT_MESSAGE_MESSAGE_KEY,
  CHAT_MENTION_MESSAGE_KEY,
  CHAT_ROOM_MESSAGE_MESSAGE_KEY,
} from "@sokosumi/utils";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { getChatRoomUnreadMentionCounts } from "./room-mention-counts";

const { findPassedRowsMock } = vi.hoisted(() => ({
  findPassedRowsMock: vi.fn(),
}));

// Which rows Room last-read has passed is that module's question, tested there.
vi.mock("@/helpers/chat-thread-reply-notifications", () => ({
  findThreadReplyRowsPassedByRoomRead: (...args: unknown[]) =>
    findPassedRowsMock(...args),
}));

beforeEach(() => {
  findPassedRowsMock.mockReset().mockResolvedValue([]);
});

describe("getChatRoomUnreadMentionCounts", () => {
  it("counts complementary mention and Direct rows as one message", async () => {
    const rows = [
      { id: "mention-a", referenceId: "room-a", eventId: "message-a" },
      { id: "direct-a", referenceId: "room-a", eventId: "message-a" },
      { id: "direct-b", referenceId: "room-a", eventId: "message-b" },
    ];
    const counts = await getChatRoomUnreadMentionCounts(["room-a"], "user_1", {
      notification: {
        findMany: vi.fn().mockResolvedValue(rows),
      },
    } as never);

    expect(counts.get("room-a")).toBe(2);
  });

  it("removes both delivery rows of a passed Thread reply once", async () => {
    const rows = [
      { id: "mention-a", referenceId: "room-a", eventId: "message-a" },
      { id: "direct-a", referenceId: "room-a", eventId: "message-a" },
      { id: "mention-b", referenceId: "room-a", eventId: "message-b" },
      { id: "direct-b", referenceId: "room-a", eventId: "message-b" },
    ];
    findPassedRowsMock.mockResolvedValue(
      ["mention-a", "direct-a"].map((id) => ({
        id,
        roomId: "room-a",
        parentMessageId: "parent-a",
        replyAttentionAt: new Date("2026-09-29T08:00:00.000Z"),
      })),
    );
    const counts = await getChatRoomUnreadMentionCounts(["room-a"], "user_1", {
      notification: {
        findMany: vi.fn().mockResolvedValue(rows),
      },
    } as never);

    expect(counts.get("room-a")).toBe(1);
  });

  it("counts only the chat notifications addressed to the reader", async () => {
    const findMany = vi.fn().mockResolvedValue([]);

    await getChatRoomUnreadMentionCounts(["room-a"], "user_1", {
      notification: { findMany },
    } as never);

    const where = findMany.mock.calls[0]?.[0]?.where;

    // Every message in a room is a CHAT notification on the same room, so the
    // kind cannot keep it out. Named here, so a third chat notification cannot
    // turn the badge into an unread-message count again.
    expect(where.messageKey).toEqual({
      in: [CHAT_MENTION_MESSAGE_KEY, CHAT_DIRECT_MESSAGE_MESSAGE_KEY],
    });
    expect(where.messageKey.in).not.toContain(CHAT_ROOM_MESSAGE_MESSAGE_KEY);
  });

  it("groups unread CHAT notifications by room referenceId", async () => {
    const findMany = vi.fn().mockResolvedValue([
      { id: "a-1", referenceId: "room-a", eventId: "message-a-1" },
      { id: "a-2", referenceId: "room-a", eventId: "message-a-2" },
      { id: "b-1", referenceId: "room-b", eventId: "message-b-1" },
    ]);
    const counts = await getChatRoomUnreadMentionCounts(
      ["room-a", "room-b", "room-c"],
      "user_1",
      { notification: { findMany } } as never,
    );

    expect(findMany).toHaveBeenCalledWith({
      where: {
        userId: "user_1",
        kind: NotificationKind.CHAT,
        messageKey: {
          in: [CHAT_MENTION_MESSAGE_KEY, CHAT_DIRECT_MESSAGE_MESSAGE_KEY],
        },
        isRead: false,
        referenceId: { in: ["room-a", "room-b", "room-c"] },
      },
      select: { id: true, referenceId: true, eventId: true },
    });
    expect(counts.get("room-a")).toBe(2);
    expect(counts.get("room-b")).toBe(1);
    expect(counts.has("room-c")).toBe(false);
  });

  it("returns an empty map without querying when room ids are empty", async () => {
    const findMany = vi.fn();

    const counts = await getChatRoomUnreadMentionCounts([], "user_1", {
      notification: { findMany },
    } as never);

    expect(counts.size).toBe(0);
    expect(findMany).not.toHaveBeenCalled();
  });

  /**
   * SOK-1217. Room last-read leaves a Thread reply's row unread, because only
   * a Look reads a Thread. The badge still drops when the reader opens the
   * room past it, as it did when Room last-read cleared the row.
   */
  it("leaves out the Thread-reply rows Room last-read has passed", async () => {
    const findMany = vi.fn().mockResolvedValue([
      { id: "n-room-a", referenceId: "room-a", eventId: "message-a-1" },
      { id: "a-2", referenceId: "room-a", eventId: "message-a-2" },
      { id: "n-room-b", referenceId: "room-b", eventId: "message-b-1" },
      { id: "c-1", referenceId: "room-c", eventId: "message-c-1" },
    ]);
    findPassedRowsMock.mockResolvedValue(
      ["room-a", "room-b"].map((roomId) => ({
        id: `n-${roomId}`,
        roomId,
        parentMessageId: `parent-${roomId}`,
        replyAttentionAt: new Date("2026-09-29T08:00:00.000Z"),
      })),
    );
    const tx = { notification: { findMany } } as never;

    const counts = await getChatRoomUnreadMentionCounts(
      ["room-a", "room-b", "room-c"],
      "user_1",
      tx,
    );

    // It hands over the rows it read, so the helper does not read them again.
    expect(findPassedRowsMock).toHaveBeenCalledWith(
      ["room-a", "room-b", "room-c"],
      "user_1",
      tx,
      await findMany.mock.results[0]?.value,
    );
    expect(counts.get("room-a")).toBe(1);
    expect(counts.has("room-b")).toBe(false);
    expect(counts.get("room-c")).toBe(1);
  });
});
