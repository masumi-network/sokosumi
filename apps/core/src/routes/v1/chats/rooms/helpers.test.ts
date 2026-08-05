import {
  CoworkerWorkspaceAccessStatus,
  MemberRole,
  NotificationKind,
} from "@sokosumi/database";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  assertChatRoomPatchAuth,
  buildDirectCoworkerRoomKey,
  buildDirectParticipantRoomKey,
  buildDirectRoomKey,
  buildDirectRoomName,
  canManageChatRoomLifecycle,
  canPermanentlyDeleteChatRoom,
  contentIncludesRoomAllMention,
  getChatRoomThreadAggregates,
  getChatRoomUnreadCounts,
  getChatRoomUnreadMentionCounts,
  mapChatRoomMessage,
  mergeChatRoomMessageMetadata,
  mergeUnfurlsIntoMessageMetadata,
  resolveMentionedCoworkerIds,
  resolveMentionedUserIds,
  resolveWorkspaceIdForChatRoom,
  validateChatCoworkerIds,
} from "./helpers";

const { workspaceFindUniqueMock, coworkerFindManyMock } = vi.hoisted(() => ({
  workspaceFindUniqueMock: vi.fn(),
  coworkerFindManyMock: vi.fn(),
}));

vi.mock("@/lib/db/prisma", () => ({
  default: {
    workspace: {
      findUnique: workspaceFindUniqueMock,
    },
    coworker: {
      findMany: coworkerFindManyMock,
    },
  },
}));

const roomCoworkers = [
  { id: "coworker_elena", name: "Elena Research", slug: "elena" },
  { id: "coworker_hannah", name: "Hannah Ops", slug: "hannah" },
];

const roomUsers = [
  { id: "user_alice", name: "Alice Smith" },
  { id: "user_bob", name: "Bob Jones" },
  { id: "user_self", name: "Self User" },
];

describe("resolveWorkspaceIdForChatRoom", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("resolves organization workspace for org rooms", async () => {
    workspaceFindUniqueMock.mockResolvedValue({ id: "ws_org" });

    await expect(
      resolveWorkspaceIdForChatRoom({
        organizationId: "org_1",
        personalUserId: "user_1",
      }),
    ).resolves.toBe("ws_org");

    expect(workspaceFindUniqueMock).toHaveBeenCalledWith({
      where: { organizationId: "org_1" },
      select: { id: true },
    });
  });

  it("resolves personal workspace for personal rooms", async () => {
    workspaceFindUniqueMock.mockResolvedValue({ id: "ws_user" });

    await expect(
      resolveWorkspaceIdForChatRoom({
        organizationId: null,
        personalUserId: "user_1",
      }),
    ).resolves.toBe("ws_user");

    expect(workspaceFindUniqueMock).toHaveBeenCalledWith({
      where: { userId: "user_1" },
      select: { id: true },
    });
  });

  it("fails closed when personal workspace is missing", async () => {
    workspaceFindUniqueMock.mockResolvedValue(null);

    await expect(
      resolveWorkspaceIdForChatRoom({
        organizationId: null,
        personalUserId: "user_1",
      }),
    ).rejects.toThrow("Personal workspace not found");
  });
});

