import { beforeEach, describe, expect, it, vi } from "vitest";

import { errorHandler } from "@/helpers/error-handler";
import { OpenAPIHonoWithAuth } from "@/lib/hono";

import mountDeleteChatRoomCoworker from "../[id]/coworkers/[coworkerId]/delete";
import mountDeleteChatRoomMember from "../[id]/members/[userId]/delete";
import mountPostChatRoomMembers from "../[id]/members/post";
import mountDeleteChatRoomSokoBot from "../[id]/soko-bots/[sokoBotId]/delete";

/**
 * The Channel roster endpoints the members panel drives: add, and remove a
 * person, a Coworker or a Soko Bot. One harness, because they share one
 * permission matrix (`channel-membership.ts`).
 */

vi.mock("@/middleware/auth", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/middleware/auth")>();
  const { stubAuthMiddleware } = await import(
    "@/test-fixtures/auth-middleware"
  );
  return { ...actual, authMiddleware: stubAuthMiddleware };
});

const mocks = vi.hoisted(() => ({
  transaction: vi.fn(),
  queryRaw: vi.fn(),
  roomFindFirst: vi.fn(),
  roomFindUniqueOrThrow: vi.fn(),
  memberFindUnique: vi.fn(),
  memberFindMany: vi.fn(),
  userFindMany: vi.fn(),
  coworkerFindMany: vi.fn(),
  sokoBotFindMany: vi.fn(),
  userMemberDeleteMany: vi.fn(),
  userMemberUpdateMany: vi.fn(),
  userMemberCreateMany: vi.fn(),
  readStateDeleteMany: vi.fn(),
  readStateCreateMany: vi.fn(),
  coworkerMemberCreateMany: vi.fn(),
  coworkerMemberDeleteMany: vi.fn(),
  sokoBotMemberCreateMany: vi.fn(),
  sokoBotMemberDeleteMany: vi.fn(),
  messageCreate: vi.fn(),
  failOpenMentions: vi.fn(),
  publishMentionStatuses: vi.fn(),
  publishStatus: vi.fn(),
  publishRevoked: vi.fn(),
}));

const tx = {
  $queryRaw: mocks.queryRaw,
  chatRoom: {
    findFirst: mocks.roomFindFirst,
    findUniqueOrThrow: mocks.roomFindUniqueOrThrow,
    update: vi.fn(),
  },
  organization: { findUnique: vi.fn().mockResolvedValue({ id: "org_1" }) },
  member: {
    findUnique: mocks.memberFindUnique,
    findMany: mocks.memberFindMany,
  },
  workspace: { findUnique: vi.fn().mockResolvedValue({ id: "ws_org_1" }) },
  user: { findMany: mocks.userFindMany },
  coworker: { findMany: mocks.coworkerFindMany },
  sokoBot: { findMany: mocks.sokoBotFindMany },
  chatRoomUserMember: {
    deleteMany: mocks.userMemberDeleteMany,
    updateMany: mocks.userMemberUpdateMany,
    createMany: mocks.userMemberCreateMany,
    count: vi.fn().mockResolvedValue(1),
  },
  chatRoomReadState: {
    deleteMany: mocks.readStateDeleteMany,
    createMany: mocks.readStateCreateMany,
  },
  chatRoomCoworkerMember: {
    createMany: mocks.coworkerMemberCreateMany,
    deleteMany: mocks.coworkerMemberDeleteMany,
  },
  chatRoomSokoBotMember: {
    createMany: mocks.sokoBotMemberCreateMany,
    deleteMany: mocks.sokoBotMemberDeleteMany,
  },
  chatRoomMessage: { create: mocks.messageCreate },
};

vi.mock("@/lib/db/prisma", () => ({
  default: {
    $transaction: mocks.transaction,
    chatRoomUserMember: { findMany: vi.fn().mockResolvedValue([]) },
    chatRoomReadState: { findMany: vi.fn().mockResolvedValue([]) },
    chatRoomPinnedMessage: { groupBy: vi.fn().mockResolvedValue([]) },
  },
}));

