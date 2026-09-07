import { NotificationKind } from "@sokosumi/database";
import {
  CHAT_DIRECT_MESSAGE_MESSAGE_KEY,
  CHAT_MENTION_MESSAGE_KEY,
  CHAT_ROOM_MESSAGE_MESSAGE_KEY,
} from "@sokosumi/utils";
import { describe, expect, it, vi } from "vitest";

import {
  countChatRoomUnreadThreads,
  getChatRoomThreadAggregates,
  getChatRoomUnreadCounts,
  getChatRoomUnreadMentionCounts,
  markAllChatRoomThreadsRead,
  sqlMessageAttentionAt,
} from "./room-unread";

describe("getChatRoomUnreadCounts", () => {
  it("counts top-level by room lastReadAt and participant thread replies by look baseline", async () => {
    const queryRawUnsafe = vi
      .fn()
      .mockResolvedValue([{ roomId: "room-a", unreadCount: 3 }]);
    const tx = { $queryRawUnsafe: queryRawUnsafe } as never;

    const counts = await getChatRoomUnreadCounts(["room-a"], "user_1", tx);

    expect(counts.get("room-a")).toBe(3);
    const sql = String(queryRawUnsafe.mock.calls[0]?.[0]);
    // Top-level leg uses room lastReadAt
    expect(sql).toContain('message."parentMessageId" IS NULL');
    expect(sql).toMatch(/read_state\."lastReadAt"/);
    // Thread leg uses look baseline, not room lastReadAt
    expect(sql).toContain('thread_read."lastReadAt"');
    expect(sql).toContain('room_read."createdAt"');
    expect(sql).toContain('reply."parentMessageId" IS NOT NULL');
    expect(sql).toContain('parent."senderUserId"');
    expect(sql).toContain("chat_room_user_mention");
    expect(sql).toContain("own_reply");
    expect(sql).not.toMatch(
      /reply\."createdAt" > COALESCE\(\s*read_state\."lastReadAt"/,
    );
    expect(sql).toContain('message."deletedAt" IS NULL');
    expect(sql).toContain('reply."deletedAt" IS NULL');
  });
});

describe("getChatRoomUnreadMentionCounts", () => {
  it("counts only the chat notifications addressed to the reader", async () => {
    const groupBy = vi.fn().mockResolvedValue([]);

    await getChatRoomUnreadMentionCounts(["room-a"], "user_1", {
      notification: { groupBy },
    } as never);

    const where = groupBy.mock.calls[0]?.[0]?.where;

    // Every message in a room is a CHAT notification on the same room, so the
    // kind cannot keep it out. Named here, so a third chat notification cannot
    // turn the badge into an unread-message count again.
    expect(where.messageKey).toEqual({
      in: [CHAT_MENTION_MESSAGE_KEY, CHAT_DIRECT_MESSAGE_MESSAGE_KEY],
    });
    expect(where.messageKey.in).not.toContain(CHAT_ROOM_MESSAGE_MESSAGE_KEY);
  });

  it("groups unread CHAT notifications by room referenceId", async () => {
    const groupBy = vi.fn().mockResolvedValue([
      { referenceId: "room-a", _count: { _all: 2 } },
      { referenceId: "room-b", _count: { _all: 1 } },
    ]);

    const counts = await getChatRoomUnreadMentionCounts(
      ["room-a", "room-b", "room-c"],
      "user_1",
      { notification: { groupBy } } as never,
    );

    expect(groupBy).toHaveBeenCalledWith({
      by: ["referenceId"],
      where: {
        userId: "user_1",
        kind: NotificationKind.CHAT,
        messageKey: {
          in: [CHAT_MENTION_MESSAGE_KEY, CHAT_DIRECT_MESSAGE_MESSAGE_KEY],
        },
        isRead: false,
        referenceId: { in: ["room-a", "room-b", "room-c"] },
      },
      _count: { _all: true },
    });
    expect(counts.get("room-a")).toBe(2);
    expect(counts.get("room-b")).toBe(1);
    expect(counts.has("room-c")).toBe(false);
  });

  it("returns an empty map without querying when room ids are empty", async () => {
    const groupBy = vi.fn();

    const counts = await getChatRoomUnreadMentionCounts([], "user_1", {
      notification: { groupBy },
    } as never);

    expect(counts.size).toBe(0);
    expect(groupBy).not.toHaveBeenCalled();
  });
});

describe("getChatRoomThreadAggregates", () => {
  it("counts participant unread after dual-baseline and excludes soft-deleted/self replies", async () => {
    const queryRawUnsafe = vi.fn().mockResolvedValue([
      {
        parentMessageId: "550e8400-e29b-41d4-a716-446655440001",
        replyCount: 5,
        lastReplyAt: new Date("2026-07-02T11:00:00.000Z"),
        unreadReplyCount: 3,
        lastUnreadReplyAt: new Date("2026-07-02T12:00:00.000Z"),
        hasLooked: true,
      },
    ]);
    const tx = { $queryRawUnsafe: queryRawUnsafe } as never;

    const rows = await getChatRoomThreadAggregates(
      "550e8400-e29b-41d4-a716-446655440000",
      "user_123",
      tx,
    );

    expect(rows).toEqual([
      {
        parentMessageId: "550e8400-e29b-41d4-a716-446655440001",
        replyCount: 5,
        lastReplyAt: new Date("2026-07-02T11:00:00.000Z"),
        unreadReplyCount: 3,
        lastUnreadReplyAt: new Date("2026-07-02T12:00:00.000Z"),
        hasLooked: true,
      },
    ]);

    const sql = String(queryRawUnsafe.mock.calls[0]?.[0]);
    expect(sql).toContain("chat_room_user_mention");
    expect(sql).toContain("own_reply");
    expect(sql).toContain('parent."senderUserId"');
    expect(sql).toContain('MAX(thread_read."lastReadAt") IS NOT NULL');
    expect(sql).toContain('"hasLooked"');
    expect(sql).not.toContain('"attentionReplyCount"');
    expect(sql).toContain('room_read."createdAt"');
    expect(sql).toContain("'-infinity'::timestamp");
    expect(sql).not.toMatch(/room_read\."lastReadAt"/);
    expect(sql).toContain('reply."deletedAt" IS NULL');
    expect(sql).toContain('parent."deletedAt" IS NULL');
    expect(sql).toMatch(
      /reply\."senderUserId" IS NULL OR reply\."senderUserId" <>/,
    );
  });

  it("filters unread threads in SQL (participant dual-baseline), newest reply first", async () => {
    const queryRawUnsafe = vi.fn().mockResolvedValue([]);
    const tx = { $queryRawUnsafe: queryRawUnsafe } as never;

    await getChatRoomThreadAggregates(
      "550e8400-e29b-41d4-a716-446655440000",
      "user_123",
      tx,
      { unreadOnly: true },
    );

    const sql = String(queryRawUnsafe.mock.calls[0]?.[0]);
    expect(sql).toContain('"unreadReplyCount" >= 1');
    expect(sql).toContain(
      'ORDER BY "lastReplyAt" DESC, "parentMessageId" DESC',
    );
    expect(sql).not.toContain('"attentionReplyCount"');
    expect(sql).not.toContain('"lastUnreadReplyAt" DESC');
  });

  it("pages looked and never-looked threads by last reply, excluding unread", async () => {
    const queryRawUnsafe = vi.fn().mockResolvedValue([]);
    const tx = { $queryRawUnsafe: queryRawUnsafe } as never;

    await getChatRoomThreadAggregates(
      "550e8400-e29b-41d4-a716-446655440000",
      "user_123",
      tx,
      {
        recency: {
          cursor: "550e8400-e29b-41d4-a716-446655440099",
          limit: 50,
        },
      },
    );

    const sql = String(queryRawUnsafe.mock.calls[0]?.[0]);
    expect(sql).toContain('"unreadReplyCount" = 0');
    expect(sql).not.toContain('"attentionReplyCount"');
    expect(sql).toContain("LIMIT $4");
    expect(sql).toContain(
      'ORDER BY "lastReplyAt" DESC, "parentMessageId" DESC',
    );
    // Scalar subqueries only — no MAX(...) + p.createdAt without GROUP BY
    // (Postgres 42803 / SOKOSUMI-CORE-32).
    expect(sql).toContain('SELECT MAX(r."createdAt")');
    expect(sql).toContain('SELECT p."createdAt"');
    expect(sql).not.toMatch(/LEFT JOIN "chat_room_message" r[\s\S]*GROUP BY/i);
    expect(sql).not.toContain(
      'MAX(r."createdAt") FILTER (WHERE r."deletedAt" IS NULL)',
    );
    expect(queryRawUnsafe.mock.calls[0]?.[3]).toBe(
      "550e8400-e29b-41d4-a716-446655440099",
    );
    expect(queryRawUnsafe.mock.calls[0]?.[4]).toBe(51);
  });

  it("first recency page omits cursor baseline so null $3 never hits Postgres", async () => {
    const queryRawUnsafe = vi.fn().mockResolvedValue([]);
    const tx = { $queryRawUnsafe: queryRawUnsafe } as never;

    await getChatRoomThreadAggregates(
      "550e8400-e29b-41d4-a716-446655440000",
      "user_123",
      tx,
      {
        recency: {
          limit: 50,
        },
      },
    );

    const sql = String(queryRawUnsafe.mock.calls[0]?.[0]);
    expect(sql).toContain('"unreadReplyCount" = 0');
    expect(sql).toContain("LIMIT $3");
    expect(sql).not.toContain("$3::uuid IS NULL");
    expect(sql).not.toContain('SELECT MAX(r."createdAt")');
    expect(queryRawUnsafe.mock.calls[0]?.slice(1)).toEqual([
      "550e8400-e29b-41d4-a716-446655440000",
      "user_123",
      51,
    ]);
  });
});

describe("countChatRoomUnreadThreads", () => {
  it("counts participant unread parents without hydrating rows", async () => {
    const queryRawUnsafe = vi.fn().mockResolvedValue([{ count: 4 }]);
    const tx = { $queryRawUnsafe: queryRawUnsafe } as never;

    const count = await countChatRoomUnreadThreads(
      "550e8400-e29b-41d4-a716-446655440000",
      "user_123",
      tx,
    );

    expect(count).toBe(4);
    expect(queryRawUnsafe).toHaveBeenCalledOnce();
    const sql = String(queryRawUnsafe.mock.calls[0]?.[0]);
    expect(sql).toContain("COUNT(DISTINCT parent.id)");
    expect(sql).toContain('room_read."createdAt"');
    expect(sql).toContain("'-infinity'::timestamp");
    expect(sql).toContain('thread_read."lastReadAt"');
    expect(sql).toContain('reply."deletedAt" IS NULL');
    expect(sql).toContain('parent."deletedAt" IS NULL');
    expect(sql).toMatch(
      /reply\."senderUserId" IS NULL OR reply\."senderUserId" <>/,
    );
    expect(sql).toContain("chat_room_user_mention");
    expect(sql).toContain("own_reply");
    expect(sql).not.toContain("ORDER BY");
    expect(sql).not.toContain("LIMIT");
    expect(queryRawUnsafe.mock.calls[0]?.slice(1)).toEqual([
      "550e8400-e29b-41d4-a716-446655440000",
      "user_123",
    ]);
  });
});

describe("markAllChatRoomThreadsRead", () => {
  it("upserts looks for participant unread parents including never-looked", async () => {
    const queryRawUnsafe = vi
      .fn()
      .mockResolvedValue([
        { parentMessageId: "550e8400-e29b-41d4-a716-446655440001" },
        { parentMessageId: "550e8400-e29b-41d4-a716-446655440002" },
      ]);
    const upsert = vi.fn().mockResolvedValue({});
    const tx = {
      $queryRawUnsafe: queryRawUnsafe,
      chatRoomThreadReadState: { upsert },
    } as never;

    const marked = await markAllChatRoomThreadsRead(
      "550e8400-e29b-41d4-a716-446655440000",
      "user_123",
      tx,
    );

    expect(marked).toBe(2);
    const sql = String(queryRawUnsafe.mock.calls[0]?.[0]);
    expect(sql).toContain('room_read."createdAt"');
    expect(sql).toContain("'-infinity'::timestamp");
    expect(sql).toContain('thread_read."lastReadAt"');
    expect(sql).toContain("chat_room_user_mention");
    expect(sql).toContain("own_reply");
    expect(upsert).toHaveBeenCalledTimes(2);
  });

  it("returns 0 without upserting when no parents need a look", async () => {
    const upsert = vi.fn();
    const tx = {
      $queryRawUnsafe: vi.fn().mockResolvedValue([]),
      chatRoomThreadReadState: { upsert },
    } as never;

    await expect(
      markAllChatRoomThreadsRead(
        "550e8400-e29b-41d4-a716-446655440000",
        "user_123",
        tx,
      ),
    ).resolves.toBe(0);
    expect(upsert).not.toHaveBeenCalled();
  });
});

describe("completed reply attention", () => {
  it("uses the successful response transition without changing message identity", () => {
    const sql = sqlMessageAttentionAt("message");
    expect(sql).toContain('GREATEST(message."createdAt"');
    expect(sql).toContain('response_mention."responseMessageId" = message.id');
    expect(sql).toContain("response_mention.status = 'responded'");
    expect(sql).toContain('response_mention."updatedAt"');
    expect(sql).not.toContain("editedAt");
    expect(sql).not.toContain("metadata");
  });

  it("uses completion for both room unread legs", async () => {
    const query = vi.fn().mockResolvedValue([]);
    await getChatRoomUnreadCounts(["room-a"], "user-a", {
      $queryRawUnsafe: query,
    } as never);
    const sql = String(query.mock.calls[0]?.[0]);
    expect(sql).toContain('GREATEST(message."createdAt"');
    expect(sql).toContain('GREATEST(reply."createdAt"');
    expect(sql.match(/response_mention\.status = 'responded'/g)).toHaveLength(
      2,
    );
  });

  it("uses completion in every thread unread query while recency stays stable", async () => {
    const query = vi.fn().mockResolvedValue([]);
    const tx = { $queryRawUnsafe: query } as never;
    await getChatRoomThreadAggregates("room-a", "user-a", tx);
    await countChatRoomUnreadThreads("room-a", "user-a", tx);
    await markAllChatRoomThreadsRead("room-a", "user-a", tx);
    for (const [sql] of query.mock.calls) {
      expect(String(sql)).toContain('GREATEST(reply."createdAt"');
      expect(String(sql)).toContain("response_mention.status = 'responded'");
    }
    const aggregateSql = String(query.mock.calls[0]?.[0]);
    expect(aggregateSql).toContain('MAX(GREATEST(reply."createdAt"');
    expect(aggregateSql).toContain('MAX(reply."createdAt") AS "lastReplyAt"');
    expect(aggregateSql).toContain('ORDER BY MAX(reply."createdAt") DESC');
  });
});