describe("validateChatCoworkerIds", () => {
  const workspaceId = "ws_1";
  const tx = {
    coworker: { findMany: coworkerFindManyMock },
  } as never;

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("accepts empty coworker list without querying", async () => {
    await expect(validateChatCoworkerIds([], workspaceId, tx)).resolves.toEqual(
      [],
    );
    expect(coworkerFindManyMock).not.toHaveBeenCalled();
  });

  it("queries workspace usability (whitelist OR GRANTED access)", async () => {
    coworkerFindManyMock.mockResolvedValue([{ id: "cow_1" }]);

    await expect(
      validateChatCoworkerIds(["cow_1"], workspaceId, tx),
    ).resolves.toEqual(["cow_1"]);

    expect(coworkerFindManyMock).toHaveBeenCalledWith({
      where: {
        id: { in: ["cow_1"] },
        archivedAt: null,
        OR: [
          { isWhitelisted: true },
          {
            workspaceAccess: {
              some: {
                workspaceId,
                status: CoworkerWorkspaceAccessStatus.GRANTED,
              },
            },
          },
        ],
        baseURL: { not: null },
        capabilities: { has: "chat" },
      },
      select: { id: true },
    });
  });

  it("rejects coworkers not usable in the workspace", async () => {
    coworkerFindManyMock.mockResolvedValue([]);

    await expect(
      validateChatCoworkerIds(["cow_missing"], workspaceId, tx),
    ).rejects.toThrow("Room AI coworkers must be active chat coworkers");
  });
});

describe("resolveMentionedCoworkerIds", () => {
  it("resolves selected coworker IDs only when they belong to the room", () => {
    expect(
      resolveMentionedCoworkerIds({
        content: "Can someone check this?",
        explicitCoworkerIds: ["coworker_elena", "coworker_outside"],
        roomCoworkers,
      }),
    ).toEqual(["coworker_elena"]);
  });

  it("resolves coworker tokens and simple aliases from room coworkers", () => {
    expect(
      resolveMentionedCoworkerIds({
        content: "@coworker:hannah please sync with @elena",
        roomCoworkers,
      }),
    ).toEqual(["coworker_hannah", "coworker_elena"]);
  });
});

describe("resolveMentionedUserIds", () => {
  it("resolves selected user IDs only when they belong to the room", () => {
    expect(
      resolveMentionedUserIds({
        content: "Can someone check this?",
        explicitUserIds: ["user_alice", "user_outside"],
        roomUsers,
        excludeUserId: "user_self",
      }),
    ).toEqual(["user_alice"]);
  });

  it("excludes the author even when explicitly selected or tokenized", () => {
    expect(
      resolveMentionedUserIds({
        content: "@user_self:self-user please look",
        explicitUserIds: ["user_self", "user_bob"],
        roomUsers,
        excludeUserId: "user_self",
      }),
    ).toEqual(["user_bob"]);
  });

  it("resolves @userId:slug tokens and name aliases from room users", () => {
    expect(
      resolveMentionedUserIds({
        content: "@user_alice:alice-smith please sync with @bob-jones",
        roomUsers,
        excludeUserId: "user_self",
      }),
    ).toEqual(["user_alice", "user_bob"]);
  });

  it("expands @all:all to all room users except the author", () => {
    expect(
      resolveMentionedUserIds({
        content: "@all:all can someone take a look?",
        roomUsers,
        excludeUserId: "user_self",
      }).toSorted(),
    ).toEqual(["user_alice", "user_bob"].toSorted());
  });

  it("expands bare @all to all room users except the author", () => {
    expect(
      resolveMentionedUserIds({
        content: "@all please sync",
        roomUsers,
        excludeUserId: "user_self",
      }).toSorted(),
    ).toEqual(["user_alice", "user_bob"].toSorted());
  });

  it("does not expand @allison as a room-all mention", () => {
    const mentioned = resolveMentionedUserIds({
      content: "@allison can you check?",
      roomUsers: [...roomUsers, { id: "user_allison", name: "Allison Lee" }],
      excludeUserId: "user_self",
    });
    expect(mentioned).not.toContain("user_alice");
    expect(mentioned).not.toContain("user_bob");
  });

  it("does not expand case variants like @ALL", () => {
    expect(
      resolveMentionedUserIds({
        content: "@ALL please sync",
        roomUsers,
        excludeUserId: "user_self",
      }),
    ).toEqual([]);
  });

  it("merges @all expansion with explicit user ids", () => {
    expect(
      resolveMentionedUserIds({
        content: "@all:all and also hello",
        explicitUserIds: ["user_alice"],
        roomUsers,
        excludeUserId: "user_self",
      }).toSorted(),
    ).toEqual(["user_alice", "user_bob"].toSorted());
  });

  it("excludes the author from @all expansion", () => {
    const mentioned = resolveMentionedUserIds({
      content: "@all:all",
      roomUsers,
      excludeUserId: "user_self",
    });
    expect(mentioned).not.toContain("user_self");
    expect(mentioned.toSorted()).toEqual(["user_alice", "user_bob"].toSorted());
  });

  it("only returns human room user ids for @all (never coworker ids)", () => {
    const mentioned = resolveMentionedUserIds({
      content: "@all:all",
      explicitUserIds: ["coworker_elena", "all"],
      roomUsers,
      excludeUserId: "user_self",
    });
    expect(mentioned.toSorted()).toEqual(["user_alice", "user_bob"].toSorted());
    expect(mentioned).not.toContain("coworker_elena");
    expect(mentioned).not.toContain("all");
  });
});