vi.mock("@/helpers/chat-room-mention-status", () => ({
  failOpenChatRoomMentions: mocks.failOpenMentions,
  publishChatRoomMentionStatuses: mocks.publishMentionStatuses,
}));

vi.mock("@/helpers/chat-room-message-realtime", () => ({
  publishChatRoomMembershipStatusMessagesBestEffort: mocks.publishStatus,
}));

vi.mock("@/lib/ably/publish", () => ({
  publishChatRoomsChanged: vi.fn(),
  publishChatMembershipRevokedToUsers: mocks.publishRevoked,
}));

const ROOM_ID = "550e8400-e29b-41d4-a716-446655440000";
const ADMIN_ID = "user_andreas";
const MEMBER_ID = "user_francis";
const NEW_ID = "user_maya";
const GUEST_ID = "user_guest";
const COWORKER_ID = "cow_soupie";
const OWN_BOT_ID = "01960001-0001-7001-8001-000000000001";
const FRANCIS_BOT_ID = "01960001-0001-7001-8001-000000000002";

function person(userId: string, name: string, access = "member") {
  return {
    userId,
    access,
    user: { id: userId, name, email: `${userId}@example.com`, image: null },
  };
}

function bot(id: string, ownerUserId: string, name: string) {
  return {
    sokoBot: {
      id,
      name,
      avatarImageUrl: null,
      avatarSeed: null,
      userId: ownerUserId,
      user: { name: "Owner" },
    },
  };
}

function channel(overrides: Record<string, unknown> = {}) {
  return {
    id: ROOM_ID,
    organizationId: "org_1",
    name: "Sokosumi",
    slug: "sokosumi",
    kind: "channel",
    directKey: null,
    groupName: null,
    topic: null,
    discoverability: "external",
    createdByUserId: ADMIN_ID,
    createdAt: new Date("2026-01-01T00:00:00.000Z"),
    updatedAt: new Date("2026-01-01T00:00:00.000Z"),
    archivedAt: null,
    userMembers: [
      person(ADMIN_ID, "Andreas"),
      person(MEMBER_ID, "Francis"),
      person(GUEST_ID, "Bastian", "guest"),
    ],
    coworkerMembers: [
      {
        coworker: {
          id: COWORKER_ID,
          name: "Soupie",
          slug: "soupie",
          caption: null,
          image: null,
        },
      },
    ],
    sokoBotMembers: [
      bot(OWN_BOT_ID, ADMIN_ID, "Andreas's Bot"),
      bot(FRANCIS_BOT_ID, MEMBER_ID, "Francis's Bot"),
    ],
    readStates: [],
    ...overrides,
  };
}

function createApp(userId: string) {
  const app = new OpenAPIHonoWithAuth();
  app.use("*", async (c, next) => {
    c.set("isAuthenticated", true);
    c.set("authContext", {
      actor: "user",
      userId,
      organizationId: "org_1",
      role: "user",
    });
    return await next();
  });
  app.onError(errorHandler);
  mountPostChatRoomMembers(app);
  mountDeleteChatRoomMember(app);
  mountDeleteChatRoomCoworker(app);
  mountDeleteChatRoomSokoBot(app);
  return app;
}

function asRole(role: "owner" | "admin" | "member") {
  mocks.memberFindUnique.mockResolvedValue({ id: "mem", role });
}

async function request(
  callerId: string,
  method: "POST" | "DELETE",
  path: string,
  body?: unknown,
) {
  return await createApp(callerId).request(`/${ROOM_ID}${path}`, {
    method,
    ...(body
      ? {
          headers: { "content-type": "application/json" },
          body: JSON.stringify(body),
        }
      : {}),
  });
}

