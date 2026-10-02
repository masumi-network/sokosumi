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
  roomFindUniqueOrThrowMock,
  organizationFindUniqueMock,
  memberFindUniqueMock,
  memberFindManyMock,
  coworkerFindManyMock,
  sokoBotFindManyMock,
  sokoBotMemberDeleteManyMock,
  sokoBotMemberCreateManyMock,
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
  publishChatRoomMembershipStatusMessagesBestEffortMock,
  publishChatMembershipRevokedToUsersMock,
} = vi.hoisted(() => ({
  roomFindFirstMock: vi.fn(),
  roomFindManyMock: vi.fn(),
  roomUpdateMock: vi.fn(),
  roomFindUniqueOrThrowMock: vi.fn(),
  organizationFindUniqueMock: vi.fn(),
  memberFindUniqueMock: vi.fn(),
  memberFindManyMock: vi.fn(),
  coworkerFindManyMock: vi.fn(),
  sokoBotFindManyMock: vi.fn(),
  sokoBotMemberDeleteManyMock: vi.fn(),
  sokoBotMemberCreateManyMock: vi.fn(),
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
  publishChatRoomMembershipStatusMessagesBestEffortMock: vi.fn(),
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
  publishChatRoomMembershipStatusMessagesBestEffort:
    publishChatRoomMembershipStatusMessagesBestEffortMock,
}));

vi.mock("@/helpers/chat-room-mention-status", () => ({
  failOpenChatRoomMentions: failOpenMentionsMock,
  publishChatRoomMentionStatuses: publishMentionStatusesMock,
}));

vi.mock("@/lib/ably/publish", () => ({
  publishChatRoomsChanged: vi.fn(),
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
    findUniqueOrThrow: roomFindUniqueOrThrowMock,
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
  chatRoomSokoBotMember: {
    deleteMany: sokoBotMemberDeleteManyMock,
    createMany: sokoBotMemberCreateManyMock,
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
    groupName: null,
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
    sokoBotMembers: [],
    readStates: [],
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

beforeEach(() => {
  vi.clearAllMocks();
  prismaTransactionMock.mockImplementation(async (callback) => callback(tx));
  organizationFindUniqueMock.mockResolvedValue({ id: ORG_ID });
  memberFindUniqueMock.mockResolvedValue({ role: "member" });
  roomFindManyMock.mockResolvedValue([]);
  roomFindUniqueOrThrowMock.mockResolvedValue(channelRoom());
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
    senderSokoBotId: null,
    content: data.content,
    createdAt: new Date("2026-01-01T00:00:00.000Z"),
    deletedAt: null,
    editedAt: null,
    metadata: data.metadata,
    clientMessageId: null,
    responsesApiResponseId: null,
    senderUser: null,
    senderCoworker: null,
    senderSokoBot: null,
    mentionsAsSource: [],
    reactions: [],
    replies: [],
    _count: { replies: 0 },
  }));
  publishChatRoomMembershipStatusMessagesBestEffortMock.mockResolvedValue(
    undefined,
  );
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
    roomFindUniqueOrThrowMock.mockResolvedValue(updated);

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
    roomFindUniqueOrThrowMock.mockResolvedValue(updated);

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

  it("ignores the roster an older client still sends, under a serializable transaction", async () => {
    const existing = channelRoom();
    roomFindFirstMock.mockResolvedValueOnce(existing);
    roomUpdateMock.mockResolvedValueOnce(existing);

    const app = createApp(userAuthContext);
    const response = await app.request(`/${ROOM_ID}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        memberUserIds: [USER_ID],
        coworkerIds: [],
        sokoBotIds: [],
      }),
    });

    expect(response.status).toBe(200);
    expect(userMemberDeleteManyMock).not.toHaveBeenCalled();
    expect(userMemberCreateManyMock).not.toHaveBeenCalled();
    expect(coworkerMemberDeleteManyMock).not.toHaveBeenCalled();
    expect(sokoBotMemberDeleteManyMock).not.toHaveBeenCalled();
    expect(messageCreateMock).not.toHaveBeenCalled();
    expect(prismaTransactionMock).toHaveBeenCalledWith(expect.any(Function), {
      isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
    });
  });

  it("returns 409 concurrency_conflict when a concurrent edit races", async () => {
    prismaTransactionMock.mockRejectedValue(
      Object.assign(new Error("Transaction failed"), { code: "P2034" }),
    );

    const app = createApp(userAuthContext);
    const response = await app.request(`/${ROOM_ID}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "Ops" }),
    });

    expect(response.status).toBe(409);
    const body = await response.json();
    expect(body.kind).toBe(CONCURRENCY_CONFLICT_KIND);
    expect(body.message).toMatch(/concurrently/i);
    expect(prismaTransactionMock).toHaveBeenCalledWith(expect.any(Function), {
      isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
    });
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
    roomFindUniqueOrThrowMock.mockResolvedValue(updated);

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
});