describe("contentIncludesRoomAllMention", () => {
  it("detects persist and bare tokens with word boundaries", () => {
    expect(contentIncludesRoomAllMention("@all:all hey")).toBe(true);
    expect(contentIncludesRoomAllMention("ping @all")).toBe(true);
    expect(contentIncludesRoomAllMention("@allison")).toBe(false);
    expect(contentIncludesRoomAllMention("@all:other")).toBe(false);
    expect(contentIncludesRoomAllMention("@ALL")).toBe(false);
  });

  it("detects tokens wrapped in common markdown markers", () => {
    expect(contentIncludesRoomAllMention("**@all:all** please")).toBe(true);
    expect(contentIncludesRoomAllMention("`@all:all`")).toBe(true);
    expect(contentIncludesRoomAllMention("_@all_")).toBe(true);
    expect(contentIncludesRoomAllMention("> @all:all")).toBe(true);
  });
});

describe("buildDirectRoomKey", () => {
  it("builds the same key regardless of user order", () => {
    expect(buildDirectRoomKey("user_b", "user_a")).toBe("user_a:user_b");
    expect(buildDirectRoomKey("user_a", "user_b")).toBe("user_a:user_b");
  });

  it("builds a namespaced key for coworker direct messages", () => {
    expect(buildDirectCoworkerRoomKey("user_a", "coworker_elena")).toBe(
      "coworker:user_a:coworker_elena",
    );
  });

  it("builds stable keys for mixed participant direct messages", () => {
    expect(
      buildDirectParticipantRoomKey({
        currentUserId: "user_b",
        memberUserIds: ["user_a"],
        coworkerIds: ["coworker_elena"],
      }),
    ).toBe("direct:v2:coworker:coworker_elena:user:user_a:user:user_b");
    expect(
      buildDirectParticipantRoomKey({
        currentUserId: "user_b",
        memberUserIds: ["user_a"],
        coworkerIds: [],
      }),
    ).toBe("user_a:user_b");
  });
});

describe("buildDirectRoomName", () => {
  it("formats short direct message names", () => {
    expect(buildDirectRoomName(["Andreas", "Elena"])).toBe("Andreas, Elena");
  });

  it("compacts long direct message names", () => {
    expect(buildDirectRoomName(["Andreas", "Elena", "Hannah", "Alex"])).toBe(
      "Andreas, Elena, Hannah and 1 more",
    );
  });
});

describe("canManageChatRoomLifecycle", () => {
  it.each([
    ["owner", MemberRole.OWNER],
    ["admin", MemberRole.ADMIN],
  ] as const)("allows an organization %s", (_label, role) => {
    expect(canManageChatRoomLifecycle({ role })).toBe(true);
  });

  it("denies a creator who is only a plain member", () => {
    expect(canManageChatRoomLifecycle({ role: MemberRole.MEMBER })).toBe(false);
  });
});