function statusContents(): string[] {
  return mocks.messageCreate.mock.calls.map(([args]) => args.data.content);
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.transaction.mockImplementation(
    async (callback: (client: typeof tx) => unknown) => callback(tx),
  );
  mocks.queryRaw.mockResolvedValue([{ id: ROOM_ID }]);
  mocks.publishStatus.mockResolvedValue(undefined);
  mocks.publishMentionStatuses.mockResolvedValue(undefined);
  mocks.publishRevoked.mockResolvedValue(undefined);
  mocks.roomFindFirst.mockResolvedValue(channel());
  mocks.roomFindUniqueOrThrow.mockResolvedValue(channel());
  asRole("member");
  mocks.memberFindMany.mockImplementation(
    async ({ where }: { where: { userId: { in: string[] } } }) =>
      where.userId.in
        .filter((userId) => userId !== "user_outsider")
        .map((userId) => ({ userId })),
  );
  mocks.userFindMany.mockImplementation(
    async ({ where }: { where: { id: { in: string[] } } }) =>
      where.id.in.map((id) => ({ id, name: id === NEW_ID ? "Maya" : id })),
  );
  mocks.messageCreate.mockImplementation(async ({ data }) => ({
    id: "550e8400-e29b-41d4-a716-446655440099",
    roomId: ROOM_ID,
    content: data.content,
    metadata: data.metadata,
  }));
  mocks.failOpenMentions.mockResolvedValue([]);
});

describe("POST /chats/rooms/{id}/members", () => {
  it("lets any host member add organization members and says who added them", async () => {
    const response = await request(MEMBER_ID, "POST", "/members", {
      userIds: [NEW_ID, ADMIN_ID],
    });

    expect(response.status).toBe(200);
    expect(mocks.userMemberCreateMany).toHaveBeenCalledWith({
      data: [{ roomId: ROOM_ID, userId: NEW_ID, access: "member" }],
      skipDuplicates: true,
    });
    expect(statusContents()).toEqual(["Francis added Maya"]);
    expect(mocks.publishStatus).toHaveBeenCalledTimes(1);
  });

  it("rejects people outside the organization", async () => {
    const response = await request(MEMBER_ID, "POST", "/members", {
      userIds: ["user_outsider"],
    });

    expect(response.status).toBe(400);
    expect(mocks.userMemberCreateMany).not.toHaveBeenCalled();
  });

  it("rejects Guests", async () => {
    const response = await request(GUEST_ID, "POST", "/members", {
      userIds: [NEW_ID],
    });

    expect(response.status).toBe(403);
    expect(mocks.userMemberCreateMany).not.toHaveBeenCalled();
  });

  it("rejects adding someone else's Soko Bot", async () => {
    mocks.roomFindFirst.mockResolvedValue(channel({ sokoBotMembers: [] }));
    mocks.sokoBotFindMany.mockResolvedValue([
      { id: FRANCIS_BOT_ID, userId: MEMBER_ID },
    ]);

    const response = await request(ADMIN_ID, "POST", "/members", {
      sokoBotIds: [FRANCIS_BOT_ID],
    });

    expect(response.status).toBe(403);
    expect(mocks.sokoBotMemberCreateMany).not.toHaveBeenCalled();
  });

  it("leaves members already in the Channel as they are", async () => {
    const response = await request(MEMBER_ID, "POST", "/members", {
      userIds: [ADMIN_ID],
      coworkerIds: [COWORKER_ID],
      sokoBotIds: [FRANCIS_BOT_ID],
    });

    expect(response.status).toBe(200);
    expect(mocks.userMemberCreateMany).not.toHaveBeenCalled();
    expect(mocks.coworkerMemberCreateMany).not.toHaveBeenCalled();
    expect(mocks.sokoBotMemberCreateMany).not.toHaveBeenCalled();
    expect(mocks.messageCreate).not.toHaveBeenCalled();
  });

  it("rejects an empty request", async () => {
    const response = await request(MEMBER_ID, "POST", "/members", {});

    expect(response.status).toBe(422);
  });

  it("leaves matched channels to Sokosumi", async () => {
    mocks.roomFindFirst.mockResolvedValue(
      channel({ organizationId: null, discoverability: "matched" }),
    );

    const response = await request(MEMBER_ID, "POST", "/members", {
      userIds: [NEW_ID],
    });

    expect(response.status).toBe(400);
    expect(mocks.userMemberCreateMany).not.toHaveBeenCalled();
  });
});

