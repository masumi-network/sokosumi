import { OpenAPIHono } from "@hono/zod-openapi";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { OpenAPIHonoWithAuth } from "@/lib/hono";
import { defaultValidationHook } from "@/lib/hono";
import type { AuthVariables } from "@/middleware/auth";

import mountLeaveChatRoom from "./delete";

const {
  roomFindFirstMock,
  userMemberCountMock,
  userMemberDeleteManyMock,
  guestInvitationCountMock,
  readStateDeleteManyMock,
  queryRawMock,
  organizationFindUniqueMock,
  memberFindUniqueMock,
  userFindUniqueMock,
  messageCreateMock,
  prismaTransactionMock,
  publishChatRoomMessageRealtimeMock,
} = vi.hoisted(() => ({
  roomFindFirstMock: vi.fn(),
  userMemberCountMock: vi.fn(),
  userMemberDeleteManyMock: vi.fn(),
  guestInvitationCountMock: vi.fn(),
  readStateDeleteManyMock: vi.fn(),
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

const MEMBERSHIP_MESSAGE = {
  id: "550e8400-e29b-41d4-a716-446655440099",
  roomId: ROOM_ID,
  parentMessageId: null,
  senderUserId: null,
  senderCoworkerId: null,
  content: "user_self left",
  createdAt: new Date("2026-01-01T00:00:00.000Z"),
  deletedAt: null,
  editedAt: null,
  metadata: {
    membership: {
      action: "left",
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
  chatRoom: { findFirst: roomFindFirstMock },
  chatRoomUserMember: {
    count: userMemberCountMock,
    deleteMany: userMemberDeleteManyMock,
  },
  chatRoomGuestInvitation: {
    count: guestInvitationCountMock,
  },
  chatRoomReadState: { deleteMany: readStateDeleteManyMock },
  chatRoomMessage: { create: messageCreateMock },
  user: { findUnique: userFindUniqueMock },
  organization: { findUnique: organizationFindUniqueMock },
  member: { findUnique: memberFindUniqueMock },
  $queryRaw: queryRawMock,
};

function createApp() {
  const app = new OpenAPIHono<{ Variables: AuthVariables }>({
    defaultHook: defaultValidationHook,
  });
  app.use("*", async (c, next) => {
    c.set("isAuthenticated", true);
    c.set("authContext", {
      actor: "user",
      userId: SELF_ID,
      organizationId: "org_1",
      role: "user",
    });
    return await next();
  });
  mountLeaveChatRoom(app as unknown as OpenAPIHonoWithAuth);
  return app;
}

function member(id: string, access: "member" | "guest" = "member") {
  return {
    userId: id,
    access,
    user: {
      id,
      name: id,
      email: `${id}@example.com`,
      image: null,
      sessions: [],
    },
  };
}

function room(
  overrides: {
    kind?: string;
    memberIds?: string[];
    userMembers?: ReturnType<typeof member>[];
  } = {},
) {
  return {
    id: ROOM_ID,
    organizationId: "org_1",
    name: "general",
    slug: "general",
    kind: overrides.kind ?? "channel",
    directKey: null,
    topic: null,
    createdByUserId: OTHER_ID,
    createdAt: new Date("2026-01-01T00:00:00.000Z"),
    updatedAt: new Date("2026-01-01T00:00:00.000Z"),
    archivedAt: null,
    userMembers:
      overrides.userMembers ??
      (overrides.memberIds ?? [SELF_ID, OTHER_ID]).map((id) => member(id)),
    coworkerMembers: [],
  };
}

function leave() {
  return createApp().request(`/${ROOM_ID}/members/me`, { method: "DELETE" });
}

beforeEach(() => {
  vi.clearAllMocks();
  prismaTransactionMock.mockImplementation(async (cb) => cb(tx));
  organizationFindUniqueMock.mockResolvedValue({ id: "org_1" });
  memberFindUniqueMock.mockResolvedValue({ role: "member" });
  queryRawMock.mockResolvedValue([{ id: ROOM_ID, archivedAt: null }]);
  // Default happy path: another host remains after leave.
  userMemberCountMock.mockImplementation(
    async ({
      where,
    }: {
      where: { roomId: string; userId: { not: string }; access?: string };
    }) => {
      if (where.access === "member") return 1;
      if (where.access === "guest") return 0;
      return 1;
    },
  );
  userMemberDeleteManyMock.mockResolvedValue({ count: 1 });
  guestInvitationCountMock.mockResolvedValue(0);
  readStateDeleteManyMock.mockResolvedValue({ count: 1 });
  userFindUniqueMock.mockResolvedValue({ name: SELF_ID });
  messageCreateMock.mockResolvedValue(MEMBERSHIP_MESSAGE);
  publishChatRoomMessageRealtimeMock.mockResolvedValue(undefined);
});

describe("DELETE /chats/rooms/{id}/members/me", () => {
  it("removes only the caller's membership and read marker", async () => {
    roomFindFirstMock.mockResolvedValue(room());

    const response = await leave();

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.data).toEqual({
      id: ROOM_ID,
      remainingUserMemberCount: 1,
    });

    const sqlParts = queryRawMock.mock.calls[0]?.[0] as TemplateStringsArray;
    const sql = sqlParts.join(" ");
    expect(sql).toContain("FOR UPDATE");
    expect(sql).toContain("chat_room");
    expect(sql).toContain("archivedAt");
    expect(userMemberCountMock).toHaveBeenCalledWith({
      where: { roomId: ROOM_ID, userId: { not: SELF_ID } },
    });
    expect(userMemberDeleteManyMock).toHaveBeenCalledWith({
      where: { roomId: ROOM_ID, userId: SELF_ID },
    });
    expect(readStateDeleteManyMock).toHaveBeenCalledWith({
      where: { roomId: ROOM_ID, userId: SELF_ID },
    });
  });

  it("lets a plain member leave without any elevated role", async () => {
    roomFindFirstMock.mockResolvedValue(
      room({ memberIds: [SELF_ID, OTHER_ID, "user_third"] }),
    );
    memberFindUniqueMock.mockResolvedValue({ role: "member" });
    userMemberCountMock.mockImplementation(
      async ({ where }: { where: { access?: string } }) => {
        if (where.access === "member") return 2;
        if (where.access === "guest") return 0;
        return 2;
      },
    );

    const response = await leave();

    expect(response.status).toBe(200);
    expect((await response.json()).data.remainingUserMemberCount).toBe(2);
  });

  it("refuses to let the last member leave", async () => {
    roomFindFirstMock.mockResolvedValue(room({ memberIds: [SELF_ID] }));
    userMemberCountMock.mockResolvedValue(0);

    expect((await leave()).status).toBe(400);
    expect(userMemberDeleteManyMock).not.toHaveBeenCalled();
    expect(readStateDeleteManyMock).not.toHaveBeenCalled();
  });

  it("refuses last host leave while guests remain", async () => {
    const guestId = "user_guest";
    roomFindFirstMock.mockResolvedValue(
      room({
        userMembers: [member(SELF_ID, "member"), member(guestId, "guest")],
      }),
    );
    userMemberCountMock.mockImplementation(
      async ({ where }: { where: { access?: string } }) => {
        // Total remaining includes the guest.
        if (where.access === "member") return 0;
        if (where.access === "guest") return 1;
        return 1;
      },
    );

    const response = await leave();

    expect(response.status).toBe(400);
    expect(await response.text()).toMatch(/last host member/i);
    expect(userMemberDeleteManyMock).not.toHaveBeenCalled();
    expect(readStateDeleteManyMock).not.toHaveBeenCalled();
  });

  it("emits a left membership status message and publishes after commit", async () => {
    roomFindFirstMock.mockResolvedValue(room());

    const response = await leave();

    expect(response.status).toBe(200);
    expect(messageCreateMock).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          roomId: ROOM_ID,
          content: "user_self left",
          senderUserId: null,
          senderCoworkerId: null,
          metadata: {
            membership: {
              action: "left",
              subject: { type: "user", id: SELF_ID, name: "user_self" },
            },
          },
        }),
      }),
    );
    expect(publishChatRoomMessageRealtimeMock).toHaveBeenCalledWith(
      MEMBERSHIP_MESSAGE,
    );
  });

  it("does not emit membership status when refusing a direct leave", async () => {
    roomFindFirstMock.mockResolvedValue(room({ kind: "direct" }));

    expect((await leave()).status).toBe(400);
    expect(messageCreateMock).not.toHaveBeenCalled();
    expect(publishChatRoomMessageRealtimeMock).not.toHaveBeenCalled();
  });

  it("refuses to leave a direct room", async () => {
    roomFindFirstMock.mockResolvedValue(room({ kind: "direct" }));

    expect((await leave()).status).toBe(400);
    expect(queryRawMock).not.toHaveBeenCalled();
    expect(userMemberDeleteManyMock).not.toHaveBeenCalled();
  });

  it("404s when the caller is not a member", async () => {
    roomFindFirstMock.mockResolvedValue(null);

    expect((await leave()).status).toBe(404);
    expect(userMemberDeleteManyMock).not.toHaveBeenCalled();
  });

  it("404s when the room was archived under the lock", async () => {
    roomFindFirstMock.mockResolvedValue(room());
    queryRawMock.mockResolvedValue([
      { id: ROOM_ID, archivedAt: new Date("2026-02-02T10:00:00.000Z") },
    ]);

    expect((await leave()).status).toBe(404);
    expect(userMemberDeleteManyMock).not.toHaveBeenCalled();
    expect(readStateDeleteManyMock).not.toHaveBeenCalled();
  });
});
