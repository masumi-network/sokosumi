import { MemberRole, NotificationKind, type Prisma } from "@sokosumi/database";
import { HTTPException } from "hono/http-exception";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { buildCoworkerUsableInWorkspaceWhere } from "@/helpers/access-control";

import {
  assertChatRoomPatchAuth,
  buildDirectCoworkerRoomKey,
  buildDirectParticipantRoomKey,
  buildDirectRoomKey,
  buildDirectRoomName,
  buildDiscoverabilityFilter,
  canManageChatRoomLifecycle,
  canPermanentlyDeleteChatRoom,
  chatRoomInclude,
  chatRoomMessageInclude,
  contentIncludesRoomAllMention,
  countChatRoomUnreadThreads,
  findLiveDirectByParticipantKey,
  getChatRoomThreadAggregates,
  getChatRoomUnreadCounts,
  getChatRoomUnreadMentionCounts,
  getPeerInActiveOrganizationFlags,
  isJoinableChannelDiscoverability,
  mapChatRoom,
  mapChatRoomMessage,
  markAllChatRoomThreadsRead,
  mergeChatRoomMessageMetadata,
  requireArchivedChatRoomUserAccess,
  requireChatRoomUserAccess,
  requireChatRoomUserMembership,
  requireChatRoomUserWriteAccess,
  requireJoinableOrgChannel,
  requireRoomMemberCanInviteGuests,
  resolveMentionedCoworkerIds,
  resolveMentionedSokoBotIds,
  resolveMentionedUserIds,
  resolvePeerInActiveOrganization,
  resolveRoomQuoteSnapshot,
  resolveWorkspaceIdForChatRoom,
  usersShareExternalChannel,
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
    coworkerFindManyMock.mockResolvedValue([
      { id: "cow_1", baseURL: "https://chat.example.com" },
    ]);

    await expect(
      validateChatCoworkerIds(["cow_1"], workspaceId, tx),
    ).resolves.toEqual(["cow_1"]);

    expect(coworkerFindManyMock).toHaveBeenCalledWith({
      where: {
        id: { in: ["cow_1"] },
        sokoBotId: null,
        ...buildCoworkerUsableInWorkspaceWhere(workspaceId),
        AND: [{ baseURL: { not: null } }, { baseURL: { not: "" } }],
        capabilities: { has: "chat" },
      },
      select: { id: true, baseURL: true },
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

describe("resolveMentionedSokoBotIds", () => {
  it("matches an @sokoBot:<uuid> token in the room", () => {
    const id = "01960001-0001-7001-8001-000000000099";
    expect(
      resolveMentionedSokoBotIds({
        content: `hello @sokoBot:${id}`,
        roomSokoBots: [{ id, name: "Jarvis" }],
      }),
    ).toEqual([id]);
  });

  it("still matches a stored @orchestrator:<uuid> token", () => {
    const id = "01960001-0001-7001-8001-000000000099";
    expect(
      resolveMentionedSokoBotIds({
        content: `hello @orchestrator:${id}`,
        roomSokoBots: [{ id, name: "Jarvis" }],
      }),
    ).toEqual([id]);
  });

  it("lowercases an uppercase token", () => {
    const id = "01960001-0001-7001-8001-000000000099";
    expect(
      resolveMentionedSokoBotIds({
        content: `@SOKOBOT:${id.toUpperCase()}`,
        roomSokoBots: [{ id, name: "Jarvis" }],
      }),
    ).toEqual([id]);
  });

  it("ignores soko bots that are not in the room", () => {
    expect(
      resolveMentionedSokoBotIds({
        content: "@sokoBot:01960001-0001-7001-8001-000000000001",
        roomSokoBots: [
          { id: "01960001-0001-7001-8001-000000000099", name: "Jarvis" },
        ],
      }),
    ).toEqual([]);
  });

  it("skips a shared name alias when two room soko bots slugify the same", () => {
    expect(
      resolveMentionedSokoBotIds({
        content: "hey @soko-bot",
        roomSokoBots: [
          { id: "01960001-0001-7001-8001-000000000001", name: "Soko Bot" },
          { id: "01960001-0001-7001-8001-000000000002", name: "Soko Bot" },
        ],
      }),
    ).toEqual([]);
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
    expect(
      buildDirectParticipantRoomKey({
        currentUserId: "user_a",
        memberUserIds: [],
        coworkerIds: [],
        sokoBotIds: ["01960001-0001-7001-8001-000000000099"],
      }),
    ).toBe("sokoBot:user_a:01960001-0001-7001-8001-000000000099");
    expect(
      buildDirectParticipantRoomKey({
        currentUserId: "user_b",
        memberUserIds: ["user_a"],
        coworkerIds: [],
        sokoBotIds: ["01960001-0001-7001-8001-000000000099"],
      }),
    ).toBe(
      "direct:v2:sokoBot:01960001-0001-7001-8001-000000000099:user:user_a:user:user_b",
    );
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

describe("resolveRoomQuoteSnapshot", () => {
  it("names a quoted personal-assistant message from senderSokoBot", async () => {
    const findFirst = vi.fn().mockResolvedValue({
      id: "550e8400-e29b-41d4-a716-446655440004",
      content: "I can take this",
      metadata: null,
      senderUser: null,
      senderCoworker: null,
      senderSokoBot: { name: "Ana", user: { name: "Ada" } },
    });

    await expect(
      resolveRoomQuoteSnapshot(
        { chatRoomMessage: { findFirst } } as never,
        "room_1",
        "550e8400-e29b-41d4-a716-446655440004",
      ),
    ).resolves.toMatchObject({
      messageId: "550e8400-e29b-41d4-a716-446655440004",
      authorName: "Ana",
    });
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
      senderSokoBotId: null,
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
      },
      senderCoworker: null,
      senderSokoBot: null,
      mentionsAsSource: [],
      reactions: [],
      replies: [],
      _count: { replies: 0 },
    });

    expect(mapped.quote).toEqual(quote);
    expect(mapped.metadata).toEqual({ quote, client_message_id: "c1" });
  });

  it("keeps client_message_id in metadata for Ably create payloads", () => {
    const mapped = mapChatRoomMessage({
      id: "550e8400-e29b-41d4-a716-446655440002",
      roomId: "550e8400-e29b-41d4-a716-446655440000",
      parentMessageId: null,
      senderUserId: "user_123",
      senderCoworkerId: null,
      senderSokoBotId: null,
      content: "hello",
      createdAt: new Date("2025-01-02T00:00:00.000Z"),
      deletedAt: null,
      editedAt: null,
      metadata: { client_message_id: "turn-1" },
      clientMessageId: "turn-1",
      responsesApiResponseId: null,
      senderUser: {
        id: "user_123",
        name: "Patrick",
        email: "patrick@example.com",
        image: null,
      },
      senderCoworker: null,
      senderSokoBot: null,
      mentionsAsSource: [],
      reactions: [],
      replies: [],
      _count: { replies: 0 },
    });

    expect(mapped.metadata).toEqual({ client_message_id: "turn-1" });
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
      senderSokoBotId: null,
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
      },
      senderCoworker: null,
      senderSokoBot: null,
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
      senderSokoBotId: null,
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
      },
      senderCoworker: null,
      senderSokoBot: null,
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
      senderSokoBotId: null,
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
      senderSokoBot: null,
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
      senderSokoBotId: null,
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
      },
      senderCoworker: null,
      senderSokoBot: null,
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

describe("chatRoomMessageInclude thread reply aggregates", () => {
  it("excludes soft-deleted replies from threadReplyCount and last-reply preview", () => {
    // Soft-deleted replies must not inflate "N replies" on the parent
    // (matches getChatRoomThreadAggregates reply."deletedAt" IS NULL).
    expect(chatRoomMessageInclude._count.select.replies).toEqual({
      where: { deletedAt: null },
    });
    expect(chatRoomMessageInclude.replies.where).toEqual({
      deletedAt: null,
    });
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
      senderSokoBotId: null,
      content: "Ada joined",
      createdAt: new Date("2025-01-02T00:00:00.000Z"),
      deletedAt: null,
      editedAt: null,
      metadata: { membership },
      clientMessageId: null,
      responsesApiResponseId: null,
      senderUser: null,
      senderCoworker: null,
      senderSokoBot: null,
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
      senderSokoBotId: null,
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
      },
      senderCoworker: null,
      senderSokoBot: null,
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
      senderSokoBotId: null,
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
      },
      senderCoworker: null,
      senderSokoBot: null,
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
      senderSokoBotId: null,
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
      },
      senderCoworker: null,
      senderSokoBot: null,
      mentionsAsSource: [],
      reactions: [],
      replies: [],
      _count: { replies: 0 },
    });

    expect(mapped.unfurls).toBeNull();
  });

  it("omits unfurls whose URLs were removed by the author", () => {
    const mapped = mapChatRoomMessage({
      id: "550e8400-e29b-41d4-a716-446655440002",
      roomId: "550e8400-e29b-41d4-a716-446655440000",
      parentMessageId: null,
      senderUserId: "user_123",
      senderCoworkerId: null,
      senderSokoBotId: null,
      content: "https://ably.com https://resend.com",
      createdAt: new Date("2025-01-02T00:00:00.000Z"),
      deletedAt: null,
      editedAt: null,
      metadata: {
        unfurls: [
          {
            url: "https://ably.com",
            title: "Ably",
            description: null,
            imageUrl: null,
            siteName: "Ably",
          },
          {
            url: "https://resend.com",
            title: "Resend",
            description: null,
            imageUrl: null,
            siteName: "Resend",
          },
        ],
        removedUnfurlUrls: ["https://ably.com"],
      },
      clientMessageId: null,
      responsesApiResponseId: null,
      senderUser: {
        id: "user_123",
        name: "Patrick",
        email: "patrick@example.com",
        image: null,
      },
      senderCoworker: null,
      senderSokoBot: null,
      mentionsAsSource: [],
      reactions: [],
      replies: [],
      _count: { replies: 0 },
    });

    expect(mapped.unfurls).toEqual([
      {
        url: "https://resend.com",
        title: "Resend",
        description: null,
        imageUrl: null,
        siteName: "Resend",
      },
    ]);
    expect(mapped.metadata).not.toHaveProperty("removedUnfurlUrls");
    expect(mapped.metadata?.unfurls).toEqual(mapped.unfurls);
  });
});

