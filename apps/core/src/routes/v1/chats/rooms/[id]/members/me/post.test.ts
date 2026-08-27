import { beforeEach, describe, expect, it, vi } from "vitest";
import { OpenAPIHonoWithAuth } from "@/lib/hono";
import type { AuthVariables } from "@/middleware/auth";

import mountJoinChatRoom from "./post";

vi.mock("@/middleware/auth", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/middleware/auth")>();
  const { stubAuthMiddleware } = await import(
    "@/test-fixtures/auth-middleware"
  );
  return { ...actual, authMiddleware: stubAuthMiddleware };
});

const {
  roomFindFirstMock,
  roomFindFirstOrThrowMock,
  userMemberFindUniqueMock,
  userMemberCreateMock,
  userMemberUpdateMock,
  readStateCreateManyMock,
  queryRawMock,
  organizationFindUniqueMock,
  memberFindUniqueMock,
  userFindUniqueMock,
  messageCreateMock,
  prismaTransactionMock,
  publishChatRoomMessageRealtimeMock,
} = vi.hoisted(() => ({
  roomFindFirstMock: vi.fn(),
  roomFindFirstOrThrowMock: vi.fn(),
  userMemberFindUniqueMock: vi.fn(),
  userMemberCreateMock: vi.fn(),
  userMemberUpdateMock: vi.fn(),
  readStateCreateManyMock: vi.fn(),
  queryRawMock: vi.fn(),
  organizationFindUniqueMock: vi.fn(),
  memberFindUniqueMock: vi.fn(),
  userFindUniqueMock: vi.fn(),
  messageCreateMock: vi.fn(),
  prismaTransactionMock: vi.fn(),
  publishChatRoomMessageRealtimeMock: vi.fn(),
}));

vi.mock("@/lib/db/prisma", () => ({
  default: { $transaction: prismaTransactionMock },
}));

vi.mock("@/helpers/chat-room-message-realtime", () => ({
  publishChatRoomMessageRealtime: publishChatRoomMessageRealtimeMock,
}));

const ROOM_ID = "550e8400-e29b-41d4-a716-446655440000";
const SELF_ID = "user_self";
const OTHER_ID = "user_other";
const ORG_ID = "org_1";

const MEMBERSHIP_MESSAGE = {
  id: "550e8400-e29b-41d4-a716-446655440099",
  roomId: ROOM_ID,
  parentMessageId: null,
  senderUserId: null,
  senderCoworkerId: null,
  content: "user_self joined",
  createdAt: new Date("2026-01-01T00:00:00.000Z"),
  deletedAt: null,
  editedAt: null,
  metadata: {
    membership: {
      action: "joined",
      subject: { type: "user", id: SELF_ID, name: "user_self" },
    },
  },
  clientMessageId: null,
  responsesApiResponseId: null,
  senderUser: null,
  senderCoworker: null,
  mentionsAsSource: [],
  reactions: [],
  replies: [],
  _count: { replies: 0 },
};

const tx = {
  chatRoom: {
    findFirst: roomFindFirstMock,
    findFirstOrThrow: roomFindFirstOrThrowMock,
  },
  chatRoomUserMember: {
    findUnique: userMemberFindUniqueMock,
    create: userMemberCreateMock,
    update: userMemberUpdateMock,
  },
  chatRoomReadState: {
    createMany: readStateCreateManyMock,
  },
  chatRoomMessage: {
    create: messageCreateMock,
  },
  user: { findUnique: userFindUniqueMock },
  organization: { findUnique: organizationFindUniqueMock },
  member: { findUnique: memberFindUniqueMock },
  $queryRaw: queryRawMock,
};

function createApp(
  authContext: AuthVariables["authContext"] = {
    actor: "user",
    userId: SELF_ID,
    organizationId: ORG_ID,
    role: "user",
  },
) {
  const app = new OpenAPIHonoWithAuth();
  app.use("*", async (c, next) => {
    c.set("isAuthenticated", true);
    c.set("authContext", authContext);
    return await next();
  });
  mountJoinChatRoom(app);
  return app;
}

function member(id: string) {
  return {
    user: {
      id,
      name: id,
      email: `${id}@example.com`,
      image: null,
      sessions: [],
    },
  };
}

function publicChannel(overrides: Record<string, unknown> = {}) {
  return {
    id: ROOM_ID,
    organizationId: ORG_ID,
    name: "general",
    slug: "general",
    kind: "channel",
    directKey: null,
    topic: null,
    discoverability: "public",
    createdByUserId: OTHER_ID,
    createdAt: new Date("2026-01-01T00:00:00.000Z"),
    updatedAt: new Date("2026-01-01T00:00:00.000Z"),
    archivedAt: null,
    userMembers: [member(OTHER_ID)],
    coworkerMembers: [],
    ...overrides,
  };
}

function join() {
  return createApp().request(`/${ROOM_ID}/members/me`, { method: "POST" });
}

