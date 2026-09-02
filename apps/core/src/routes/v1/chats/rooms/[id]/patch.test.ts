import { Prisma } from "@sokosumi/database";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { errorHandler } from "@/helpers/error-handler";
import { CONCURRENCY_CONFLICT_KIND } from "@/lib/db/transaction";
import { OpenAPIHonoWithAuth } from "@/lib/hono";
import type { AuthVariables } from "@/middleware/auth";

import mountPatchChatRoom from "./patch";

vi.mock("@/middleware/auth", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/middleware/auth")>();
  const { stubAuthMiddleware } = await import(
    "@/test-fixtures/auth-middleware"
  );
  return { ...actual, authMiddleware: stubAuthMiddleware };
});

const {
  roomFindFirstMock,
  roomFindManyMock,
  roomUpdateMock,
  organizationFindUniqueMock,
  memberFindUniqueMock,
  memberFindManyMock,
  coworkerFindManyMock,
  sokoBotFindManyMock,
  orchestratorMemberDeleteManyMock,
  orchestratorMemberCreateManyMock,
  workspaceFindUniqueMock,
  userFindManyMock,
  userMemberDeleteManyMock,
  userMemberUpdateManyMock,
  userMemberFindManyMock,
  userMemberCreateManyMock,
  readStateDeleteManyMock,
  readStateCreateManyMock,
  coworkerMemberDeleteManyMock,
  coworkerMemberCreateManyMock,
  failOpenMentionsMock,
  publishMentionStatusesMock,
  messageCreateMock,
  membershipFindManyMock,
  readStateFindManyMock,
  guestInvitationCountMock,
  guestInvitationUpdateManyMock,
  guestInviteLinkCountMock,
  queryRawMock,
  userMemberCountMock,
  prismaTransactionMock,
  publishChatRoomMessageRealtimeMock,
  publishChatMembershipRevokedToUsersMock,
} = vi.hoisted(() => ({
  roomFindFirstMock: vi.fn(),
  roomFindManyMock: vi.fn(),
  roomUpdateMock: vi.fn(),
  organizationFindUniqueMock: vi.fn(),
  memberFindUniqueMock: vi.fn(),
  memberFindManyMock: vi.fn(),
  coworkerFindManyMock: vi.fn(),
  sokoBotFindManyMock: vi.fn(),
  orchestratorMemberDeleteManyMock: vi.fn(),
  orchestratorMemberCreateManyMock: vi.fn(),
  workspaceFindUniqueMock: vi.fn(),
  userFindManyMock: vi.fn(),
  userMemberDeleteManyMock: vi.fn(),
  userMemberUpdateManyMock: vi.fn(),
  userMemberFindManyMock: vi.fn(),
  userMemberCreateManyMock: vi.fn(),
  userMemberCountMock: vi.fn(),
  readStateDeleteManyMock: vi.fn(),
  readStateCreateManyMock: vi.fn(),
  coworkerMemberDeleteManyMock: vi.fn(),
  coworkerMemberCreateManyMock: vi.fn(),
  failOpenMentionsMock: vi.fn(),
  publishMentionStatusesMock: vi.fn(),
  messageCreateMock: vi.fn(),
  membershipFindManyMock: vi.fn(),
  readStateFindManyMock: vi.fn(),
  guestInvitationCountMock: vi.fn(),
  guestInvitationUpdateManyMock: vi.fn(),
  guestInviteLinkCountMock: vi.fn(),
  queryRawMock: vi.fn(),
  prismaTransactionMock: vi.fn(),
  publishChatRoomMessageRealtimeMock: vi.fn(),
  publishChatMembershipRevokedToUsersMock: vi.fn(),
}));

vi.mock("@/lib/db/prisma", () => ({
  default: {
    $transaction: prismaTransactionMock,
    chatRoomUserMember: {
      findMany: membershipFindManyMock,
    },
    chatRoomReadState: {
      findMany: readStateFindManyMock,
    },
    chatRoomPinnedMessage: {
      groupBy: vi.fn().mockResolvedValue([]),
    },
  },
}));

vi.mock("@/helpers/chat-room-message-realtime", () => ({
  publishChatRoomMessageRealtime: publishChatRoomMessageRealtimeMock,
}));

vi.mock("@/helpers/chat-room-mention-status", () => ({
  failOpenChatRoomMentions: failOpenMentionsMock,
  publishChatRoomMentionStatuses: publishMentionStatusesMock,
}));

vi.mock("@/lib/ably/publish", () => ({
  publishChatMembershipRevokedToUsers: publishChatMembershipRevokedToUsersMock,
}));

const ROOM_ID = "550e8400-e29b-41d4-a716-446655440000";
const USER_ID = "user_123";
const OTHER_USER_ID = "user_456";
const ORG_ID = "org_1";
const ORG_WORKSPACE_ID = "ws_org_1";

const tx = {
  chatRoom: {
    findFirst: roomFindFirstMock,
    findMany: roomFindManyMock,
    update: roomUpdateMock,
  },
  organization: {
    findUnique: organizationFindUniqueMock,
  },
  member: {
    findUnique: memberFindUniqueMock,
    findMany: memberFindManyMock,
  },
  coworker: {
    findMany: coworkerFindManyMock,
  },
  sokoBot: {
    findMany: sokoBotFindManyMock,
  },
  workspace: {
    findUnique: workspaceFindUniqueMock,
  },
  user: {
    findMany: userFindManyMock,
  },
  chatRoomUserMember: {
    deleteMany: userMemberDeleteManyMock,
    updateMany: userMemberUpdateManyMock,
    findMany: userMemberFindManyMock,
    createMany: userMemberCreateManyMock,
    count: userMemberCountMock,
  },
  chatRoomReadState: {
    deleteMany: readStateDeleteManyMock,
    createMany: readStateCreateManyMock,
  },
  chatRoomCoworkerMember: {
    deleteMany: coworkerMemberDeleteManyMock,
    createMany: coworkerMemberCreateManyMock,
  },
  chatRoomOrchestratorMember: {
    deleteMany: orchestratorMemberDeleteManyMock,
    createMany: orchestratorMemberCreateManyMock,
  },
  chatRoomMessage: {
    create: messageCreateMock,
  },
  chatRoomGuestInvitation: {
    count: guestInvitationCountMock,
    updateMany: guestInvitationUpdateManyMock,
  },
  chatRoomGuestInviteLink: {
    count: guestInviteLinkCountMock,
  },
  $queryRaw: queryRawMock,
};