const ROOM_ID = "550e8400-e29b-41d4-a716-446655440099";
const ORG_ID = "org_host";
const GUEST_ID = "user_guest";
const MEMBER_ID = "user_member";

function createAccessTx() {
  return {
    chatRoom: {
      findFirst: vi.fn(),
    },
    chatRoomUserMember: {
      findUnique: vi.fn(),
    },
    organization: {
      findUnique: vi.fn(),
    },
    member: {
      findUnique: vi.fn(),
    },
  } as unknown as Prisma.TransactionClient;
}

function createRoomMembership(
  userId: string,
  access: "member" | "guest",
  overrides: Record<string, unknown> = {},
) {
  return {
    id: `cum_${userId}`,
    roomId: ROOM_ID,
    userId,
    access,
    starredAt: null,
    mutedAt: null,
    createdAt: new Date("2025-01-01T00:00:00.000Z"),
    user: {
      id: userId,
      name: userId === GUEST_ID ? "Guest User" : "Org Member",
      email: `${userId}@example.com`,
      image: null,
      sessions: [],
    },
    ...overrides,
  };
}

function createExternalRoom(
  memberships: Array<ReturnType<typeof createRoomMembership>>,
  overrides: Record<string, unknown> = {},
) {
  return {
    id: ROOM_ID,
    organizationId: ORG_ID,
    name: "External Client",
    slug: "external-client",
    kind: "channel",
    directKey: null,
    topic: null,
    discoverability: "external",
    createdByUserId: MEMBER_ID,
    createdAt: new Date("2025-01-01T00:00:00.000Z"),
    updatedAt: new Date("2025-01-01T00:00:00.000Z"),
    archivedAt: null,
    providerConversationId: null,
    userMembers: memberships,
    coworkerMembers: [],
    sokoBotMembers: [],
    ...overrides,
  };
}