beforeEach(() => {
  vi.clearAllMocks();
  prismaTransactionMock.mockImplementation(async (cb) => cb(tx));
  organizationFindUniqueMock.mockResolvedValue({ id: ORG_ID });
  memberFindUniqueMock.mockResolvedValue({ role: "member" });
  queryRawMock.mockResolvedValue([
    {
      id: ROOM_ID,
      kind: "channel",
      discoverability: "public",
      archivedAt: null,
      organizationId: ORG_ID,
    },
  ]);
  userMemberFindUniqueMock.mockResolvedValue(null);
  userMemberCreateMock.mockResolvedValue({ id: "mem_1" });
  readStateCreateManyMock.mockResolvedValue({ count: 1 });
  userFindUniqueMock.mockResolvedValue({ name: SELF_ID });
  messageCreateMock.mockResolvedValue(MEMBERSHIP_MESSAGE);
  publishChatRoomMessageRealtimeMock.mockResolvedValue(undefined);
  const joined = publicChannel({
    userMembers: [member(OTHER_ID), member(SELF_ID)],
  });
  roomFindFirstMock.mockResolvedValue(publicChannel());
  roomFindFirstOrThrowMock.mockResolvedValue(joined);
});

describe("POST /chats/rooms/{id}/members/me", () => {
  it("adds membership and read state for a public channel", async () => {
    const response = await join();

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.data.id).toBe(ROOM_ID);
    expect(body.data.discoverability).toBe("public");
    expect(body.data.userMembers.map((m: { id: string }) => m.id)).toEqual([
      OTHER_ID,
      SELF_ID,
    ]);

    const sqlParts = queryRawMock.mock.calls[0]?.[0] as TemplateStringsArray;
    const sql = sqlParts.join(" ");
    expect(sql).toContain("FOR UPDATE");
    expect(userMemberCreateMock).toHaveBeenCalledWith({
      data: { roomId: ROOM_ID, userId: SELF_ID, access: "member" },
    });
    expect(readStateCreateManyMock).toHaveBeenCalledWith({
      data: [{ roomId: ROOM_ID, userId: SELF_ID }],
      skipDuplicates: true,
    });
  });

  it("emits a joined membership status message and publishes after commit", async () => {
    const response = await join();

    expect(response.status).toBe(200);
    expect(messageCreateMock).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          roomId: ROOM_ID,
          content: "user_self joined",
          senderUserId: null,
          senderCoworkerId: null,
          metadata: {
            membership: {
              action: "joined",
              subject: { type: "user", id: SELF_ID, name: "user_self" },
            },
          },
        }),
      }),
    );
    expect(publishChatRoomMessageRealtimeMock).toHaveBeenCalledWith(
      MEMBERSHIP_MESSAGE,
      "create",
    );
  });

  it("is idempotent when already a member", async () => {
    userMemberFindUniqueMock.mockResolvedValue({
      id: "mem_existing",
      access: "member",
    });
    roomFindFirstOrThrowMock.mockResolvedValue(
      publicChannel({
        userMembers: [member(OTHER_ID), member(SELF_ID)],
      }),
    );

    const response = await join();

    expect(response.status).toBe(200);
    expect(userMemberCreateMock).not.toHaveBeenCalled();
    expect(userMemberUpdateMock).not.toHaveBeenCalled();
    expect(readStateCreateManyMock).not.toHaveBeenCalled();
    expect(messageCreateMock).not.toHaveBeenCalled();
    expect(publishChatRoomMessageRealtimeMock).not.toHaveBeenCalled();
  });

  it("upgrades guest to member when host-org member self-joins", async () => {
    userMemberFindUniqueMock.mockResolvedValue({
      id: "mem_guest",
      access: "guest",
    });
    userMemberUpdateMock.mockResolvedValue({
      id: "mem_guest",
      access: "member",
    });
    roomFindFirstOrThrowMock.mockResolvedValue(
      publicChannel({
        discoverability: "external",
        userMembers: [member(OTHER_ID), member(SELF_ID)],
      }),
    );

    const response = await join();

    expect(response.status).toBe(200);
    expect(userMemberUpdateMock).toHaveBeenCalledWith({
      where: {
        roomId_userId: { roomId: ROOM_ID, userId: SELF_ID },
      },
      data: { access: "member" },
    });
    expect(userMemberCreateMock).not.toHaveBeenCalled();
    // Already in the room as guest — no second join status.
    expect(messageCreateMock).not.toHaveBeenCalled();
    expect(publishChatRoomMessageRealtimeMock).not.toHaveBeenCalled();
  });

  it("returns 404 for a private channel", async () => {
    roomFindFirstMock.mockResolvedValue(null);

    const response = await join();

    expect(response.status).toBe(404);
    expect(userMemberCreateMock).not.toHaveBeenCalled();
  });

  it("returns 404 when the locked row is no longer public", async () => {
    queryRawMock.mockResolvedValue([
      {
        id: ROOM_ID,
        kind: "channel",
        discoverability: "private",
        archivedAt: null,
        organizationId: ORG_ID,
      },
    ]);

    const response = await join();

    expect(response.status).toBe(404);
    expect(userMemberCreateMock).not.toHaveBeenCalled();
  });

  it("rejects when there is no active organization", async () => {
    const response = await createApp({
      actor: "user",
      userId: SELF_ID,
      organizationId: null,
      role: "user",
    }).request(`/${ROOM_ID}/members/me`, { method: "POST" });

    expect(response.status).toBe(400);
    expect(prismaTransactionMock).not.toHaveBeenCalled();
  });
});