function createApp(authContext: AuthVariables["authContext"]) {
  const app = new OpenAPIHonoWithAuth();

  app.use("*", async (c, next) => {
    c.set("requestId", "req_patch_chat_room");
    c.set("isAuthenticated", true);
    c.set("authContext", authContext);
    return await next();
  });

  app.onError(errorHandler);
  mountPatchChatRoom(app);
  return app;
}

const userAuthContext: AuthVariables["authContext"] = {
  actor: "user",
  userId: USER_ID,
  organizationId: ORG_ID,
  role: "user",
};

function channelRoom(overrides: Record<string, unknown> = {}) {
  return {
    id: ROOM_ID,
    organizationId: ORG_ID,
    name: "Launch Room",
    slug: "launch-room",
    kind: "channel",
    directKey: null,
    topic: null,
    discoverability: "private",
    createdByUserId: USER_ID,
    createdAt: new Date("2025-01-01T00:00:00.000Z"),
    updatedAt: new Date("2025-01-01T00:00:00.000Z"),
    archivedAt: null,
    userMembers: [
      {
        userId: USER_ID,
        access: "member",
        user: {
          id: USER_ID,
          name: "Ada",
          email: "ada@example.com",
          image: null,
          sessions: [],
        },
      },
    ],
    coworkerMembers: [],
    orchestratorMembers: [],
    ...overrides,
  };
}

function directRoom() {
  return channelRoom({
    name: "Bob",
    slug: null,
    kind: "direct",
    directKey: `${USER_ID}:${OTHER_USER_ID}`,
    discoverability: null,
  });
}

const GUEST_ID = "user_guest";
const SOUPIE_ID = "cow_soupie";

function hostUserMember(userId: string, name: string, email: string) {
  return {
    userId,
    access: "member" as const,
    user: {
      id: userId,
      name,
      email,
      image: null,
      sessions: [],
    },
  };
}

function guestUserMember(userId: string) {
  return {
    userId,
    access: "guest" as const,
    user: {
      id: userId,
      name: "Guest",
      email: "guest@example.com",
      image: null,
      sessions: [],
    },
  };
}