describe("mapChatRoom guest-aware DTO fields", () => {
  it("maps discoverability external and myAccess guest from membership", () => {
    const room = createExternalRoom([
      createRoomMembership(GUEST_ID, "guest"),
      createRoomMembership(MEMBER_ID, "member"),
    ]);

    const mapped = mapChatRoom(room as never, GUEST_ID, {
      organizationName: "Acme Host",
    });

    expect(mapped.discoverability).toBe("external");
    expect(mapped.myAccess).toBe("guest");
    expect(mapped.organizationName).toBe("Acme Host");
  });

  it("defaults myAccess to member when membership access missing", () => {
    const room = createExternalRoom([
      createRoomMembership(MEMBER_ID, "member"),
    ]);
    const mapped = mapChatRoom(room as never, MEMBER_ID);
    expect(mapped.myAccess).toBe("member");
    expect(mapped.organizationName).toBeNull();
  });

  it("maps private for non-public non-external non-matched channel discoverability", () => {
    const room = createExternalRoom(
      [createRoomMembership(MEMBER_ID, "member")],
      { discoverability: "private" },
    );
    expect(mapChatRoom(room as never, MEMBER_ID).discoverability).toBe(
      "private",
    );
  });

  it("maps matched discoverability for org-less matched channels", () => {
    const room = createExternalRoom(
      [createRoomMembership(MEMBER_ID, "member")],
      { discoverability: "matched", organizationId: null },
    );
    expect(mapChatRoom(room as never, MEMBER_ID).discoverability).toBe(
      "matched",
    );
  });

  it("maps null discoverability for direct rooms", () => {
    const room = createExternalRoom(
      [createRoomMembership(MEMBER_ID, "member")],
      { kind: "direct", discoverability: null, organizationId: null },
    );
    expect(mapChatRoom(room as never, MEMBER_ID).discoverability).toBeNull();
  });
});

