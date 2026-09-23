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
  listChatRoomUnreadThreads,
  listEarlierThreadsAcrossRooms,
  listUnreadThreadsAcrossRooms,
  markAllChatRoomThreadsRead,
  setChatRoomThreadMuted,
  sqlMessageAttentionAt,
} from "./room-unread";

describe("getChatRoomUnreadCounts", () => {
  it("counts top-level by room lastReadAt and participant thread replies by look baseline", async () => {
    const queryRawUnsafe = vi
      .fn()
      .mockResolvedValue([
        { roomId: "room-a", source: "channel", unreadCount: 3 },
      ]);
    const tx = { $queryRawUnsafe: queryRawUnsafe } as never;

    const counts = await getChatRoomUnreadCounts(["room-a"], "user_1", tx);

    expect(counts.get("room-a")).toEqual({ channel: 3, thread: 0, total: 3 });
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

// Tripwire, not behaviour coverage (SOK-1147). Mocked Prisma supplies its own
// rows, so nothing else would notice a refactor that dropped either gate from
// the Thread leg. Keep this to the two gates; do not grow it.
describe("getChatRoomUnreadCounts gating tripwire", () => {
  it("still gates the Thread leg by mute (ADR-0030) and Participant (ADR-0013)", async () => {
    const queryRawUnsafe = vi.fn().mockResolvedValue([]);

    await getChatRoomUnreadCounts(["room-a"], "user_1", {
      $queryRawUnsafe: queryRawUnsafe,
    } as never);

    const sql = String(queryRawUnsafe.mock.calls[0]?.[0]);
    expect(sql).toContain('thread_read."mutedAt" IS NULL');
    expect(sql).toContain('parent."senderUserId" = $2');
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

  it("leaves Group name changes out of Room unread", async () => {
    const query = vi.fn().mockResolvedValue([]);
    await getChatRoomUnreadCounts(["room-a"], "user-a", {
      $queryRawUnsafe: query,
    } as never);
    const sql = String(query.mock.calls[0]?.[0]);
    expect(sql).toContain(`message."metadata"->'groupNameChange' IS NULL`);
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

/**
 * ADR-0030: a muted Thread stops paging its Participant. The gate lives in one
 * predicate, so each query that pages a reader has to carry it. These assert
 * the predicate reached every one of them; behaviour of the join itself is
 * proved against Postgres.
 */
describe("thread mute gate", () => {
  const ROOM_ID = "550e8400-e29b-41d4-a716-446655440000";
  const USER_ID = "user_123";

  function sqlOf(run: (tx: never) => Promise<unknown>, rows: unknown[] = []) {
    const queryRawUnsafe = vi.fn().mockResolvedValue(rows);
    const tx = {
      $queryRawUnsafe: queryRawUnsafe,
      chatRoomThreadReadState: { upsert: vi.fn().mockResolvedValue({}) },
    } as never;
    return run(tx).then(() =>
      queryRawUnsafe.mock.calls.map((call) => String(call[0])),
    );
  }

  it.each([
    [
      "room unread",
      (tx: never) => getChatRoomUnreadCounts([ROOM_ID], USER_ID, tx),
    ],
    [
      "thread aggregates",
      (tx: never) => getChatRoomThreadAggregates(ROOM_ID, USER_ID, tx),
    ],
    [
      "unread thread count",
      (tx: never) => countChatRoomUnreadThreads(ROOM_ID, USER_ID, tx),
    ],
    [
      "mark all threads",
      (tx: never) => markAllChatRoomThreadsRead(ROOM_ID, USER_ID, tx),
    ],
  ])("leaves a muted thread out of %s", async (_name, run) => {
    const [sql] = await sqlOf(run);

    expect(sql).toContain('thread_read."mutedAt" IS NULL');
  });

  it.each([
    [
      "room unread",
      (tx: never) => getChatRoomUnreadCounts([ROOM_ID], USER_ID, tx),
    ],
    [
      "thread aggregates",
      (tx: never) => getChatRoomThreadAggregates(ROOM_ID, USER_ID, tx),
    ],
    [
      "unread thread count",
      (tx: never) => countChatRoomUnreadThreads(ROOM_ID, USER_ID, tx),
    ],
  ])("still pages a named reader in %s", async (_name, run) => {
    const [sql] = await sqlOf(run);

    expect(sql).toMatch(
      /OR EXISTS \(\s*SELECT 1\s*FROM "chat_room_user_mention" reply_mention/,
    );
    expect(sql).toContain('reply_mention."messageId" = reply.id');
  });

  it("keeps muted threads out of Mark all even when a reply names the reader", async () => {
    const [sql] = await sqlOf((tx: never) =>
      markAllChatRoomThreadsRead(ROOM_ID, USER_ID, tx),
    );

    expect(sql).toContain('thread_read."mutedAt" IS NULL');
    expect(sql).not.toContain('reply_mention."messageId" = reply.id');
  });

  it("reads the viewer's own mute state onto each thread", async () => {
    const [sql] = await sqlOf((tx: never) =>
      getChatRoomThreadAggregates(ROOM_ID, USER_ID, tx),
    );

    expect(sql).toContain('MAX(thread_read."mutedAt") AS "mutedAt"');
  });
});

describe("setChatRoomThreadMuted", () => {
  const ROOM_ID = "550e8400-e29b-41d4-a716-446655440000";
  const PARENT_ID = "550e8400-e29b-41d4-a716-446655440001";
  const USER_ID = "user_123";

  function txWith(
    parent: { id: string } | null,
    options: {
      state?: { lastReadAt: Date; mutedAt: Date | null } | null;
      naming?: { createdAt: Date } | null;
    } = {},
  ) {
    const findFirst = vi
      .fn()
      .mockResolvedValueOnce(parent)
      .mockResolvedValue(options.naming ?? null);
    const upsert = vi
      .fn()
      .mockImplementation(async ({ create }: { create: unknown }) => create);
    const update = vi.fn().mockResolvedValue({});
    const findUnique = vi.fn().mockResolvedValue(options.state ?? null);
    return {
      tx: {
        chatRoomMessage: { findFirst },
        chatRoomThreadReadState: { upsert, update, findUnique },
      } as never,
      findFirst,
      upsert,
      update,
      findUnique,
    };
  }

  it("mutes the thread and looks it in the same row", async () => {
    const { tx, upsert } = txWith({ id: PARENT_ID });
    const now = new Date("2026-07-02T12:00:00.000Z");

    const state = await setChatRoomThreadMuted(
      ROOM_ID,
      USER_ID,
      PARENT_ID,
      true,
      tx,
      now,
    );

    expect(state).toEqual({ parentMessageId: PARENT_ID, mutedAt: now });
    expect(upsert).toHaveBeenCalledWith({
      where: {
        userId_parentMessageId: { userId: USER_ID, parentMessageId: PARENT_ID },
      },
      update: { mutedAt: now, lastReadAt: now },
      create: {
        userId: USER_ID,
        parentMessageId: PARENT_ID,
        mutedAt: now,
        lastReadAt: now,
      },
    });
  });

  /** Repeating the mute must not step over a reply that broke through it. */
  it("writes nothing when the thread is already muted", async () => {
    const mutedAt = new Date("2026-07-02T10:00:00.000Z");
    const { tx, upsert } = txWith(
      { id: PARENT_ID },
      { state: { lastReadAt: mutedAt, mutedAt } },
    );

    const state = await setChatRoomThreadMuted(
      ROOM_ID,
      USER_ID,
      PARENT_ID,
      true,
      tx,
      new Date("2026-07-02T12:00:00.000Z"),
    );

    expect(state).toEqual({ parentMessageId: PARENT_ID, mutedAt });
    expect(upsert).not.toHaveBeenCalled();
  });

  /** Unmuting resumes from now; it does not hand back the silenced stretch. */
  it("unmutes and looks the thread, without creating a row", async () => {
    const now = new Date("2026-07-02T12:00:00.000Z");
    const { tx, upsert, update } = txWith(
      { id: PARENT_ID },
      {
        state: {
          lastReadAt: new Date("2026-07-02T10:00:00.000Z"),
          mutedAt: new Date("2026-07-02T10:00:00.000Z"),
        },
      },
    );

    const state = await setChatRoomThreadMuted(
      ROOM_ID,
      USER_ID,
      PARENT_ID,
      false,
      tx,
      now,
    );

    expect(state).toEqual({ parentMessageId: PARENT_ID, mutedAt: null });
    expect(upsert).not.toHaveBeenCalled();
    expect(update).toHaveBeenCalledWith({
      where: {
        userId_parentMessageId: { userId: USER_ID, parentMessageId: PARENT_ID },
      },
      data: { mutedAt: null, lastReadAt: now },
    });
  });

  /** A reply that named the reader was never silenced, so it stays unread. */
  it("keeps the look where mute put it when the thread named the reader", async () => {
    const lastReadAt = new Date("2026-07-02T10:00:00.000Z");
    const { tx, update } = txWith(
      { id: PARENT_ID },
      {
        state: { lastReadAt, mutedAt: lastReadAt },
        naming: { createdAt: new Date("2026-07-02T11:00:00.000Z") },
      },
    );

    await setChatRoomThreadMuted(
      ROOM_ID,
      USER_ID,
      PARENT_ID,
      false,
      tx,
      new Date("2026-07-02T12:00:00.000Z"),
    );

    expect(update).toHaveBeenCalledWith({
      where: {
        userId_parentMessageId: { userId: USER_ID, parentMessageId: PARENT_ID },
      },
      data: { mutedAt: null },
    });
  });

  it("writes nothing when the thread was not muted", async () => {
    const { tx, update, upsert } = txWith(
      { id: PARENT_ID },
      {
        state: {
          lastReadAt: new Date("2026-07-02T10:00:00.000Z"),
          mutedAt: null,
        },
      },
    );

    const state = await setChatRoomThreadMuted(
      ROOM_ID,
      USER_ID,
      PARENT_ID,
      false,
      tx,
    );

    expect(state).toEqual({ parentMessageId: PARENT_ID, mutedAt: null });
    expect(update).not.toHaveBeenCalled();
    expect(upsert).not.toHaveBeenCalled();
  });

  it("writes nothing for a parent that is not a live thread here", async () => {
    const { tx, upsert, update, findFirst } = txWith(null);

    const state = await setChatRoomThreadMuted(
      ROOM_ID,
      USER_ID,
      PARENT_ID,
      true,
      tx,
    );

    expect(state).toBeNull();
    expect(findFirst).toHaveBeenCalledWith({
      where: {
        id: PARENT_ID,
        roomId: ROOM_ID,
        parentMessageId: null,
        deletedAt: null,
        replies: { some: { deletedAt: null } },
      },
      select: { id: true },
    });
    expect(upsert).not.toHaveBeenCalled();
    expect(update).not.toHaveBeenCalled();
  });
});

describe("listUnreadThreadsAcrossRooms", () => {
  const PARENT_A = "550e8400-e29b-41d4-a716-4466554400a1";
  const PARENT_B = "550e8400-e29b-41d4-a716-4466554400b2";

  function unreadRow(roomId: string, parentMessageId: string) {
    return {
      roomId,
      parentMessageId,
      firstUnreadReplyId: `${parentMessageId}-reply`,
      parentContent: "should be vendor-wide",
      unreadReplyCount: BigInt(2),
      unreadMentionCount: BigInt(1),
      lastUnreadAt: new Date("2026-09-23T09:00:00.000Z"),
      totalThreadCount: BigInt(7),
    };
  }

  it("lists each unread Thread with its room, newest first, and states the rest", async () => {
    const queryRawUnsafe = vi
      .fn()
      .mockResolvedValue([
        unreadRow("room-a", PARENT_A),
        unreadRow("room-b", PARENT_B),
      ]);

    const page = await listUnreadThreadsAcrossRooms(
      ["room-a", "room-b"],
      "user_1",
      { $queryRawUnsafe: queryRawUnsafe } as never,
      { limit: 1 },
    );

    expect(page).toEqual({
      threads: [
        {
          roomId: "room-a",
          parentMessageId: PARENT_A,
          firstUnreadReplyId: `${PARENT_A}-reply`,
          parentContent: "should be vendor-wide",
          unreadReplyCount: 2,
          unreadMentionCount: 1,
          lastUnreadAt: new Date("2026-09-23T09:00:00.000Z"),
        },
      ],
      nextCursor: PARENT_A,
      total: 7,
    });
  });

  it("ends the list when the page holds every remaining Thread", async () => {
    const queryRawUnsafe = vi
      .fn()
      .mockResolvedValue([unreadRow("room-a", PARENT_A)]);

    const page = await listUnreadThreadsAcrossRooms(
      ["room-a"],
      "user_1",
      { $queryRawUnsafe: queryRawUnsafe } as never,
      { limit: 20 },
    );

    expect(page.threads).toHaveLength(1);
    expect(page.nextCursor).toBeNull();
  });

  it("continues after the cursor Thread", async () => {
    const queryRawUnsafe = vi.fn().mockResolvedValue([]);

    await listUnreadThreadsAcrossRooms(
      ["room-a"],
      "user_1",
      { $queryRawUnsafe: queryRawUnsafe } as never,
      { cursor: PARENT_A, limit: 20 },
    );

    expect(queryRawUnsafe.mock.calls[0]?.slice(1)).toEqual([
      "room-a",
      "user_1",
      21,
      PARENT_A,
    ]);
  });

  // A cursor Thread read since has no place left in the ranking, so its page
  // is empty. The total still counts every unread Thread (PR #5119 review).
  it("states the total even when the page after the cursor is empty", async () => {
    const queryRawUnsafe = vi.fn().mockResolvedValue([
      {
        roomId: null,
        parentMessageId: null,
        firstUnreadReplyId: null,
        parentContent: null,
        unreadReplyCount: null,
        unreadMentionCount: null,
        totalThreadCount: 5,
      },
    ]);

    const page = await listUnreadThreadsAcrossRooms(
      ["room-a"],
      "user_1",
      { $queryRawUnsafe: queryRawUnsafe } as never,
      { cursor: PARENT_A, limit: 20 },
    );

    expect(page).toEqual({ threads: [], nextCursor: null, total: 5 });
  });

  it("reads nothing when the reader is in no room", async () => {
    const queryRawUnsafe = vi.fn();

    const page = await listUnreadThreadsAcrossRooms(
      [],
      "user_1",
      { $queryRawUnsafe: queryRawUnsafe } as never,
      { limit: 20 },
    );

    expect(page).toEqual({ threads: [], nextCursor: null, total: 0 });
    expect(queryRawUnsafe).not.toHaveBeenCalled();
  });

  // Tripwire (SOK-1159): the list must stay on the fragment the room's
  // Thread unread number counts, so a Thread cannot be listed here while
  // adding nothing to that number. Keep this to the two gates.
  it("still gates by mute (ADR-0030) and Participant (ADR-0013)", async () => {
    const queryRawUnsafe = vi.fn().mockResolvedValue([]);

    await listUnreadThreadsAcrossRooms(
      ["room-a"],
      "user_1",
      { $queryRawUnsafe: queryRawUnsafe } as never,
      { limit: 20 },
    );

    const sql = String(queryRawUnsafe.mock.calls[0]?.[0]);
    expect(sql).toContain('thread_read."mutedAt" IS NULL');
    expect(sql).toContain('parent."senderUserId" = $2');
  });
});

describe("listChatRoomUnreadThreads", () => {
  it("states a room's Thread mentions past the cap, not only the listed ones", async () => {
    const queryRawUnsafe = vi.fn().mockResolvedValue([
      {
        roomId: "room-a",
        parentMessageId: "p1",
        firstUnreadReplyId: "r1",
        parentContent: "",
        unreadReplyCount: 1,
        unreadMentionCount: 0,
        unreadThreadCount: 4,
        unreadThreadMentionCount: BigInt(2),
      },
    ]);

    const byRoom = await listChatRoomUnreadThreads(["room-a"], "user_1", {
      $queryRawUnsafe: queryRawUnsafe,
    } as never);

    expect(byRoom.get("room-a")).toMatchObject({
      unreadThreadCount: 4,
      unreadThreadMentionCount: 2,
    });
  });
});

describe("listEarlierThreadsAcrossRooms", () => {
  const PARENT = "550e8400-e29b-41d4-a716-4466554400e1";
  const LAST_REPLY = "550e8400-e29b-41d4-a716-4466554400e2";
  const lastReplyAt = new Date("2026-09-23T09:00:00.000Z");

  function earlierRow(parentMessageId: string) {
    return {
      roomId: "room-a",
      parentMessageId,
      parentContent: "we support max 1GB",
      replyCount: BigInt(6),
      lastReplyAt,
      lastReplyId: LAST_REPLY,
      totalThreadCount: BigInt(9),
    };
  }

  it("lists the reader's read Threads across rooms, newest reply first, one page", async () => {
    const queryRawUnsafe = vi
      .fn()
      .mockResolvedValue([earlierRow(PARENT), earlierRow("next")]);

    const page = await listEarlierThreadsAcrossRooms(
      ["room-a"],
      "user_1",
      { $queryRawUnsafe: queryRawUnsafe } as never,
      { limit: 1 },
    );

    expect(page).toEqual({
      threads: [
        {
          roomId: "room-a",
          parentMessageId: PARENT,
          parentContent: "we support max 1GB",
          replyCount: 6,
          lastReplyAt,
          lastReplyId: LAST_REPLY,
        },
      ],
      nextCursor: PARENT,
      total: 9,
    });
  });

  it("states the total even when the page after the cursor is empty", async () => {
    const queryRawUnsafe = vi
      .fn()
      .mockResolvedValue([{ parentMessageId: null, totalThreadCount: 4 }]);

    const page = await listEarlierThreadsAcrossRooms(
      ["room-a"],
      "user_1",
      { $queryRawUnsafe: queryRawUnsafe } as never,
      { cursor: PARENT, limit: 20 },
    );

    expect(page).toEqual({ threads: [], nextCursor: null, total: 4 });
    expect(queryRawUnsafe.mock.calls[0]?.slice(-2)).toEqual([21, PARENT]);
  });

  it("reads nothing when the reader is in no room", async () => {
    const queryRawUnsafe = vi.fn();

    const page = await listEarlierThreadsAcrossRooms(
      [],
      "user_1",
      { $queryRawUnsafe: queryRawUnsafe } as never,
      { limit: 20 },
    );

    expect(page).toEqual({ threads: [], nextCursor: null, total: 0 });
    expect(queryRawUnsafe).not.toHaveBeenCalled();
  });

  // Tripwire (SOK-1159): Earlier is the reader's Participant Threads less the
  // unread ones, and the unread ones are the unread list's own fragment, so a
  // Thread is in exactly one of the two groups. Keep this to those two gates.
  it("still takes Participant (ADR-0013) and leaves out the unread fragment", async () => {
    const queryRawUnsafe = vi.fn().mockResolvedValue([]);

    await listEarlierThreadsAcrossRooms(
      ["room-a"],
      "user_1",
      { $queryRawUnsafe: queryRawUnsafe } as never,
      { limit: 20 },
    );

    const sql = String(queryRawUnsafe.mock.calls[0]?.[0]);
    expect(sql).toContain("own_reply");
    expect(sql).toContain('thread_read."mutedAt" IS NULL');
  });
});