function externalChannelWithGuest(
  guestId: string,
  overrides: Record<string, unknown> = {},
) {
  return channelRoom({
    discoverability: "external",
    userMembers: [
      hostUserMember(USER_ID, "Ada", "ada@example.com"),
      guestUserMember(guestId),
    ],
    ...overrides,
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  prismaTransactionMock.mockImplementation(async (callback) => callback(tx));
  organizationFindUniqueMock.mockResolvedValue({ id: ORG_ID });
  memberFindUniqueMock.mockResolvedValue({ role: "member" });
  roomFindManyMock.mockResolvedValue([]);
  memberFindManyMock.mockImplementation(
    async ({ where }: { where: { userId: { in: string[] } } }) =>
      where.userId.in.map((userId) => ({ userId })),
  );
  coworkerFindManyMock.mockResolvedValue([]);
  sokoBotFindManyMock.mockResolvedValue([]);
  workspaceFindUniqueMock.mockResolvedValue({ id: ORG_WORKSPACE_ID });
  userFindManyMock.mockImplementation(
    async ({ where }: { where: { id: { in: string[] } } }) =>
      where.id.in.map((id) => ({
        id,
        name: id === USER_ID ? "Ada" : id === OTHER_USER_ID ? "Bob" : id,
      })),
  );
  messageCreateMock.mockImplementation(async ({ data }) => ({
    id: "550e8400-e29b-41d4-a716-446655440099",
    roomId: ROOM_ID,
    parentMessageId: null,
    senderUserId: null,
    senderCoworkerId: null,
    senderOrchestratorId: null,
    content: data.content,
    createdAt: new Date("2026-01-01T00:00:00.000Z"),
    deletedAt: null,
    editedAt: null,
    metadata: data.metadata,
    clientMessageId: null,
    responsesApiResponseId: null,
    senderUser: null,
    senderCoworker: null,
    senderOrchestrator: null,
    mentionsAsSource: [],
    reactions: [],
    replies: [],
    _count: { replies: 0 },
  }));
  publishChatRoomMessageRealtimeMock.mockResolvedValue(undefined);
  publishChatMembershipRevokedToUsersMock.mockResolvedValue(undefined);
  failOpenMentionsMock.mockResolvedValue([]);
  publishMentionStatusesMock.mockResolvedValue(undefined);
  membershipFindManyMock.mockResolvedValue([]);
  readStateFindManyMock.mockResolvedValue([]);
  guestInvitationCountMock.mockResolvedValue(0);
  guestInvitationUpdateManyMock.mockResolvedValue({ count: 0 });
  guestInviteLinkCountMock.mockResolvedValue(0);
  queryRawMock.mockResolvedValue([{ id: ROOM_ID }]);
  userMemberCountMock.mockResolvedValue(0);
  userMemberUpdateManyMock.mockResolvedValue({ count: 0 });
  userMemberFindManyMock.mockResolvedValue([]);
});

describe("PATCH /chats/rooms/{id}", () => {
  it("allows a non-creator member to PATCH roster-only", async () => {
    const existing = channelRoom({ createdByUserId: OTHER_USER_ID });
    const updated = channelRoom({ createdByUserId: OTHER_USER_ID });
    roomFindFirstMock.mockResolvedValueOnce(existing);
    memberFindUniqueMock.mockResolvedValue({ role: "member" });
    roomUpdateMock.mockResolvedValueOnce(updated);
    userMemberDeleteManyMock.mockResolvedValue({ count: 1 });
    userMemberCreateManyMock.mockResolvedValue({ count: 2 });
    readStateDeleteManyMock.mockResolvedValue({ count: 0 });
    readStateCreateManyMock.mockResolvedValue({ count: 0 });

    const app = createApp(userAuthContext);
    const response = await app.request(`/${ROOM_ID}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        memberUserIds: [USER_ID, OTHER_USER_ID],
      }),
    });

    expect(response.status).toBe(200);
    expect(userMemberCreateManyMock).toHaveBeenCalled();
    expect(roomUpdateMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: ROOM_ID },
        data: {},
      }),
    );
  });

  it("rejects a non-creator member PATCH that touches settings", async () => {
    roomFindFirstMock.mockResolvedValueOnce(
      channelRoom({ createdByUserId: OTHER_USER_ID }),
    );
    memberFindUniqueMock.mockResolvedValue({ role: "member" });

    const app = createApp(userAuthContext);
    const response = await app.request(`/${ROOM_ID}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "Nope" }),
    });

    expect(response.status).toBe(403);
    const text = await response.text();
    expect(text).toMatch(/organization owner or admin/i);
    expect(text).not.toMatch(/creator/i);
    expect(roomUpdateMock).not.toHaveBeenCalled();
    expect(userMemberDeleteManyMock).not.toHaveBeenCalled();
  });

  it("rejects a creator who is only a plain member from PATCH settings", async () => {
    roomFindFirstMock.mockResolvedValueOnce(channelRoom());
    memberFindUniqueMock.mockResolvedValue({ role: "member" });

    const app = createApp(userAuthContext);
    const response = await app.request(`/${ROOM_ID}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        name: "Ship Room",
        topic: "Go live checklist",
      }),
    });

    expect(response.status).toBe(403);
    expect(roomUpdateMock).not.toHaveBeenCalled();
  });

  it("updates channel settings when the caller is an organization admin", async () => {
    const existing = channelRoom({
      createdByUserId: OTHER_USER_ID,
      discoverability: "private",
    });
    const updated = channelRoom({
      createdByUserId: OTHER_USER_ID,
      name: "Ship Room",
      slug: "ship-room",
      topic: "Go live checklist",
      discoverability: "public",
    });
    roomFindFirstMock.mockResolvedValueOnce(existing);
    memberFindUniqueMock.mockResolvedValue({ role: "admin" });
    roomUpdateMock.mockResolvedValueOnce(updated);

    const app = createApp(userAuthContext);
    const response = await app.request(`/${ROOM_ID}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        name: "Ship Room",
        topic: "Go live checklist",
        discoverability: "public",
      }),
    });

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.data.name).toBe("Ship Room");
    expect(body.data.discoverability).toBe("public");
    expect(roomUpdateMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: ROOM_ID },
        data: {
          name: "Ship Room",
          topic: "Go live checklist",
          discoverability: "public",
        },
      }),
    );
  });

  it("does not rewrite the Channel slug when the name changes", async () => {
    const existing = channelRoom({
      name: "Launch Room",
      slug: "launch-room",
    });
    const updated = channelRoom({
      name: "Ship Room",
      slug: "launch-room",
    });
    roomFindFirstMock.mockResolvedValueOnce(existing);
    memberFindUniqueMock.mockResolvedValue({ role: "admin" });
    roomUpdateMock.mockResolvedValueOnce(updated);

    const app = createApp(userAuthContext);
    const response = await app.request(`/${ROOM_ID}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        name: "Ship Room",
      }),
    });

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.data.name).toBe("Ship Room");
    expect(body.data.slug).toBe("launch-room");
    expect(roomUpdateMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: ROOM_ID },
        data: {
          name: "Ship Room",
        },
      }),
    );
  });

  it("rejects a Channel slug on PATCH", async () => {
    const app = createApp(userAuthContext);
    const response = await app.request(`/${ROOM_ID}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        slug: "new-handle",
      }),
    });

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual(
      expect.objectContaining({
        message: "Channel slug cannot be changed",
      }),
    );
    expect(roomFindFirstMock).not.toHaveBeenCalled();
    expect(roomUpdateMock).not.toHaveBeenCalled();
  });

  it("rejects direct room edits with 400", async () => {
    roomFindFirstMock.mockResolvedValueOnce(directRoom());

    const app = createApp(userAuthContext);
    const response = await app.request(`/${ROOM_ID}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "Nope" }),
    });

    expect(response.status).toBe(400);
    expect(await response.text()).toContain("Direct rooms cannot be edited.");
    expect(roomUpdateMock).not.toHaveBeenCalled();
  });

  it("rejects unknown rooms with 404", async () => {
    roomFindFirstMock.mockResolvedValueOnce(null);

    const app = createApp(userAuthContext);
    const response = await app.request(`/${ROOM_ID}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "Nope" }),
    });

    expect(response.status).toBe(404);
    expect(await response.text()).toContain("Room not found");
    expect(roomUpdateMock).not.toHaveBeenCalled();
  });

  it("emits joined/left membership status for user and coworker roster diffs", async () => {
    const removedCoworkerId = "cow_old";
    const addedCoworkerId = "cow_new";
    const existing = channelRoom({
      coworkerMembers: [
        {
          coworker: {
            id: removedCoworkerId,
            name: "OldBot",
            slug: "old",
            image: null,
          },
        },
      ],
      orchestratorMembers: [],
    });
    const updated = channelRoom({
      userMembers: [
        {
          user: {
            id: USER_ID,
            name: "Ada",
            email: "ada@example.com",
            image: null,
            sessions: [],
          },
        },
        {
          user: {
            id: OTHER_USER_ID,
            name: "Bob",
            email: "bob@example.com",
            image: null,
            sessions: [],
          },
        },
      ],
      coworkerMembers: [
        {
          coworker: {
            id: addedCoworkerId,
            name: "NewBot",
            slug: "new",
            image: null,
          },
        },
      ],
      orchestratorMembers: [],
    });
    roomFindFirstMock.mockResolvedValueOnce(existing);
    coworkerFindManyMock.mockResolvedValue([
      {
        id: addedCoworkerId,
        name: "NewBot",
        baseURL: "https://chat.example.com",
      },
    ]);
    roomUpdateMock.mockResolvedValueOnce(updated);
    userMemberDeleteManyMock.mockResolvedValue({ count: 1 });
    userMemberCreateManyMock.mockResolvedValue({ count: 2 });
    readStateDeleteManyMock.mockResolvedValue({ count: 0 });
    readStateCreateManyMock.mockResolvedValue({ count: 0 });
    coworkerMemberDeleteManyMock.mockResolvedValue({ count: 1 });
    coworkerMemberCreateManyMock.mockResolvedValue({ count: 1 });

    const app = createApp(userAuthContext);
    const response = await app.request(`/${ROOM_ID}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        memberUserIds: [USER_ID, OTHER_USER_ID],
        coworkerIds: [addedCoworkerId],
      }),
    });

    expect(response.status).toBe(200);
    expect(messageCreateMock).toHaveBeenCalledTimes(3);
    expect(
      messageCreateMock.mock.calls.map((call) => call[0].data.content),
    ).toEqual(["OldBot left", "Bob joined", "NewBot joined"]);
    expect(publishChatRoomMessageRealtimeMock).toHaveBeenCalledTimes(3);
    // No human removed — only coworker left / Bob joined; empty revoke fan-out.
    expect(publishChatMembershipRevokedToUsersMock).toHaveBeenCalledWith(
      ROOM_ID,
      [],
      "removed",
    );
  });

  it("publishes membership revoke for users dropped from the roster", async () => {
    const removedUserId = OTHER_USER_ID;
    const existing = channelRoom({
      userMembers: [
        {
          user: {
            id: USER_ID,
            name: "Ada",
            email: "ada@example.com",
            image: null,
            sessions: [],
          },
        },
        {
          user: {
            id: removedUserId,
            name: "Bob",
            email: "bob@example.com",
            image: null,
            sessions: [],
          },
        },
      ],
    });
    const updated = channelRoom();
    roomFindFirstMock.mockResolvedValueOnce(existing);
    roomUpdateMock.mockResolvedValueOnce(updated);
    userMemberDeleteManyMock.mockResolvedValue({ count: 2 });
    userMemberCreateManyMock.mockResolvedValue({ count: 1 });
    readStateDeleteManyMock.mockResolvedValue({ count: 1 });
    readStateCreateManyMock.mockResolvedValue({ count: 0 });
    messageCreateMock.mockResolvedValue({
      id: "550e8400-e29b-41d4-a716-446655440088",
      roomId: ROOM_ID,
      content: "Bob left",
    });

    const app = createApp(userAuthContext);
    const response = await app.request(`/${ROOM_ID}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        memberUserIds: [USER_ID],
      }),
    });

    expect(response.status).toBe(200);
    expect(publishChatMembershipRevokedToUsersMock).toHaveBeenCalledWith(
      ROOM_ID,
      [removedUserId],
      "removed",
    );
  });

  it("runs roster rewrite under a serializable transaction", async () => {
    const existing = channelRoom();
    const updated = channelRoom();
    roomFindFirstMock.mockResolvedValueOnce(existing);
    roomUpdateMock.mockResolvedValueOnce(updated);
    userMemberDeleteManyMock.mockResolvedValue({ count: 1 });
    userMemberCreateManyMock.mockResolvedValue({ count: 2 });
    readStateDeleteManyMock.mockResolvedValue({ count: 0 });
    readStateCreateManyMock.mockResolvedValue({ count: 0 });

    const app = createApp(userAuthContext);
    const response = await app.request(`/${ROOM_ID}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        memberUserIds: [USER_ID, OTHER_USER_ID],
      }),
    });

    expect(response.status).toBe(200);
    expect(prismaTransactionMock).toHaveBeenCalledWith(expect.any(Function), {
      isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
    });
  });

  it("returns 409 concurrency_conflict when serializable roster rewrite races (e.g. concurrent leave)", async () => {
    prismaTransactionMock.mockRejectedValue(
      Object.assign(new Error("Transaction failed"), { code: "P2034" }),
    );

    const app = createApp(userAuthContext);
    const response = await app.request(`/${ROOM_ID}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        memberUserIds: [USER_ID, OTHER_USER_ID],
      }),
    });

    expect(response.status).toBe(409);
    const body = await response.json();
    expect(body.kind).toBe(CONCURRENCY_CONFLICT_KIND);
    expect(body.message).toMatch(/concurrently/i);
    expect(prismaTransactionMock).toHaveBeenCalledWith(expect.any(Function), {
      isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
    });
    expect(publishChatMembershipRevokedToUsersMock).not.toHaveBeenCalled();
  });

  it("fails open mentions when coworkers are removed from the roster", async () => {
    const existing = channelRoom();
    const keptCoworkerId = "cow_keep";
    const updated = channelRoom({
      coworkerMembers: [
        {
          coworker: {
            id: keptCoworkerId,
            name: "Kept",
            slug: "kept",
            image: null,
          },
        },
      ],
      orchestratorMembers: [],
    });
    roomFindFirstMock.mockResolvedValueOnce(existing);
    coworkerFindManyMock.mockResolvedValue([
      { id: keptCoworkerId, baseURL: "https://chat.example.com" },
    ]);
    roomUpdateMock.mockResolvedValueOnce(updated);
    failOpenMentionsMock.mockResolvedValue(["message_1"]);
    coworkerMemberDeleteManyMock.mockResolvedValue({ count: 1 });
    coworkerMemberCreateManyMock.mockResolvedValue({ count: 1 });

    const app = createApp(userAuthContext);
    const response = await app.request(`/${ROOM_ID}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ coworkerIds: [keptCoworkerId] }),
    });

    expect(response.status).toBe(200);
    expect(failOpenMentionsMock).toHaveBeenCalledWith(
      {
        where: {
          coworkerId: { notIn: [keptCoworkerId] },
          message: { roomId: ROOM_ID },
        },
        error: "Coworker is no longer a member of this room",
      },
      tx,
    );
    expect(publishMentionStatusesMock).toHaveBeenCalledWith(["message_1"]);
    expect(coworkerMemberDeleteManyMock).toHaveBeenCalledWith({
      where: { roomId: ROOM_ID },
    });
  });

  it("rejects a guest PATCH on roster with 403", async () => {
    roomFindFirstMock.mockResolvedValueOnce(
      channelRoom({
        discoverability: "external",
        userMembers: [
          {
            userId: USER_ID,
            access: "guest",
            user: {
              id: USER_ID,
              name: "Ada",
              email: "ada@example.com",
              image: null,
              sessions: [],
            },
          },
        ],
      }),
    );
    // Guests are not host-org members — must fail before org elevation path.
    memberFindUniqueMock.mockResolvedValue(null);

    const app = createApp(userAuthContext);
    const response = await app.request(`/${ROOM_ID}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        memberUserIds: [USER_ID, OTHER_USER_ID],
      }),
    });

    expect(response.status).toBe(403);
    expect(await response.text()).toMatch(/guest/i);
    expect(roomUpdateMock).not.toHaveBeenCalled();
    expect(userMemberDeleteManyMock).not.toHaveBeenCalled();
    expect(memberFindUniqueMock).not.toHaveBeenCalled();
  });

  it("rejects a guest PATCH on settings with 403", async () => {
    roomFindFirstMock.mockResolvedValueOnce(
      channelRoom({
        discoverability: "external",
        userMembers: [
          {
            userId: USER_ID,
            access: "guest",
            user: {
              id: USER_ID,
              name: "Ada",
              email: "ada@example.com",
              image: null,
              sessions: [],
            },
          },
        ],
      }),
    );
    memberFindUniqueMock.mockResolvedValue(null);

    const app = createApp(userAuthContext);
    const response = await app.request(`/${ROOM_ID}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "Hijacked" }),
    });

    expect(response.status).toBe(403);
    expect(await response.text()).toMatch(/guest/i);
    expect(roomUpdateMock).not.toHaveBeenCalled();
  });

  it("blocks convert away from external when guest members exist", async () => {
    const guestId = "user_guest";
    roomFindFirstMock.mockResolvedValueOnce(
      channelRoom({
        discoverability: "external",
        userMembers: [
          {
            userId: USER_ID,
            access: "member",
            user: {
              id: USER_ID,
              name: "Ada",
              email: "ada@example.com",
              image: null,
              sessions: [],
            },
          },
          {
            userId: guestId,
            access: "guest",
            user: {
              id: guestId,
              name: "Guest",
              email: "guest@example.com",
              image: null,
              sessions: [],
            },
          },
        ],
      }),
    );
    memberFindUniqueMock.mockResolvedValue({ role: "admin" });
    userMemberCountMock.mockResolvedValue(1);

    const app = createApp(userAuthContext);
    const response = await app.request(`/${ROOM_ID}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ discoverability: "public" }),
    });

    expect(response.status).toBe(400);
    expect(await response.text()).toMatch(
      /guest members or pending invitations/i,
    );
    expect(roomUpdateMock).not.toHaveBeenCalled();
    expect(guestInvitationCountMock).not.toHaveBeenCalled();
  });

  it("blocks convert away from external when pending invites exist", async () => {
    roomFindFirstMock.mockResolvedValueOnce(
      channelRoom({ discoverability: "external" }),
    );
    memberFindUniqueMock.mockResolvedValue({ role: "owner" });
    guestInvitationCountMock.mockResolvedValue(1);

    const app = createApp(userAuthContext);
    const response = await app.request(`/${ROOM_ID}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ discoverability: "private" }),
    });

    expect(response.status).toBe(400);
    expect(await response.text()).toMatch(
      /guest members or pending invitations/i,
    );
    expect(guestInvitationCountMock).toHaveBeenCalledWith({
      where: expect.objectContaining({
        roomId: ROOM_ID,
        status: "pending",
        expiresAt: expect.objectContaining({ gt: expect.any(Date) }),
      }),
    });
    expect(roomUpdateMock).not.toHaveBeenCalled();
  });

  it("blocks convert away from external when live shareable invite links exist", async () => {
    roomFindFirstMock.mockResolvedValueOnce(
      channelRoom({ discoverability: "external" }),
    );
    memberFindUniqueMock.mockResolvedValue({ role: "owner" });
    guestInvitationCountMock.mockResolvedValue(0);
    guestInviteLinkCountMock.mockResolvedValue(1);

    const app = createApp(userAuthContext);
    const response = await app.request(`/${ROOM_ID}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ discoverability: "private" }),
    });

    expect(response.status).toBe(400);
    expect(await response.text()).toMatch(/shareable invite links/i);
    expect(guestInviteLinkCountMock).toHaveBeenCalledWith({
      where: expect.objectContaining({
        roomId: ROOM_ID,
        revokedAt: null,
        OR: expect.arrayContaining([
          { expiresAt: null },
          { expiresAt: expect.objectContaining({ gt: expect.any(Date) }) },
        ]),
      }),
    });
    expect(roomUpdateMock).not.toHaveBeenCalled();
  });

  it("allows convert away from external when no guests or pending invites", async () => {
    const existing = channelRoom({ discoverability: "external" });
    const updated = channelRoom({ discoverability: "public" });
    roomFindFirstMock.mockResolvedValueOnce(existing);
    memberFindUniqueMock.mockResolvedValue({ role: "admin" });
    guestInvitationCountMock.mockResolvedValue(0);
    guestInviteLinkCountMock.mockResolvedValue(0);
    roomUpdateMock.mockResolvedValueOnce(updated);

    const app = createApp(userAuthContext);
    const response = await app.request(`/${ROOM_ID}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ discoverability: "public" }),
    });

    expect(response.status).toBe(200);
    expect(guestInvitationCountMock).toHaveBeenCalledWith({
      where: expect.objectContaining({
        roomId: ROOM_ID,
        status: "pending",
        expiresAt: expect.objectContaining({ gt: expect.any(Date) }),
      }),
    });
    expect(guestInviteLinkCountMock).toHaveBeenCalledWith({
      where: expect.objectContaining({
        roomId: ROOM_ID,
        revokedAt: null,
        OR: expect.arrayContaining([
          { expiresAt: null },
          { expiresAt: expect.objectContaining({ gt: expect.any(Date) }) },
        ]),
      }),
    });
    expect(roomUpdateMock).toHaveBeenCalledWith(
      expect.objectContaining({
        data: { discoverability: "public" },
      }),
    );
  });

  it("preserves guest rows when PATCH rewrites memberUserIds without the guest", async () => {
    const existing = externalChannelWithGuest(GUEST_ID);
    const updated = externalChannelWithGuest(GUEST_ID, {
      userMembers: [
        hostUserMember(USER_ID, "Ada", "ada@example.com"),
        hostUserMember(OTHER_USER_ID, "Bob", "bob@example.com"),
        guestUserMember(GUEST_ID),
      ],
    });
    roomFindFirstMock.mockResolvedValueOnce(existing);
    memberFindUniqueMock.mockResolvedValue({ role: "member" });
    roomUpdateMock.mockResolvedValueOnce(updated);
    userMemberDeleteManyMock.mockResolvedValue({ count: 1 });
    userMemberFindManyMock.mockResolvedValue([{ userId: GUEST_ID }]);
    userMemberCreateManyMock.mockResolvedValue({ count: 2 });
    readStateDeleteManyMock.mockResolvedValue({ count: 0 });
    readStateCreateManyMock.mockResolvedValue({ count: 0 });

    const app = createApp(userAuthContext);
    const response = await app.request(`/${ROOM_ID}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        // Host roster only — guest intentionally omitted (web always sends members).
        memberUserIds: [USER_ID, OTHER_USER_ID],
      }),
    });

    expect(response.status).toBe(200);
    // Must not wipe the whole roster (would silent-evict guests).
    expect(userMemberDeleteManyMock).toHaveBeenCalledWith({
      where: { roomId: ROOM_ID, access: "member" },
    });
    expect(userMemberDeleteManyMock).not.toHaveBeenCalledWith({
      where: { roomId: ROOM_ID },
    });
    // Recreate only host members; guest row stays access=guest.
    expect(userMemberCreateManyMock).toHaveBeenCalledWith({
      data: expect.arrayContaining([
        expect.objectContaining({
          roomId: ROOM_ID,
          userId: USER_ID,
          access: "member",
        }),
        expect.objectContaining({
          roomId: ROOM_ID,
          userId: OTHER_USER_ID,
          access: "member",
        }),
      ]),
    });
    const createdIds = userMemberCreateManyMock.mock.calls[0][0].data.map(
      (row: { userId: string }) => row.userId,
    );
    expect(createdIds).not.toContain(GUEST_ID);
    // Guest read state must not be swept when not in memberUserIds.
    expect(readStateDeleteManyMock).toHaveBeenCalledWith({
      where: {
        roomId: ROOM_ID,
        userId: {
          notIn: expect.arrayContaining([USER_ID, OTHER_USER_ID, GUEST_ID]),
        },
      },
    });
    // Guest must not appear as left in membership status.
    expect(
      messageCreateMock.mock.calls.map((call) => call[0].data.content),
    ).not.toEqual(
      expect.arrayContaining([expect.stringMatching(/Guest left/i)]),
    );
  });

  it("adds a coworker when memberUserIds echoes existing guests (not org members)", async () => {
    const existing = externalChannelWithGuest(GUEST_ID);
    const updated = externalChannelWithGuest(GUEST_ID, {
      coworkerMembers: [
        {
          coworker: {
            id: SOUPIE_ID,
            name: "Soupie",
            slug: "soupie",
            image: null,
          },
        },
      ],
      orchestratorMembers: [],
    });
    roomFindFirstMock.mockResolvedValueOnce(existing);
    memberFindManyMock.mockImplementation(
      async ({ where }: { where: { userId: { in: string[] } } }) =>
        where.userId.in
          .filter((userId) => userId !== GUEST_ID)
          .map((userId) => ({ userId })),
    );
    coworkerFindManyMock.mockResolvedValue([
      {
        id: SOUPIE_ID,
        name: "Soupie",
        baseURL: "https://chat.example.com",
      },
    ]);
    roomUpdateMock.mockResolvedValueOnce(updated);
    userMemberDeleteManyMock.mockResolvedValue({ count: 1 });
    userMemberFindManyMock.mockResolvedValue([{ userId: GUEST_ID }]);
    userMemberCreateManyMock.mockResolvedValue({ count: 1 });
    readStateDeleteManyMock.mockResolvedValue({ count: 0 });
    readStateCreateManyMock.mockResolvedValue({ count: 0 });
    coworkerMemberDeleteManyMock.mockResolvedValue({ count: 0 });
    coworkerMemberCreateManyMock.mockResolvedValue({ count: 1 });

    const app = createApp(userAuthContext);
    const response = await app.request(`/${ROOM_ID}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        memberUserIds: [USER_ID, GUEST_ID],
        coworkerIds: [SOUPIE_ID],
      }),
    });

    expect(response.status).toBe(200);
    expect(coworkerMemberCreateManyMock).toHaveBeenCalledWith({
      data: [{ roomId: ROOM_ID, coworkerId: SOUPIE_ID }],
    });
    expect(userMemberDeleteManyMock).toHaveBeenCalledWith({
      where: { roomId: ROOM_ID, access: "member" },
    });
    const createdIds = userMemberCreateManyMock.mock.calls[0][0].data.map(
      (row: { userId: string }) => row.userId,
    );
    expect(createdIds).not.toContain(GUEST_ID);
    // Ignore, do not promote: echoed guests must not enter the host upgrade.
    expect(userMemberUpdateManyMock).toHaveBeenCalledWith({
      where: {
        roomId: ROOM_ID,
        userId: { in: [USER_ID] },
        access: "guest",
      },
      data: { access: "member" },
    });
    expect(
      userMemberUpdateManyMock.mock.calls[0][0].where.userId.in,
    ).not.toContain(GUEST_ID);
    expect(readStateDeleteManyMock).toHaveBeenCalledWith({
      where: {
        roomId: ROOM_ID,
        userId: { notIn: expect.arrayContaining([USER_ID, GUEST_ID]) },
      },
    });
  });

  it("still 400s when memberUserIds includes a non-guest who is not an organization member", async () => {
    const outsiderId = "user_outsider";
    roomFindFirstMock.mockResolvedValueOnce(channelRoom());
    memberFindManyMock.mockImplementation(
      async ({ where }: { where: { userId: { in: string[] } } }) =>
        where.userId.in
          .filter((userId) => userId !== outsiderId)
          .map((userId) => ({ userId })),
    );

    const app = createApp(userAuthContext);
    const response = await app.request(`/${ROOM_ID}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        memberUserIds: [USER_ID, outsiderId],
      }),
    });

    expect(response.status).toBe(400);
    expect(await response.text()).toContain(
      "Room human members must belong to the organization",
    );
    expect(roomUpdateMock).not.toHaveBeenCalled();
  });

  it("adds a coworker on an external channel when memberUserIds omits guests", async () => {
    const existing = externalChannelWithGuest(GUEST_ID);
    const updated = externalChannelWithGuest(GUEST_ID, {
      coworkerMembers: [
        {
          coworker: {
            id: SOUPIE_ID,
            name: "Soupie",
            slug: "soupie",
            image: null,
          },
        },
      ],
      orchestratorMembers: [],
    });
    roomFindFirstMock.mockResolvedValueOnce(existing);
    memberFindManyMock.mockImplementation(
      async ({ where }: { where: { userId: { in: string[] } } }) =>
        where.userId.in
          .filter((userId) => userId !== GUEST_ID)
          .map((userId) => ({ userId })),
    );
    coworkerFindManyMock.mockResolvedValue([
      {
        id: SOUPIE_ID,
        name: "Soupie",
        baseURL: "https://chat.example.com",
      },
    ]);
    roomUpdateMock.mockResolvedValueOnce(updated);
    userMemberDeleteManyMock.mockResolvedValue({ count: 1 });
    userMemberFindManyMock.mockResolvedValue([{ userId: GUEST_ID }]);
    userMemberCreateManyMock.mockResolvedValue({ count: 1 });
    readStateDeleteManyMock.mockResolvedValue({ count: 0 });
    readStateCreateManyMock.mockResolvedValue({ count: 0 });
    coworkerMemberDeleteManyMock.mockResolvedValue({ count: 0 });
    coworkerMemberCreateManyMock.mockResolvedValue({ count: 1 });

    const app = createApp(userAuthContext);
    const response = await app.request(`/${ROOM_ID}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        memberUserIds: [USER_ID],
        coworkerIds: [SOUPIE_ID],
      }),
    });

    expect(response.status).toBe(200);
    expect(coworkerMemberCreateManyMock).toHaveBeenCalledWith({
      data: [{ roomId: ROOM_ID, coworkerId: SOUPIE_ID }],
    });
    expect(userMemberDeleteManyMock).toHaveBeenCalledWith({
      where: { roomId: ROOM_ID, access: "member" },
    });
  });

  it("upgrades a guest who is now an organization member when they appear in memberUserIds", async () => {
    const existing = externalChannelWithGuest(GUEST_ID);
    const updated = externalChannelWithGuest(GUEST_ID, {
      userMembers: [
        hostUserMember(USER_ID, "Ada", "ada@example.com"),
        {
          ...guestUserMember(GUEST_ID),
          access: "member",
        },
      ],
    });
    roomFindFirstMock.mockResolvedValueOnce(existing);
    roomUpdateMock.mockResolvedValueOnce(updated);
    userMemberDeleteManyMock.mockResolvedValue({ count: 1 });
    userMemberUpdateManyMock.mockResolvedValue({ count: 1 });
    userMemberFindManyMock.mockResolvedValue([{ userId: GUEST_ID }]);
    userMemberCreateManyMock.mockResolvedValue({ count: 1 });
    readStateDeleteManyMock.mockResolvedValue({ count: 0 });
    readStateCreateManyMock.mockResolvedValue({ count: 0 });

    const app = createApp(userAuthContext);
    const response = await app.request(`/${ROOM_ID}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        memberUserIds: [USER_ID, GUEST_ID],
      }),
    });

    expect(response.status).toBe(200);
    expect(userMemberUpdateManyMock).toHaveBeenCalledWith({
      where: {
        roomId: ROOM_ID,
        userId: { in: expect.arrayContaining([GUEST_ID]) },
        access: "guest",
      },
      data: { access: "member" },
    });
  });

  it("adds a personal assistant as an orchestrator member", async () => {
    const orchestratorId = "01960001-0001-7001-8001-000000000099";
    const existing = channelRoom();
    const updated = channelRoom({
      orchestratorMembers: [
        {
          orchestrator: {
            id: orchestratorId,
            name: "Soko Bot",
            avatarImageUrl: null,
            avatarSeed: "orb:user_123",
            userId: USER_ID,
            user: { name: "Ada" },
          },
        },
      ],
    });
    roomFindFirstMock.mockResolvedValueOnce(existing);
    sokoBotFindManyMock.mockResolvedValue([
      {
        id: orchestratorId,
        userId: USER_ID,
        name: "Soko Bot",
        user: { name: "Ada" },
      },
    ]);
    roomUpdateMock.mockResolvedValueOnce(updated);
    orchestratorMemberDeleteManyMock.mockResolvedValue({ count: 0 });
    orchestratorMemberCreateManyMock.mockResolvedValue({ count: 1 });

    const app = createApp(userAuthContext);
    const response = await app.request(`/${ROOM_ID}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        orchestratorIds: [orchestratorId],
      }),
    });

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.data.orchestratorMembers).toEqual([
      expect.objectContaining({
        id: orchestratorId,
        name: "Soko Bot",
      }),
    ]);
    expect(orchestratorMemberCreateManyMock).toHaveBeenCalledWith({
      data: [{ roomId: ROOM_ID, orchestratorId }],
    });
    expect(messageCreateMock).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ content: "Soko Bot joined" }),
      }),
    );
  });

  it("rejects adding someone else's personal assistant with 403", async () => {
    const orchestratorId = "01960001-0001-7001-8001-000000000099";
    roomFindFirstMock.mockResolvedValueOnce(channelRoom());
    sokoBotFindManyMock.mockResolvedValue([
      { id: orchestratorId, userId: OTHER_USER_ID, name: "Soko Bot" },
    ]);

    const app = createApp(userAuthContext);
    const response = await app.request(`/${ROOM_ID}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        orchestratorIds: [orchestratorId],
      }),
    });

    expect(response.status).toBe(403);
    expect(await response.text()).toContain(
      "Only the owner can add this personal assistant",
    );
    expect(orchestratorMemberCreateManyMock).not.toHaveBeenCalled();
  });

  it("fails only orchestrator mentions when the PA roster is cleared", async () => {
    const existing = channelRoom({
      orchestratorMembers: [
        {
          orchestrator: {
            id: "01960001-0001-7001-8001-000000000099",
            name: "Soko Bot",
            avatarImageUrl: null,
            avatarSeed: "orb:user_123",
            userId: USER_ID,
            user: { name: "Ada" },
          },
        },
      ],
    });
    const updated = channelRoom({ orchestratorMembers: [] });
    roomFindFirstMock.mockResolvedValueOnce(existing);
    roomUpdateMock.mockResolvedValueOnce(updated);
    failOpenMentionsMock.mockResolvedValue(["message_1"]);
    orchestratorMemberDeleteManyMock.mockResolvedValue({ count: 1 });

    const app = createApp(userAuthContext);
    const response = await app.request(`/${ROOM_ID}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ orchestratorIds: [] }),
    });

    expect(response.status).toBe(200);
    // The shared helper adds the pending/sent filter itself, and `notIn`
    // already skips rows with no orchestrator, so the call site only has to
    // name who is left. It returns the touched messages so the realtime
    // mention status can be published once the transaction commits.
    expect(failOpenMentionsMock).toHaveBeenCalledWith(
      {
        where: {
          orchestratorId: { notIn: [] },
          message: { roomId: ROOM_ID },
        },
        error: "Personal assistant is no longer a member of this room",
      },
      tx,
    );
    expect(publishMentionStatusesMock).toHaveBeenCalledWith(["message_1"]);
  });

  it("drops a personal assistant from a channel when its owner is removed", async () => {
    // The ownership check that gates adding an assistant skips one already in
    // the room, so without this another host could remove the owner and leave
    // the assistant behind: still mentionable by everyone, still spending the
    // departed owner's credits.
    const orchestratorId = "01960001-0001-7001-8001-0000000000c1";
    const ownerId = "user_owner_1";
    const existing = channelRoom({
      userMembers: [
        {
          userId: USER_ID,
          access: "member",
          user: {
            id: USER_ID,
            name: "Ada",
            email: "ada@example.com",
            image: null,
          },
        },
        {
          userId: ownerId,
          access: "member",
          user: {
            id: ownerId,
            name: "Owner",
            email: "owner@example.com",
            image: null,
          },
        },
      ],
      orchestratorMembers: [
        {
          orchestrator: {
            id: orchestratorId,
            name: "Soko Bot",
            avatarImageUrl: null,
            avatarSeed: "orb:owner",
            userId: ownerId,
            user: { name: "Owner" },
          },
        },
      ],
    });
    roomFindFirstMock.mockResolvedValueOnce(existing);
    roomUpdateMock.mockResolvedValueOnce(existing);
    userFindManyMock.mockResolvedValue([{ id: USER_ID, name: "Ada" }]);
    sokoBotFindManyMock.mockResolvedValue([
      {
        id: orchestratorId,
        userId: ownerId,
        name: "Soko Bot",
        user: { name: "Owner" },
      },
    ]);
    failOpenMentionsMock.mockResolvedValue(["message_9"]);
    orchestratorMemberDeleteManyMock.mockResolvedValue({ count: 1 });

    const app = createApp(userAuthContext);
    const response = await app.request(`/${ROOM_ID}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ memberUserIds: [USER_ID] }),
    });

    expect(response.status).toBe(200);
    expect(orchestratorMemberDeleteManyMock).toHaveBeenCalledWith({
      where: { roomId: ROOM_ID, orchestratorId: { in: [orchestratorId] } },
    });
    expect(failOpenMentionsMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          orchestratorId: { in: [orchestratorId] },
        }),
      }),
      tx,
    );
  });
});