describe("DELETE /chats/rooms/{id}/members/{userId}", () => {
  it("lets an organization admin remove a host member and their Soko Bots", async () => {
    asRole("admin");

    const response = await request(ADMIN_ID, "DELETE", `/members/${MEMBER_ID}`);

    expect(response.status).toBe(200);
    expect(mocks.userMemberDeleteMany).toHaveBeenCalledWith({
      where: { roomId: ROOM_ID, userId: MEMBER_ID },
    });
    expect(mocks.sokoBotMemberDeleteMany).toHaveBeenCalledWith({
      where: { roomId: ROOM_ID, sokoBotId: { in: [FRANCIS_BOT_ID] } },
    });
    expect(statusContents()).toEqual([
      "Andreas removed Francis",
      "Andreas removed Francis's Bot",
    ]);
    expect(mocks.publishRevoked).toHaveBeenCalledWith(
      ROOM_ID,
      [MEMBER_ID],
      "removed",
    );
  });

  it("forbids a plain member from removing a host member", async () => {
    const response = await request(MEMBER_ID, "DELETE", `/members/${ADMIN_ID}`);

    expect(response.status).toBe(403);
    expect(mocks.userMemberDeleteMany).not.toHaveBeenCalled();
  });

  it("lets any host member remove a Guest", async () => {
    const response = await request(MEMBER_ID, "DELETE", `/members/${GUEST_ID}`);

    expect(response.status).toBe(200);
    expect(mocks.userMemberDeleteMany).toHaveBeenCalledWith({
      where: { roomId: ROOM_ID, userId: GUEST_ID },
    });
    expect(mocks.readStateDeleteMany).toHaveBeenCalledWith({
      where: { roomId: ROOM_ID, userId: GUEST_ID },
    });
    expect(statusContents()).toEqual(["Francis removed Bastian"]);
  });

  it("forbids Guests from removing anyone", async () => {
    const response = await request(GUEST_ID, "DELETE", `/members/${MEMBER_ID}`);

    expect(response.status).toBe(403);
    expect(mocks.userMemberDeleteMany).not.toHaveBeenCalled();
  });

  it("sends people who remove themselves to leave instead", async () => {
    const response = await request(
      MEMBER_ID,
      "DELETE",
      `/members/${MEMBER_ID}`,
    );

    expect(response.status).toBe(400);
    expect(mocks.userMemberDeleteMany).not.toHaveBeenCalled();
  });

  it("404s for someone not in the Channel", async () => {
    asRole("admin");

    const response = await request(ADMIN_ID, "DELETE", `/members/${NEW_ID}`);

    expect(response.status).toBe(404);
  });
});

describe("DELETE /chats/rooms/{id}/coworkers/{coworkerId}", () => {
  it("lets any host member remove a Coworker and fails its open mentions", async () => {
    const response = await request(
      MEMBER_ID,
      "DELETE",
      `/coworkers/${COWORKER_ID}`,
    );

    expect(response.status).toBe(200);
    expect(mocks.failOpenMentions).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { coworkerId: COWORKER_ID, message: { roomId: ROOM_ID } },
      }),
      tx,
    );
    expect(mocks.coworkerMemberDeleteMany).toHaveBeenCalledWith({
      where: { roomId: ROOM_ID, coworkerId: COWORKER_ID },
    });
    expect(statusContents()).toEqual(["Francis removed Soupie"]);
  });

  it("forbids Guests", async () => {
    const response = await request(
      GUEST_ID,
      "DELETE",
      `/coworkers/${COWORKER_ID}`,
    );

    expect(response.status).toBe(403);
    expect(mocks.coworkerMemberDeleteMany).not.toHaveBeenCalled();
  });
});

