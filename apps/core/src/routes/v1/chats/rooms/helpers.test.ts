import { MemberRole, NotificationKind } from "@sokosumi/database";
import { describe, expect, it, vi } from "vitest";

import {
  buildDirectCoworkerRoomKey,
  buildDirectParticipantRoomKey,
  buildDirectRoomKey,
  buildDirectRoomName,
  canManageChatRoomLifecycle,
  contentIncludesRoomAllMention,
  getChatRoomUnreadMentionCounts,
  mapChatRoomMessage,
  mergeChatRoomMessageMetadata,
  resolveMentionedCoworkerIds,
  resolveMentionedUserIds,
} from "./helpers";

const roomCoworkers = [
  { id: "coworker_elena", name: "Elena Research", slug: "elena" },
  { id: "coworker_hannah", name: "Hannah Ops", slug: "hannah" },
];

const roomUsers = [
  { id: "user_alice", name: "Alice Smith" },
  { id: "user_bob", name: "Bob Jones" },
  { id: "user_self", name: "Self User" },
];

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
  const creatorId = "user_creator";
  const otherId = "user_other";

  it("allows the channel creator regardless of org role", () => {
    expect(
      canManageChatRoomLifecycle({
        createdByUserId: creatorId,
        userId: creatorId,
        role: MemberRole.MEMBER,
      }),
    ).toBe(true);
  });

  it.each([
    ["owner", MemberRole.OWNER],
    ["admin", MemberRole.ADMIN],
  ] as const)(
    "allows an organization %s who is not the creator",
    (_label, role) => {
      expect(
        canManageChatRoomLifecycle({
          createdByUserId: creatorId,
          userId: otherId,
          role,
        }),
      ).toBe(true);
    },
  );

  it("denies a plain member who did not create the room", () => {
    expect(
      canManageChatRoomLifecycle({
        createdByUserId: creatorId,
        userId: otherId,
        role: MemberRole.MEMBER,
      }),
    ).toBe(false);
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
});