describe("findLiveDirectByParticipantKey", () => {
  const DIRECT_KEY = "direct:v2:user:member-1:user:guest-1";

  it("returns the Personal Direct and skips the org lookup", async () => {
    const personal = { id: "personal-dm", organizationId: null };
    const findFirst = vi.fn().mockResolvedValueOnce(personal);
    const tx = {
      chatRoom: { findFirst },
    } as unknown as Prisma.TransactionClient;

    await expect(
      findLiveDirectByParticipantKey(tx, DIRECT_KEY, ORG_ID),
    ).resolves.toEqual(personal);
    expect(findFirst).toHaveBeenCalledOnce();
    expect(findFirst).toHaveBeenCalledWith({
      where: {
        organizationId: null,
        directKey: DIRECT_KEY,
        archivedAt: null,
      },
      include: chatRoomInclude,
    });
  });

  it("returns null when neither Personal nor Org Direct exists", async () => {
    const findFirst = vi.fn().mockResolvedValue(null);
    const tx = {
      chatRoom: { findFirst },
    } as unknown as Prisma.TransactionClient;

    await expect(
      findLiveDirectByParticipantKey(tx, DIRECT_KEY, ORG_ID),
    ).resolves.toBeNull();
    expect(findFirst).toHaveBeenCalledTimes(2);
  });

  it("returns null without an org lookup when there is no Personal Direct and no org", async () => {
    const findFirst = vi.fn().mockResolvedValue(null);
    const tx = {
      chatRoom: { findFirst },
    } as unknown as Prisma.TransactionClient;

    await expect(
      findLiveDirectByParticipantKey(tx, DIRECT_KEY, null),
    ).resolves.toBeNull();
    expect(findFirst).toHaveBeenCalledOnce();
  });
});

describe("usersShareExternalChannel", () => {
  it("requires both humans on the same unarchived external channel", async () => {
    const findFirst = vi.fn().mockResolvedValue({ id: ROOM_ID });
    const tx = {
      chatRoom: { findFirst },
    } as unknown as Prisma.TransactionClient;

    await expect(
      usersShareExternalChannel(MEMBER_ID, GUEST_ID, tx),
    ).resolves.toBe(true);
    expect(findFirst).toHaveBeenCalledWith({
      where: {
        kind: "channel",
        discoverability: "external",
        archivedAt: null,
        AND: [
          { userMembers: { some: { userId: MEMBER_ID } } },
          { userMembers: { some: { userId: GUEST_ID } } },
        ],
      },
      select: { id: true },
    });
  });

  it("is false when no shared unarchived external channel exists", async () => {
    const findFirst = vi.fn().mockResolvedValue(null);
    const tx = {
      chatRoom: { findFirst },
    } as unknown as Prisma.TransactionClient;

    await expect(
      usersShareExternalChannel(MEMBER_ID, GUEST_ID, tx),
    ).resolves.toBe(false);
  });
});