describe("DELETE /chats/rooms/{id}/soko-bots/{sokoBotId}", () => {
  it("lets the owner remove their own Soko Bot", async () => {
    const response = await request(
      ADMIN_ID,
      "DELETE",
      `/soko-bots/${OWN_BOT_ID}`,
    );

    expect(response.status).toBe(200);
    expect(mocks.sokoBotMemberDeleteMany).toHaveBeenCalledWith({
      where: { roomId: ROOM_ID, sokoBotId: OWN_BOT_ID },
    });
    expect(statusContents()).toEqual(["Andreas removed Andreas's Bot"]);
  });

  it("forbids removing someone else's Soko Bot, even for an admin", async () => {
    asRole("admin");

    const response = await request(
      ADMIN_ID,
      "DELETE",
      `/soko-bots/${FRANCIS_BOT_ID}`,
    );

    expect(response.status).toBe(403);
    expect(mocks.sokoBotMemberDeleteMany).not.toHaveBeenCalled();
  });
});

describe("channel membership authorization and concurrency", () => {
  const mutations = [
    { method: "POST", path: "/members", body: { userIds: [NEW_ID] } },
    { method: "DELETE", path: `/members/${GUEST_ID}` },
    { method: "DELETE", path: `/coworkers/${COWORKER_ID}` },
    { method: "DELETE", path: `/soko-bots/${OWN_BOT_ID}` },
  ] as const;

  it.each(mutations)(
    "rejects direct room $path",
    async ({ method, path, ...rest }) => {
      mocks.roomFindFirst.mockResolvedValue(channel({ kind: "direct" }));
      const response = await request(
        ADMIN_ID,
        method,
        path,
        "body" in rest ? rest.body : undefined,
      );
      expect(response.status).toBe(400);
      expect(mocks.messageCreate).not.toHaveBeenCalled();
      expect(mocks.publishStatus).not.toHaveBeenCalled();
    },
  );

  it.each(mutations)(
    "rejects matched channel $path",
    async ({ method, path, ...rest }) => {
      mocks.roomFindFirst.mockResolvedValue(
        channel({ discoverability: "matched" }),
      );
      const response = await request(
        ADMIN_ID,
        method,
        path,
        "body" in rest ? rest.body : undefined,
      );
      expect(response.status).toBe(400);
      expect(mocks.messageCreate).not.toHaveBeenCalled();
    },
  );

  it.each(mutations)(
    "revalidates archived or removed access under the lock for $path",
    async ({ method, path, ...rest }) => {
      // Model a leave/archive committing before this writer acquires the room.
      mocks.queryRaw.mockImplementation(async () => {
        mocks.roomFindFirst.mockResolvedValue(null);
        return [{ id: ROOM_ID }];
      });
      const response = await request(
        ADMIN_ID,
        method,
        path,
        "body" in rest ? rest.body : undefined,
      );
      expect(response.status).toBe(404);
      expect(mocks.transaction).toHaveBeenCalledWith(expect.any(Function), {
        isolationLevel: "Serializable",
      });
      expect(mocks.messageCreate).not.toHaveBeenCalled();
      expect(mocks.userMemberCreateMany).not.toHaveBeenCalled();
      expect(mocks.userMemberDeleteMany).not.toHaveBeenCalled();
      expect(mocks.coworkerMemberDeleteMany).not.toHaveBeenCalled();
      expect(mocks.sokoBotMemberDeleteMany).not.toHaveBeenCalled();
      expect(mocks.publishStatus).not.toHaveBeenCalled();
    },
  );

  it.each(mutations)(
    "rejects callers outside the host organization for $path",
    async ({ method, path, ...rest }) => {
      mocks.memberFindUnique.mockResolvedValue(null);
      const response = await request(
        ADMIN_ID,
        method,
        path,
        "body" in rest ? rest.body : undefined,
      );
      expect(response.status).toBe(403);
      expect(mocks.messageCreate).not.toHaveBeenCalled();
    },
  );

  it.each(mutations)(
    "rejects Guests on $path",
    async ({ method, path, ...rest }) => {
      const response = await request(
        GUEST_ID,
        method,
        path === `/members/${GUEST_ID}` ? `/members/${MEMBER_ID}` : path,
        "body" in rest ? rest.body : undefined,
      );
      expect(response.status).toBe(403);
      expect(mocks.messageCreate).not.toHaveBeenCalled();
    },
  );

  it.each(mutations)(
    "rejects missing membership or archived room on $path",
    async ({ method, path, ...rest }) => {
      mocks.roomFindFirst.mockResolvedValue(null);
      const response = await request(
        ADMIN_ID,
        method,
        path,
        "body" in rest ? rest.body : undefined,
      );
      expect(response.status).toBe(404);
      expect(mocks.roomFindFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            id: ROOM_ID,
            archivedAt: null,
            userMembers: { some: { userId: ADMIN_ID } },
          },
        }),
      );
      expect(mocks.messageCreate).not.toHaveBeenCalled();
    },
  );

  it("keeps other after-commit effects independent when timeline publication fails", async () => {
    asRole("admin");
    mocks.publishStatus.mockRejectedValue(new Error("timeline unavailable"));
    expect(
      (await request(ADMIN_ID, "DELETE", `/members/${MEMBER_ID}`)).status,
    ).toBe(200);
    expect(mocks.publishRevoked).toHaveBeenCalledWith(
      ROOM_ID,
      [MEMBER_ID],
      "removed",
    );
    expect(mocks.publishMentionStatuses).toHaveBeenCalled();
  });

  it("allows an organization owner to remove a host", async () => {
    asRole("owner");
    expect(
      (await request(ADMIN_ID, "DELETE", `/members/${MEMBER_ID}`)).status,
    ).toBe(200);
  });

  it("adds an owned bot and deduplicates its status", async () => {
    mocks.roomFindFirst.mockResolvedValue(channel({ sokoBotMembers: [] }));
    mocks.sokoBotFindMany.mockResolvedValue([
      { id: OWN_BOT_ID, userId: ADMIN_ID, name: "Own bot" },
    ]);
    const response = await request(ADMIN_ID, "POST", "/members", {
      sokoBotIds: [OWN_BOT_ID, OWN_BOT_ID],
    });
    expect(response.status).toBe(200);
    expect(mocks.sokoBotMemberCreateMany).toHaveBeenCalledWith({
      data: [{ roomId: ROOM_ID, sokoBotId: OWN_BOT_ID }],
      skipDuplicates: true,
    });
    expect(statusContents()).toEqual(["Andreas added Own bot"]);
  });

  it("adds an eligible coworker", async () => {
    mocks.roomFindFirst.mockResolvedValue(channel({ coworkerMembers: [] }));
    mocks.coworkerFindMany.mockResolvedValue([
      { id: COWORKER_ID, name: "Soupie", baseURL: "https://example.com" },
    ]);
    expect(
      (
        await request(MEMBER_ID, "POST", "/members", {
          coworkerIds: [COWORKER_ID],
        })
      ).status,
    ).toBe(200);
    expect(statusContents()).toEqual(["Francis added Soupie"]);
  });

  it("rejects mixed valid and invalid people before writing", async () => {
    expect(
      (
        await request(MEMBER_ID, "POST", "/members", {
          userIds: [NEW_ID, "user_outsider"],
        })
      ).status,
    ).toBe(400);
    expect(mocks.userMemberCreateMany).not.toHaveBeenCalled();
    expect(mocks.publishStatus).not.toHaveBeenCalled();
  });

  it("never publishes a mixed batch when a later bot validation fails", async () => {
    mocks.roomFindFirst.mockResolvedValue(channel({ sokoBotMembers: [] }));
    mocks.sokoBotFindMany.mockResolvedValue([]);
    expect(
      (
        await request(ADMIN_ID, "POST", "/members", {
          userIds: [NEW_ID],
          sokoBotIds: [OWN_BOT_ID],
        })
      ).status,
    ).toBe(400);
    // The real transaction rolls back the earlier staged human insert.
    expect(mocks.messageCreate).not.toHaveBeenCalled();
    expect(mocks.publishStatus).not.toHaveBeenCalled();
    expect(mocks.publishRevoked).not.toHaveBeenCalled();
  });

  it("does not publish effects if commit fails", async () => {
    mocks.transaction.mockImplementation(
      async (callback: (client: typeof tx) => unknown) => {
        await callback(tx);
        throw new Error("commit failed");
      },
    );
    expect(
      (await request(ADMIN_ID, "DELETE", `/coworkers/${COWORKER_ID}`)).status,
    ).toBe(500);
    expect(mocks.publishStatus).not.toHaveBeenCalled();
    expect(mocks.publishMentionStatuses).not.toHaveBeenCalled();
    expect(mocks.publishRevoked).not.toHaveBeenCalled();
  });
});