describe("canPermanentlyDeleteChatRoom", () => {
  it.each([
    ["owner", MemberRole.OWNER],
    ["admin", MemberRole.ADMIN],
  ] as const)("allows an organization %s", (_label, role) => {
    expect(canPermanentlyDeleteChatRoom({ role })).toBe(true);
  });

  it("denies a plain member", () => {
    expect(canPermanentlyDeleteChatRoom({ role: MemberRole.MEMBER })).toBe(
      false,
    );
  });
});

describe("assertChatRoomPatchAuth", () => {
  it("allows a plain member to PATCH roster-only", () => {
    expect(() =>
      assertChatRoomPatchAuth({
        role: MemberRole.MEMBER,
        body: { memberUserIds: ["user_a"], coworkerIds: [] },
      }),
    ).not.toThrow();
  });

  it("rejects a plain member PATCH that touches settings", () => {
    expect(() =>
      assertChatRoomPatchAuth({
        role: MemberRole.MEMBER,
        body: { name: "Nope" },
      }),
    ).toThrow(/organization owner or admin/i);
  });

  it("allows an organization admin to PATCH settings and roster", () => {
    expect(() =>
      assertChatRoomPatchAuth({
        role: MemberRole.ADMIN,
        body: {
          name: "Ops",
          memberUserIds: ["user_a"],
          coworkerIds: [],
        },
      }),
    ).not.toThrow();
  });
});

describe("mergeChatRoomMessageMetadata", () => {
  it("sets quote without wiping other keys", () => {
    expect(
      mergeChatRoomMessageMetadata(
        { client_message_id: "c1", quote: { old: true } },
        {
          messageId: "550e8400-e29b-41d4-a716-446655440004",
          authorName: "Alice",
          snippet: "hello",
        },
      ),
    ).toEqual({
      client_message_id: "c1",
      quote: {
        messageId: "550e8400-e29b-41d4-a716-446655440004",
        authorName: "Alice",
        snippet: "hello",
      },
    });
  });

  it("returns null when empty and no quote", () => {
    expect(mergeChatRoomMessageMetadata(null, null)).toBeNull();
  });
});

describe("mergeUnfurlsIntoMessageMetadata", () => {
  const card = {
    url: "https://example.com",
    title: "Example",
    description: "Desc",
    imageUrl: "https://cdn.example/i.png",
    siteName: "Ex",
  };

  it("sets unfurls without wiping quote or membership", () => {
    expect(
      mergeUnfurlsIntoMessageMetadata(
        {
          quote: { messageId: "q1", authorName: "A", snippet: "s" },
          membership: {
            action: "joined",
            subject: { type: "user", id: "u1", name: "U" },
          },
        },
        [card],
      ),
    ).toEqual({
      quote: { messageId: "q1", authorName: "A", snippet: "s" },
      membership: {
        action: "joined",
        subject: { type: "user", id: "u1", name: "U" },
      },
      unfurls: [card],
    });
  });

  it("removes unfurls key on empty scrape while preserving quote", () => {
    expect(
      mergeUnfurlsIntoMessageMetadata(
        {
          quote: { messageId: "q1", authorName: "A", snippet: "s" },
          unfurls: [card],
        },
        [],
      ),
    ).toEqual({
      quote: { messageId: "q1", authorName: "A", snippet: "s" },
    });
  });

  it("returns null when clearing the only key", () => {
    expect(mergeUnfurlsIntoMessageMetadata({ unfurls: [card] }, [])).toBeNull();
  });
});