describe("PATCH /chats/rooms/{id} Group name", () => {
  const CARA_ID = "user_789";

  function groupDirect(overrides: Record<string, unknown> = {}) {
    return channelRoom({
      name: "Bob, Cara",
      slug: null,
      kind: "direct",
      directKey: `direct:v2:user:${USER_ID}:user:${OTHER_USER_ID}:user:${CARA_ID}`,
      discoverability: null,
      createdByUserId: OTHER_USER_ID,
      userMembers: [
        hostUserMember(USER_ID, "Ada", "ada@example.com"),
        hostUserMember(OTHER_USER_ID, "Bob", "bob@example.com"),
        hostUserMember(CARA_ID, "Cara", "cara@example.com"),
      ],
      ...overrides,
    });
  }

  function patchRoom(body: Record<string, unknown>) {
    return createApp(userAuthContext).request(`/${ROOM_ID}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
  }

  /** The room as the update and the re-read after the status row return it. */
  function savedAs(room: ReturnType<typeof groupDirect>) {
    roomUpdateMock.mockResolvedValue(room);
    roomFindUniqueOrThrowMock.mockResolvedValue(room);
  }

  it("lets any member name a group Direct and records who did", async () => {
    roomFindFirstMock.mockResolvedValueOnce(groupDirect());
    savedAs(groupDirect({ groupName: "Launch crew" }));

    const response = await patchRoom({ groupName: "  Launch crew  " });

    expect(response.status).toBe(200);
    expect(roomUpdateMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: ROOM_ID },
        data: { groupName: "Launch crew" },
      }),
    );
    expect(messageCreateMock).toHaveBeenCalledTimes(1);
    expect(messageCreateMock).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          roomId: ROOM_ID,
          content: "Ada named the group Launch crew",
          senderUserId: null,
          metadata: {
            groupNameChange: {
              action: "named",
              name: "Launch crew",
              actor: { id: USER_ID, name: "Ada" },
            },
          },
        }),
      }),
    );
    expect(
      publishChatRoomMembershipStatusMessagesBestEffortMock,
    ).toHaveBeenCalledWith([
      expect.objectContaining({
        metadata: expect.objectContaining({
          groupNameChange: expect.objectContaining({ action: "named" }),
        }),
      }),
    ]);
    const body = await response.json();
    expect(body.data.groupName).toBe("Launch crew");
    expect(body.data.isGroupDirect).toBe(true);
    // No organization role is asked for: naming is a member right.
    expect(memberFindUniqueMock).not.toHaveBeenCalledWith(
      expect.objectContaining({ select: { role: true } }),
    );
  });

  it("renames a group someone else named", async () => {
    roomFindFirstMock.mockResolvedValueOnce(
      groupDirect({ groupName: "Launch crew" }),
    );
    savedAs(groupDirect({ groupName: "Ship it" }));

    const response = await patchRoom({ groupName: "Ship it" });

    expect(response.status).toBe(200);
    expect(messageCreateMock).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          content: "Ada named the group Ship it",
        }),
      }),
    );
  });

  it.each([
    ["an empty string", ""],
    ["whitespace", "   "],
    ["null", null],
  ])("clears the name when sent %s", async (_label, groupName) => {
    roomFindFirstMock.mockResolvedValueOnce(
      groupDirect({ groupName: "Launch crew" }),
    );
    savedAs(groupDirect());

    const response = await patchRoom({ groupName });

    expect(response.status).toBe(200);
    expect(roomUpdateMock).toHaveBeenCalledWith(
      expect.objectContaining({ data: { groupName: null } }),
    );
    expect(messageCreateMock).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          content: "Ada removed the group name",
          metadata: {
            groupNameChange: {
              action: "cleared",
              name: null,
              actor: { id: USER_ID, name: "Ada" },
            },
          },
        }),
      }),
    );
    const body = await response.json();
    expect(body.data.groupName).toBeNull();
  });

  it.each([
    ["the current name again", "Launch crew", "Launch crew"],
    ["a clear of an unnamed group", null, null],
    ["a blank name for an unnamed group", null, ""],
  ])("does nothing for %s", async (_label, current, groupName) => {
    roomFindFirstMock.mockResolvedValueOnce(
      groupDirect({ groupName: current }),
    );

    const response = await patchRoom({ groupName });

    expect(response.status).toBe(200);
    expect(roomUpdateMock).not.toHaveBeenCalled();
    expect(messageCreateMock).not.toHaveBeenCalled();
    expect(
      publishChatRoomMembershipStatusMessagesBestEffortMock,
    ).not.toHaveBeenCalled();
    const body = await response.json();
    expect(body.data.groupName).toBe(current);
  });

  it("rejects a name over 80 characters", async () => {
    const response = await patchRoom({ groupName: "x".repeat(81) });

    expect(response.status).toBe(422);
    expect(roomUpdateMock).not.toHaveBeenCalled();
  });

  it("keeps the name nameable after the group shrank", async () => {
    roomFindFirstMock.mockResolvedValueOnce(
      groupDirect({
        userMembers: [
          hostUserMember(USER_ID, "Ada", "ada@example.com"),
          hostUserMember(OTHER_USER_ID, "Bob", "bob@example.com"),
        ],
      }),
    );
    savedAs(groupDirect({ groupName: "Launch crew" }));

    const response = await patchRoom({ groupName: "Launch crew" });

    expect(response.status).toBe(200);
    expect(messageCreateMock).toHaveBeenCalledTimes(1);
  });

  it.each([
    ["a 1:1 Direct", directRoom()],
    [
      "a Self Direct",
      channelRoom({
        organizationId: null,
        slug: null,
        kind: "direct",
        directKey: `direct:self:${USER_ID}`,
        discoverability: null,
      }),
    ],
    [
      "a coworker Direct",
      channelRoom({
        slug: null,
        kind: "direct",
        directKey: `coworker:${USER_ID}:cow_1`,
        discoverability: null,
      }),
    ],
    [
      "a Direct of two humans and a coworker",
      channelRoom({
        slug: null,
        kind: "direct",
        directKey: `direct:v2:coworker:cow_1:user:${OTHER_USER_ID}:user:${USER_ID}`,
        discoverability: null,
      }),
    ],
  ])("rejects naming %s", async (_label, room) => {
    roomFindFirstMock.mockResolvedValueOnce(room);

    const response = await patchRoom({ groupName: "Launch crew" });

    expect(response.status).toBe(400);
    expect(await response.text()).toContain("Only group Directs can be named.");
    expect(roomUpdateMock).not.toHaveBeenCalled();
    expect(messageCreateMock).not.toHaveBeenCalled();
  });

  it.each([
    ["name", { name: "Launch crew" }],
    ["topic", { topic: "Launch" }],
    ["members", { memberUserIds: [USER_ID, OTHER_USER_ID] }],
    [
      "a topic beside a Group name",
      { groupName: "Launch crew", topic: "Launch" },
    ],
  ])("still rejects %s on a group Direct", async (_label, body) => {
    roomFindFirstMock.mockResolvedValueOnce(groupDirect());

    const response = await patchRoom(body);

    expect(response.status).toBe(400);
    expect(await response.text()).toContain("Direct rooms cannot be edited.");
    expect(roomUpdateMock).not.toHaveBeenCalled();
    expect(userMemberDeleteManyMock).not.toHaveBeenCalled();
  });

  it("rejects a Group name on a Channel", async () => {
    roomFindFirstMock.mockResolvedValueOnce(channelRoom());
    memberFindUniqueMock.mockResolvedValue({ role: "admin" });

    const response = await patchRoom({ groupName: "Launch crew" });

    expect(response.status).toBe(400);
    expect(await response.text()).toContain("Only group Directs can be named.");
    expect(roomUpdateMock).not.toHaveBeenCalled();
  });
});