describe("resolvePeerInActiveOrganization", () => {
  it("is false for Org Directs without a member lookup", async () => {
    const orgDirect = createExternalRoom(
      [
        createRoomMembership(MEMBER_ID, "member"),
        createRoomMembership(GUEST_ID, "member"),
      ],
      {
        id: "org-dm",
        kind: "direct",
        discoverability: null,
        organizationId: ORG_ID,
      },
    );
    const findMany = vi.fn();
    const tx = {
      member: { findMany },
    } as unknown as Prisma.TransactionClient;

    await expect(
      resolvePeerInActiveOrganization(
        orgDirect as never,
        MEMBER_ID,
        ORG_ID,
        tx,
      ),
    ).resolves.toBe(false);
    expect(findMany).not.toHaveBeenCalled();
  });
});

describe("getPeerInActiveOrganizationFlags", () => {
  const personalDirect = createExternalRoom(
    [
      createRoomMembership(MEMBER_ID, "member"),
      createRoomMembership(GUEST_ID, "member"),
    ],
    {
      id: "personal-dm",
      kind: "direct",
      discoverability: null,
      organizationId: null,
    },
  );

  it("is true when the other human is an org Member", async () => {
    const findMany = vi.fn().mockResolvedValue([{ userId: GUEST_ID }]);
    const tx = {
      member: { findMany },
    } as unknown as Prisma.TransactionClient;

    const flags = await getPeerInActiveOrganizationFlags(
      [personalDirect as never],
      MEMBER_ID,
      ORG_ID,
      tx,
    );

    expect(flags.get("personal-dm")).toBe(true);
    expect(findMany).toHaveBeenCalledWith({
      where: {
        organizationId: ORG_ID,
        userId: { in: [GUEST_ID] },
      },
      select: { userId: true },
    });
  });

  it("is false when the other human is not an org Member", async () => {
    const findMany = vi.fn().mockResolvedValue([]);
    const tx = {
      member: { findMany },
    } as unknown as Prisma.TransactionClient;

    const flags = await getPeerInActiveOrganizationFlags(
      [personalDirect as never],
      MEMBER_ID,
      ORG_ID,
      tx,
    );

    expect(flags.get("personal-dm")).toBe(false);
  });
});

describe("requireChatRoomUserAccess guest gate", () => {
  it("allows guest membership without host org membership", async () => {
    const tx = createAccessTx();
    const room = createExternalRoom([createRoomMembership(GUEST_ID, "guest")]);
    vi.mocked(tx.chatRoom.findFirst).mockResolvedValueOnce(room as never);
    // Guest is NOT an org member — org lookup would fail if called.
    vi.mocked(tx.organization.findUnique).mockResolvedValueOnce({
      id: ORG_ID,
      name: "Host",
    } as never);
    vi.mocked(tx.member.findUnique).mockResolvedValueOnce(null);

    const result = await requireChatRoomUserAccess(ROOM_ID, GUEST_ID, tx);

    expect(result.id).toBe(ROOM_ID);
    expect(tx.member.findUnique).not.toHaveBeenCalled();
  });

  it("still requires host org membership for access=member", async () => {
    const tx = createAccessTx();
    const room = createExternalRoom([
      createRoomMembership(MEMBER_ID, "member"),
    ]);
    vi.mocked(tx.chatRoom.findFirst).mockResolvedValueOnce(room as never);
    vi.mocked(tx.organization.findUnique).mockResolvedValueOnce({
      id: ORG_ID,
      name: "Host",
    } as never);
    vi.mocked(tx.member.findUnique).mockResolvedValueOnce(null);

    await expect(
      requireChatRoomUserAccess(ROOM_ID, MEMBER_ID, tx),
    ).rejects.toSatisfy(
      (error: unknown) =>
        error instanceof HTTPException &&
        error.status === 403 &&
        error.message === "You are not a member of this organization",
    );
  });

  it("allows access=member when host org membership exists", async () => {
    const tx = createAccessTx();
    const room = createExternalRoom([
      createRoomMembership(MEMBER_ID, "member"),
    ]);
    vi.mocked(tx.chatRoom.findFirst).mockResolvedValueOnce(room as never);
    vi.mocked(tx.organization.findUnique).mockResolvedValueOnce({
      id: ORG_ID,
      name: "Host",
    } as never);
    vi.mocked(tx.member.findUnique).mockResolvedValueOnce({
      id: "mem_1",
      role: MemberRole.MEMBER,
      userId: MEMBER_ID,
      organizationId: ORG_ID,
    } as never);

    const result = await requireChatRoomUserAccess(ROOM_ID, MEMBER_ID, tx);
    expect(result.id).toBe(ROOM_ID);
    expect(tx.member.findUnique).toHaveBeenCalled();
  });
});