it.each([
  { coworkers: [] },
  { coworkers: [{ id: COWORKER_ID, baseURL: " " }] },
])(
  "rejects unusable coworkers without publishing (%j)",
  async ({ coworkers }) => {
    mocks.roomFindFirst.mockResolvedValue(channel({ coworkerMembers: [] }));
    mocks.coworkerFindMany.mockResolvedValue(coworkers);
    expect(
      (
        await request(MEMBER_ID, "POST", "/members", {
          coworkerIds: [COWORKER_ID],
        })
      ).status,
    ).toBe(400);
    expect(mocks.coworkerFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          archivedAt: null,
          capabilities: { has: "chat" },
          sokoBotId: null,
        }),
      }),
    );
    expect(mocks.coworkerMemberCreateMany).not.toHaveBeenCalled();
    expect(mocks.publishStatus).not.toHaveBeenCalled();
  },
);

it("scopes new bots to the active workspace and rejects unavailable bots", async () => {
  mocks.roomFindFirst.mockResolvedValue(channel({ sokoBotMembers: [] }));
  mocks.sokoBotFindMany.mockResolvedValue([]);
  expect(
    (await request(ADMIN_ID, "POST", "/members", { sokoBotIds: [OWN_BOT_ID] }))
      .status,
  ).toBe(400);
  expect(mocks.sokoBotFindMany).toHaveBeenCalledWith({
    where: {
      id: { in: [OWN_BOT_ID] },
      workspaceId: "ws_org_1",
      archivedAt: null,
      deletedAt: null,
    },
    select: { id: true, userId: true },
  });
  expect(mocks.sokoBotMemberCreateMany).not.toHaveBeenCalled();
});