describe("getChatRoomUnreadCounts", () => {
  it("counts top-level by room lastReadAt and thread replies by look baseline", async () => {
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
    expect(sql).not.toMatch(
      /reply\."createdAt" > COALESCE\(\s*read_state\."lastReadAt"/,
    );
    expect(sql).toContain('message."deletedAt" IS NULL');
    expect(sql).toContain('reply."deletedAt" IS NULL');
  });
});

describe("getChatRoomUnreadMentionCounts", () => {
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

describe("mapChatRoomMessage quote", () => {
  it("promotes metadata.quote onto the DTO quote field", () => {
    const quote = {
      messageId: "550e8400-e29b-41d4-a716-446655440004",
      authorName: "Alice",
      snippet: "Earlier point",
      attachment: {
        fileName: "shot.png",
        url: "https://blob.example/shot.png",
        mediaKind: "image" as const,
      },
    };
    const mapped = mapChatRoomMessage({
      id: "550e8400-e29b-41d4-a716-446655440002",
      roomId: "550e8400-e29b-41d4-a716-446655440000",
      parentMessageId: null,
      senderUserId: "user_123",
      senderCoworkerId: null,
      content: "hello",
      createdAt: new Date("2025-01-02T00:00:00.000Z"),
      deletedAt: null,
      editedAt: null,
      metadata: { quote, client_message_id: "c1" },
      clientMessageId: null,
      responsesApiResponseId: null,
      senderUser: {
        id: "user_123",
        name: "Patrick",
        email: "patrick@example.com",
        image: null,
        sessions: [],
      },
      senderCoworker: null,
      mentionsAsSource: [],
      reactions: [],
      replies: [],
      _count: { replies: 0 },
    });

    expect(mapped.quote).toEqual(quote);
    expect(mapped.metadata).toEqual({ quote, client_message_id: "c1" });
  });

  it("soft-parses legacy quotes without attachment", () => {
    const quote = {
      messageId: "550e8400-e29b-41d4-a716-446655440004",
      authorName: "Alice",
      snippet: "Earlier point",
    };
    const mapped = mapChatRoomMessage({
      id: "550e8400-e29b-41d4-a716-446655440002",
      roomId: "550e8400-e29b-41d4-a716-446655440000",
      parentMessageId: null,
      senderUserId: "user_123",
      senderCoworkerId: null,
      content: "hello",
      createdAt: new Date("2025-01-02T00:00:00.000Z"),
      deletedAt: null,
      editedAt: null,
      metadata: { quote },
      clientMessageId: null,
      responsesApiResponseId: null,
      senderUser: {
        id: "user_123",
        name: "Patrick",
        email: "patrick@example.com",
        image: null,
        sessions: [],
      },
      senderCoworker: null,
      mentionsAsSource: [],
      reactions: [],
      replies: [],
      _count: { replies: 0 },
    });

    expect(mapped.quote).toEqual(quote);
    expect(mapped.quote).not.toHaveProperty("attachment");
  });

  it("soft-ignores malformed attachment without dropping the quote", () => {
    const mapped = mapChatRoomMessage({
      id: "550e8400-e29b-41d4-a716-446655440002",
      roomId: "550e8400-e29b-41d4-a716-446655440000",
      parentMessageId: null,
      senderUserId: "user_123",
      senderCoworkerId: null,
      content: "hello",
      createdAt: new Date("2025-01-02T00:00:00.000Z"),
      deletedAt: null,
      editedAt: null,
      metadata: {
        quote: {
          messageId: "550e8400-e29b-41d4-a716-446655440004",
          authorName: "Alice",
          snippet: "Earlier point",
          attachment: { fileName: 1 },
        },
      },
      clientMessageId: null,
      responsesApiResponseId: null,
      senderUser: {
        id: "user_123",
        name: "Patrick",
        email: "patrick@example.com",
        image: null,
        sessions: [],
      },
      senderCoworker: null,
      mentionsAsSource: [],
      reactions: [],
      replies: [],
      _count: { replies: 0 },
    });

    expect(mapped.quote).toEqual({
      messageId: "550e8400-e29b-41d4-a716-446655440004",
      authorName: "Alice",
      snippet: "Earlier point",
    });
  });

  it("returns null quote when metadata has no quote", () => {
    const mapped = mapChatRoomMessage({
      id: "550e8400-e29b-41d4-a716-446655440002",
      roomId: "550e8400-e29b-41d4-a716-446655440000",
      parentMessageId: null,
      senderUserId: null,
      senderCoworkerId: "coworker_1",
      content: "hello",
      createdAt: new Date("2025-01-02T00:00:00.000Z"),
      deletedAt: null,
      editedAt: null,
      metadata: null,
      clientMessageId: null,
      responsesApiResponseId: null,
      senderUser: null,
      senderCoworker: {
        id: "coworker_1",
        name: "Hannah",
        slug: "hannah",
        caption: null,
        image: null,
      },
      mentionsAsSource: [],
      reactions: [],
      replies: [],
      _count: { replies: 0 },
    });

    expect(mapped.quote).toBeNull();
  });

  it("redacts content and quote for soft-deleted messages", () => {
    const mapped = mapChatRoomMessage({
      id: "550e8400-e29b-41d4-a716-446655440002",
      roomId: "550e8400-e29b-41d4-a716-446655440000",
      parentMessageId: null,
      senderUserId: "user_123",
      senderCoworkerId: null,
      content: "",
      createdAt: new Date("2025-01-02T00:00:00.000Z"),
      deletedAt: new Date("2025-01-03T00:00:00.000Z"),
      editedAt: null,
      metadata: null,
      clientMessageId: null,
      responsesApiResponseId: null,
      senderUser: {
        id: "user_123",
        name: "Patrick",
        email: "patrick@example.com",
        image: null,
        sessions: [],
      },
      senderCoworker: null,
      mentionsAsSource: [],
      reactions: [
        {
          userId: "user_123",
          emoji: "👍",
          user: { id: "user_123", name: "Patrick" },
        },
      ],
      replies: [],
      _count: { replies: 2 },
    });

    expect(mapped.content).toBe("");
    expect(mapped.deletedAt).toEqual(new Date("2025-01-03T00:00:00.000Z"));
    expect(mapped.editedAt).toBeNull();
    expect(mapped.quote).toBeNull();
    expect(mapped.membership).toBeNull();
    expect(mapped.metadata).toBeNull();
    expect(mapped.reactions).toEqual([]);
    expect(mapped.threadReplyCount).toBe(2);
  });
});

describe("getChatRoomThreadAggregates", () => {
  it("queries with thread baseline independent of room lastReadAt and excludes soft-deleted/self replies", async () => {
    const queryRawUnsafe = vi.fn().mockResolvedValue([
      {
        parentMessageId: "550e8400-e29b-41d4-a716-446655440001",
        replyCount: 5,
        lastReplyAt: new Date("2026-07-02T11:00:00.000Z"),
        unreadReplyCount: 3,
        lastUnreadReplyAt: new Date("2026-07-02T12:00:00.000Z"),
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
      },
    ]);

    const sql = String(queryRawUnsafe.mock.calls[0]?.[0]);
    expect(sql).toContain('thread_read."lastReadAt"');
    expect(sql).toContain('room_read."createdAt"');
    expect(sql).toContain("'-infinity'::timestamp");
    expect(sql).not.toMatch(/room_read\."lastReadAt"/);
    expect(sql).toContain('reply."deletedAt" IS NULL');
    expect(sql).toContain('parent."deletedAt" IS NULL');
    expect(sql).toMatch(
      /reply\."senderUserId" IS NULL OR reply\."senderUserId" <>/,
    );
  });
});

describe("mapChatRoomMessage membership", () => {
  it("promotes metadata.membership onto the DTO membership field", () => {
    const membership = {
      action: "joined" as const,
      subject: { type: "user" as const, id: "user_ada", name: "Ada" },
    };
    const mapped = mapChatRoomMessage({
      id: "550e8400-e29b-41d4-a716-446655440002",
      roomId: "550e8400-e29b-41d4-a716-446655440000",
      parentMessageId: null,
      senderUserId: null,
      senderCoworkerId: null,
      content: "Ada joined",
      createdAt: new Date("2025-01-02T00:00:00.000Z"),
      deletedAt: null,
      editedAt: null,
      metadata: { membership },
      clientMessageId: null,
      responsesApiResponseId: null,
      senderUser: null,
      senderCoworker: null,
      mentionsAsSource: [],
      reactions: [],
      replies: [],
      _count: { replies: 0 },
    });

    expect(mapped.membership).toEqual(membership);
    expect(mapped.sender).toEqual({ type: "unknown" });
    expect(mapped.quote).toBeNull();
  });

  it("returns null membership when metadata has no membership", () => {
    const mapped = mapChatRoomMessage({
      id: "550e8400-e29b-41d4-a716-446655440002",
      roomId: "550e8400-e29b-41d4-a716-446655440000",
      parentMessageId: null,
      senderUserId: "user_123",
      senderCoworkerId: null,
      content: "hello",
      createdAt: new Date("2025-01-02T00:00:00.000Z"),
      deletedAt: null,
      editedAt: null,
      metadata: null,
      clientMessageId: null,
      responsesApiResponseId: null,
      senderUser: {
        id: "user_123",
        name: "Patrick",
        email: "patrick@example.com",
        image: null,
        sessions: [],
      },
      senderCoworker: null,
      mentionsAsSource: [],
      reactions: [],
      replies: [],
      _count: { replies: 0 },
    });

    expect(mapped.membership).toBeNull();
  });
});

describe("mapChatRoomMessage unfurls", () => {
  it("promotes metadata.unfurls onto the DTO unfurls field", () => {
    const unfurls = [
      {
        url: "https://example.com/a",
        title: "A",
        description: "Desc",
        imageUrl: "https://cdn.example/a.png",
        siteName: "Example",
      },
    ];
    const mapped = mapChatRoomMessage({
      id: "550e8400-e29b-41d4-a716-446655440002",
      roomId: "550e8400-e29b-41d4-a716-446655440000",
      parentMessageId: null,
      senderUserId: "user_123",
      senderCoworkerId: null,
      content: "https://example.com/a",
      createdAt: new Date("2025-01-02T00:00:00.000Z"),
      deletedAt: null,
      editedAt: null,
      metadata: { unfurls },
      clientMessageId: null,
      responsesApiResponseId: null,
      senderUser: {
        id: "user_123",
        name: "Patrick",
        email: "patrick@example.com",
        image: null,
        sessions: [],
      },
      senderCoworker: null,
      mentionsAsSource: [],
      reactions: [],
      replies: [],
      _count: { replies: 0 },
    });

    expect(mapped.unfurls).toEqual(unfurls);
  });

  it("returns null unfurls for soft-deleted messages", () => {
    const mapped = mapChatRoomMessage({
      id: "550e8400-e29b-41d4-a716-446655440002",
      roomId: "550e8400-e29b-41d4-a716-446655440000",
      parentMessageId: null,
      senderUserId: "user_123",
      senderCoworkerId: null,
      content: "gone",
      createdAt: new Date("2025-01-02T00:00:00.000Z"),
      deletedAt: new Date("2025-01-03T00:00:00.000Z"),
      editedAt: null,
      metadata: {
        unfurls: [
          {
            url: "https://example.com",
            title: "T",
            description: null,
            imageUrl: null,
            siteName: null,
          },
        ],
      },
      clientMessageId: null,
      responsesApiResponseId: null,
      senderUser: {
        id: "user_123",
        name: "Patrick",
        email: "patrick@example.com",
        image: null,
        sessions: [],
      },
      senderCoworker: null,
      mentionsAsSource: [],
      reactions: [],
      replies: [],
      _count: { replies: 0 },
    });

    expect(mapped.unfurls).toBeNull();
  });
});