describe("requireChatRoomUserWriteAccess guest gate", () => {
  it("allows guest write access without host org membership", async () => {
    const tx = createAccessTx();
    vi.mocked(tx.chatRoom.findFirst).mockResolvedValueOnce({
      id: ROOM_ID,
      name: "External Client",
      organizationId: ORG_ID,
      slug: "external-client",
      kind: "channel",
      providerConversationId: null,
      userMembers: [{ userId: GUEST_ID, access: "guest", user: { name: "G" } }],
      coworkerMembers: [],
      sokoBotMembers: [],
    } as never);
    vi.mocked(tx.organization.findUnique).mockResolvedValueOnce({
      id: ORG_ID,
    } as never);
    vi.mocked(tx.member.findUnique).mockResolvedValueOnce(null);

    const result = await requireChatRoomUserWriteAccess(ROOM_ID, GUEST_ID, tx);
    expect(result.id).toBe(ROOM_ID);
    expect(tx.member.findUnique).not.toHaveBeenCalled();
  });
});

describe("requireChatRoomUserMembership guest gate", () => {
  it("allows guest membership without host org membership", async () => {
    const tx = createAccessTx();
    vi.mocked(tx.chatRoom.findFirst).mockResolvedValueOnce({
      id: ROOM_ID,
      organizationId: ORG_ID,
      userMembers: [{ access: "guest" }],
    } as never);
    vi.mocked(tx.member.findUnique).mockResolvedValueOnce(null);

    const result = await requireChatRoomUserMembership(ROOM_ID, GUEST_ID, tx);
    expect(result.id).toBe(ROOM_ID);
    expect(tx.member.findUnique).not.toHaveBeenCalled();
  });
});

describe("requireArchivedChatRoomUserAccess guest gate", () => {
  it("allows guest access on archived external rooms without org membership", async () => {
    const tx = createAccessTx();
    const room = createExternalRoom([createRoomMembership(GUEST_ID, "guest")], {
      archivedAt: new Date("2025-02-01T00:00:00.000Z"),
    });
    vi.mocked(tx.chatRoom.findFirst).mockResolvedValueOnce(room as never);
    vi.mocked(tx.member.findUnique).mockResolvedValueOnce(null);

    const result = await requireArchivedChatRoomUserAccess(
      ROOM_ID,
      GUEST_ID,
      tx,
    );
    expect(result.id).toBe(ROOM_ID);
    expect(tx.member.findUnique).not.toHaveBeenCalled();
  });
});

describe("isJoinableChannelDiscoverability", () => {
  it("allows public and external for every caller", () => {
    expect(isJoinableChannelDiscoverability("public", false)).toBe(true);
    expect(isJoinableChannelDiscoverability("external", false)).toBe(true);
    expect(isJoinableChannelDiscoverability("public", true)).toBe(true);
    expect(isJoinableChannelDiscoverability("external", true)).toBe(true);
  });

  it("allows private only when elevated", () => {
    expect(isJoinableChannelDiscoverability("private", false)).toBe(false);
    expect(isJoinableChannelDiscoverability("private", true)).toBe(true);
  });

  it("rejects null or unknown discoverability", () => {
    expect(isJoinableChannelDiscoverability(null, true)).toBe(false);
    expect(isJoinableChannelDiscoverability("weird", true)).toBe(false);
  });
});

describe("buildDiscoverabilityFilter", () => {
  it("returns public+external for plain members", () => {
    expect(buildDiscoverabilityFilter(false)).toEqual({
      in: ["public", "external"],
    });
  });

  it("returns public+private+external for elevated callers", () => {
    expect(buildDiscoverabilityFilter(true)).toEqual({
      in: ["public", "private", "external"],
    });
  });
});