it("locks actor and target organization membership before the room and eligibility read", async () => {
  expect(
    (await request(MEMBER_ID, "POST", "/members", { userIds: [NEW_ID] }))
      .status,
  ).toBe(200);
  const [memberSql, roomId, userIds] = mocks.queryRaw.mock.calls[0];
  expect(memberSql.join("?")).toContain('FOR SHARE OF "member"');
  expect(memberSql.join("?")).toContain('JOIN "chat_room"');
  expect(roomId).toBe(ROOM_ID);
  expect(userIds).toEqual([MEMBER_ID, NEW_ID]);
  expect(mocks.queryRaw.mock.calls[1][0].join("?")).toContain("FOR UPDATE");
  expect(mocks.queryRaw.mock.invocationCallOrder[0]).toBeLessThan(
    mocks.roomFindFirst.mock.invocationCallOrder[0],
  );
  expect(mocks.queryRaw.mock.invocationCallOrder[0]).toBeLessThan(
    mocks.memberFindMany.mock.invocationCallOrder[0],
  );
});

it("rejects a target whose organization exit wins the membership lock", async () => {
  mocks.queryRaw.mockImplementation(async (sql: TemplateStringsArray) => {
    if (sql.join("?").includes('FOR SHARE OF "member"')) {
      mocks.memberFindMany.mockResolvedValue([]);
    }
    return [{ id: ROOM_ID }];
  });
  expect(
    (await request(MEMBER_ID, "POST", "/members", { userIds: [NEW_ID] }))
      .status,
  ).toBe(400);
  expect(mocks.userMemberCreateMany).not.toHaveBeenCalled();
  expect(mocks.publishStatus).not.toHaveBeenCalled();
});