describe("requireJoinableOrgChannel", () => {
  it("allows public and external discoverability for host-org members", async () => {
    const tx = createAccessTx();
    vi.mocked(tx.organization.findUnique).mockResolvedValue({
      id: ORG_ID,
      name: "Host",
    } as never);
    vi.mocked(tx.member.findUnique).mockResolvedValue({
      id: "mem_1",
      role: MemberRole.MEMBER,
      userId: MEMBER_ID,
      organizationId: ORG_ID,
    } as never);

    const publicRoom = createExternalRoom(
      [createRoomMembership(MEMBER_ID, "member")],
      { discoverability: "public" },
    );
    vi.mocked(tx.chatRoom.findFirst).mockResolvedValueOnce(publicRoom as never);
    await expect(
      requireJoinableOrgChannel(ROOM_ID, MEMBER_ID, ORG_ID, tx),
    ).resolves.toMatchObject({
      elevated: false,
      room: { id: ROOM_ID },
    });

    const externalRoom = createExternalRoom([
      createRoomMembership(MEMBER_ID, "member"),
    ]);
    vi.mocked(tx.chatRoom.findFirst).mockResolvedValueOnce(
      externalRoom as never,
    );
    await expect(
      requireJoinableOrgChannel(ROOM_ID, MEMBER_ID, ORG_ID, tx),
    ).resolves.toMatchObject({
      elevated: false,
      room: { id: ROOM_ID, discoverability: "external" },
    });

    expect(tx.chatRoom.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          discoverability: { in: ["public", "external"] },
        }),
      }),
    );
  });

  it("includes private channels for organization owners", async () => {
    const tx = createAccessTx();
    vi.mocked(tx.organization.findUnique).mockResolvedValue({
      id: ORG_ID,
      name: "Host",
    } as never);
    vi.mocked(tx.member.findUnique).mockResolvedValue({
      id: "mem_1",
      role: MemberRole.OWNER,
      userId: MEMBER_ID,
      organizationId: ORG_ID,
    } as never);

    const privateRoom = createExternalRoom(
      [createRoomMembership(MEMBER_ID, "member")],
      { discoverability: "private" },
    );
    vi.mocked(tx.chatRoom.findFirst).mockResolvedValueOnce(
      privateRoom as never,
    );
    await expect(
      requireJoinableOrgChannel(ROOM_ID, MEMBER_ID, ORG_ID, tx),
    ).resolves.toMatchObject({ elevated: true, room: { id: ROOM_ID } });

    expect(tx.chatRoom.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          discoverability: { in: ["public", "private", "external"] },
        }),
      }),
    );
  });
});

describe("requireRoomMemberCanInviteGuests", () => {
  it("allows host-org room members on external channels", async () => {
    const tx = createAccessTx();
    const room = createExternalRoom([
      createRoomMembership(MEMBER_ID, "member"),
    ]);
    vi.mocked(tx.chatRoom.findFirst).mockResolvedValueOnce(room as never);
    vi.mocked(tx.organization.findUnique).mockResolvedValueOnce({
      id: ORG_ID,
      name: "Host",
    } as never);
    vi.mocked(tx.member.findUnique).mockResolvedValueOnce({
      id: "mem_1",
      role: MemberRole.MEMBER,
      userId: MEMBER_ID,
      organizationId: ORG_ID,
    } as never);

    const result = await requireRoomMemberCanInviteGuests(
      ROOM_ID,
      MEMBER_ID,
      tx,
    );
    expect(result.id).toBe(ROOM_ID);
  });

  it("rejects guests", async () => {
    const tx = createAccessTx();
    const room = createExternalRoom([createRoomMembership(GUEST_ID, "guest")]);
    vi.mocked(tx.chatRoom.findFirst).mockResolvedValueOnce(room as never);

    await expect(
      requireRoomMemberCanInviteGuests(ROOM_ID, GUEST_ID, tx),
    ).rejects.toSatisfy(
      (error: unknown) =>
        error instanceof HTTPException && error.status === 403,
    );
  });

  it("rejects non-external rooms", async () => {
    const tx = createAccessTx();
    const room = createExternalRoom(
      [createRoomMembership(MEMBER_ID, "member")],
      { discoverability: "public" },
    );
    vi.mocked(tx.chatRoom.findFirst).mockResolvedValueOnce(room as never);
    vi.mocked(tx.organization.findUnique).mockResolvedValueOnce({
      id: ORG_ID,
      name: "Host",
    } as never);
    vi.mocked(tx.member.findUnique).mockResolvedValueOnce({
      id: "mem_1",
      role: MemberRole.MEMBER,
      userId: MEMBER_ID,
      organizationId: ORG_ID,
    } as never);

    await expect(
      requireRoomMemberCanInviteGuests(ROOM_ID, MEMBER_ID, tx),
    ).rejects.toSatisfy(
      (error: unknown) =>
        error instanceof HTTPException && error.status === 404,
    );
  });
});
