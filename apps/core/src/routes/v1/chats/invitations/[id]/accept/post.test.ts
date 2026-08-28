import { beforeEach, describe, expect, it, vi } from "vitest";

import { errorHandler } from "@/helpers/error-handler";
import { OpenAPIHonoWithAuth } from "@/lib/hono";
import type { AuthVariables } from "@/middleware/auth";

import mountAcceptInviteeInvitation from "./post";

vi.mock("@/middleware/auth", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/middleware/auth")>();
  const { stubAuthMiddleware } = await import(
    "@/test-fixtures/auth-middleware"
  );
  return { ...actual, authMiddleware: stubAuthMiddleware };
});

const {
  userFindUniqueMock,
  invitationFindUniqueMock,
  invitationUpdateManyMock,
  userMemberFindUniqueMock,
  userMemberCreateMock,
  readStateCreateManyMock,
  memberFindUniqueMock,
  messageCreateMock,
  roomFindUniqueMock,
  queryRawMock,
  prismaTransactionMock,
  publishChatRoomMessageRealtimeMock,
} = vi.hoisted(() => ({
  userFindUniqueMock: vi.fn(),
  invitationFindUniqueMock: vi.fn(),
  invitationUpdateManyMock: vi.fn(),
  userMemberFindUniqueMock: vi.fn(),
  userMemberCreateMock: vi.fn(),
  readStateCreateManyMock: vi.fn(),
  memberFindUniqueMock: vi.fn(),
  messageCreateMock: vi.fn(),
  roomFindUniqueMock: vi.fn(),
  queryRawMock: vi.fn(),
  prismaTransactionMock: vi.fn(),
  publishChatRoomMessageRealtimeMock: vi.fn(),
}));

vi.mock("@/lib/db/prisma", () => ({
  default: {
    $transaction: prismaTransactionMock,
  },
}));

vi.mock("@/helpers/chat-room-message-realtime", () => ({
  publishChatRoomMessageRealtime: publishChatRoomMessageRealtimeMock,
}));

const INVITE_ID = "550e8400-e29b-41d4-a716-446655440010";
const ROOM_ID = "550e8400-e29b-41d4-a716-446655440000";
const GUEST_ID = "user_guest";
const OTHER_ID = "user_other";
const INVITER_ID = "user_inviter";
const ORG_ID = "org_1";

const tx = {
  user: { findUnique: userFindUniqueMock },
  chatRoom: { findUnique: roomFindUniqueMock },
  chatRoomGuestInvitation: {
    findUnique: invitationFindUniqueMock,
    updateMany: invitationUpdateManyMock,
  },
  chatRoomUserMember: {
    findUnique: userMemberFindUniqueMock,
    create: userMemberCreateMock,
  },
  chatRoomReadState: { createMany: readStateCreateManyMock },
  member: { findUnique: memberFindUniqueMock },
  chatRoomMessage: { create: messageCreateMock },
  $queryRaw: queryRawMock,
};

function createApp(
  authContext: AuthVariables["authContext"] = {
    actor: "user",
    userId: GUEST_ID,
    organizationId: "guest_org",
    role: "user",
  },
) {
  const app = new OpenAPIHonoWithAuth();

  app.use("*", async (c, next) => {
    c.set("requestId", "req_accept_invite");
    c.set("isAuthenticated", true);
    c.set("authContext", authContext);
    return await next();
  });

  app.onError(errorHandler);
  mountAcceptInviteeInvitation(app);
  return app;
}

function pendingInvitation(overrides: Record<string, unknown> = {}) {
  return {
    id: INVITE_ID,
    roomId: ROOM_ID,
    email: "guest@example.com",
    inviterId: INVITER_ID,
    status: "pending",
    expiresAt: new Date("2099-08-12T12:00:00.000Z"),
    acceptedAt: null,
    acceptedByUserId: null,
    createdAt: new Date("2026-08-05T12:00:00.000Z"),
    updatedAt: new Date("2026-08-05T12:00:00.000Z"),
    inviter: { id: INVITER_ID, name: "Ada Lovelace" },
    room: {
      id: ROOM_ID,
      name: "Client Room",
      kind: "channel",
      discoverability: "external",
      archivedAt: null,
      organizationId: ORG_ID,
      organization: { id: ORG_ID, name: "Acme Corp" },
    },
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  prismaTransactionMock.mockImplementation(async (cb) => cb(tx));
  userFindUniqueMock.mockResolvedValue({
    id: GUEST_ID,
    email: "Guest@Example.com",
    name: "Guest User",
  });
  invitationFindUniqueMock.mockResolvedValue(pendingInvitation());
  userMemberFindUniqueMock.mockResolvedValue(null);
  memberFindUniqueMock.mockResolvedValue(null);
  queryRawMock.mockResolvedValue([{ id: ROOM_ID }]);
  roomFindUniqueMock.mockResolvedValue({
    id: ROOM_ID,
    name: "Client Room",
    archivedAt: null,
    kind: "channel",
    discoverability: "external",
    organizationId: ORG_ID,
  });
  userMemberCreateMock.mockResolvedValue({
    id: "mem_row",
    roomId: ROOM_ID,
    userId: GUEST_ID,
    access: "guest",
  });
  readStateCreateManyMock.mockResolvedValue({ count: 1 });
  invitationUpdateManyMock.mockResolvedValue({ count: 1 });
  messageCreateMock.mockResolvedValue({
    id: "550e8400-e29b-41d4-a716-446655440099",
    roomId: ROOM_ID,
    parentMessageId: null,
    senderUserId: null,
    senderCoworkerId: null,
    content: "Guest User joined",
    createdAt: new Date("2026-08-05T12:00:00.000Z"),
    deletedAt: null,
    editedAt: null,
    metadata: {
      membership: {
        action: "joined",
        subject: { type: "user", id: GUEST_ID, name: "Guest User" },
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
  });
});

describe("POST /chats/invitations/{id}/accept", () => {
  it("accept creates guest membership without Member row", async () => {
    const response = await createApp().request(`/${INVITE_ID}/accept`, {
      method: "POST",
    });

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.data).toMatchObject({
      id: INVITE_ID,
      roomId: ROOM_ID,
      roomName: "Client Room",
      organizationId: ORG_ID,
      organizationName: "Acme Corp",
      email: "guest@example.com",
      status: "accepted",
      inviter: { id: INVITER_ID, name: "Ada Lovelace" },
    });

    expect(userMemberCreateMock).toHaveBeenCalledWith({
      data: {
        roomId: ROOM_ID,
        userId: GUEST_ID,
        access: "guest",
      },
    });
    expect(readStateCreateManyMock).toHaveBeenCalledWith(
      expect.objectContaining({
        data: [{ roomId: ROOM_ID, userId: GUEST_ID }],
        skipDuplicates: true,
      }),
    );
    expect(invitationUpdateManyMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          id: INVITE_ID,
          status: "pending",
          expiresAt: { gt: expect.any(Date) },
        }),
        data: expect.objectContaining({
          status: "accepted",
          acceptedByUserId: GUEST_ID,
          acceptedAt: expect.any(Date),
        }),
      }),
    );
    // Invitation row locked before room so revoke/decline serialize.
    expect(queryRawMock).toHaveBeenCalled();
    const lockSql = queryRawMock.mock.calls
      .map((call) => {
        const parts = call[0] as TemplateStringsArray | string[];
        return Array.isArray(parts) ? parts.join(" ") : String(parts);
      })
      .join(" ");
    expect(lockSql).toContain("chat_room_guest_invitation");
    expect(lockSql).toContain("FOR UPDATE");
    // No org Member create — only the host-membership check.
    expect(memberFindUniqueMock).toHaveBeenCalled();
    expect(publishChatRoomMessageRealtimeMock).toHaveBeenCalledOnce();
  });

  it("accept rejects email mismatch", async () => {
    userFindUniqueMock.mockResolvedValue({
      id: OTHER_ID,
      email: "other@example.com",
      name: "Other",
    });

    const response = await createApp({
      actor: "user",
      userId: OTHER_ID,
      organizationId: "other_org",
      role: "user",
    }).request(`/${INVITE_ID}/accept`, { method: "POST" });

    expect(response.status).toBe(404);
    expect(userMemberCreateMock).not.toHaveBeenCalled();
    expect(invitationUpdateManyMock).not.toHaveBeenCalled();
  });

  it("accept rejects host-org members", async () => {
    memberFindUniqueMock.mockResolvedValue({ id: "mem_host" });

    const response = await createApp().request(`/${INVITE_ID}/accept`, {
      method: "POST",
    });

    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.message).toMatch(/organization member/i);
    expect(userMemberCreateMock).not.toHaveBeenCalled();
  });

  it("accept is idempotent when already guest on room", async () => {
    userMemberFindUniqueMock.mockResolvedValue({ access: "guest" });

    const response = await createApp().request(`/${INVITE_ID}/accept`, {
      method: "POST",
    });

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.data.status).toBe("accepted");
    expect(userMemberCreateMock).not.toHaveBeenCalled();
    expect(invitationUpdateManyMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          id: INVITE_ID,
          status: "pending",
          expiresAt: { gt: expect.any(Date) },
        }),
        data: expect.objectContaining({ status: "accepted" }),
      }),
    );
  });

  it("accept rejects expired pending invite when already guest", async () => {
    userMemberFindUniqueMock.mockResolvedValue({ access: "guest" });
    invitationFindUniqueMock.mockResolvedValue(
      pendingInvitation({
        expiresAt: new Date("2020-01-01T00:00:00.000Z"),
      }),
    );

    const response = await createApp().request(`/${INVITE_ID}/accept`, {
      method: "POST",
    });

    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.message).toMatch(/expired/i);
    expect(userMemberCreateMock).not.toHaveBeenCalled();
    expect(invitationUpdateManyMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          id: INVITE_ID,
          status: "pending",
        }),
        data: { status: "expired" },
      }),
    );
  });

  it("accept rejects already-accepted invite when membership missing", async () => {
    invitationFindUniqueMock.mockResolvedValue(
      pendingInvitation({
        status: "accepted",
        acceptedAt: new Date("2026-08-05T13:00:00.000Z"),
        acceptedByUserId: GUEST_ID,
      }),
    );
    userMemberFindUniqueMock.mockResolvedValue(null);

    const response = await createApp().request(`/${INVITE_ID}/accept`, {
      method: "POST",
    });

    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.message).toMatch(/no longer pending/i);
    expect(userMemberCreateMock).not.toHaveBeenCalled();
    expect(invitationUpdateManyMock).not.toHaveBeenCalled();
  });

  it("accept fails and rolls back when invite is no longer pending (revoke race)", async () => {
    // beforeCreate accepts the invite before membership create; count 0 means
    // revoke/decline won — throw skips create and aborts the transaction.
    invitationUpdateManyMock.mockResolvedValue({ count: 0 });

    const response = await createApp().request(`/${INVITE_ID}/accept`, {
      method: "POST",
    });

    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.message).toMatch(/no longer pending/i);
    expect(userMemberCreateMock).not.toHaveBeenCalled();
    expect(invitationUpdateManyMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          id: INVITE_ID,
          status: "pending",
        }),
      }),
    );
    expect(publishChatRoomMessageRealtimeMock).not.toHaveBeenCalled();
  });

  it("accept does not demote concurrent host-member row on unique race", async () => {
    userMemberCreateMock.mockRejectedValue(
      Object.assign(new Error("Unique constraint failed"), { code: "P2002" }),
    );
    // First findUnique (pre-create): no row; second (after P2002): host member.
    userMemberFindUniqueMock
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ access: "member" });

    const response = await createApp().request(`/${INVITE_ID}/accept`, {
      method: "POST",
    });

    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.message).toMatch(/already a member/i);
    // Invite accept runs in beforeCreate; throwing after the unique race rolls
    // that write back with the rest of the transaction.
    expect(userMemberCreateMock).toHaveBeenCalled();
    expect(publishChatRoomMessageRealtimeMock).not.toHaveBeenCalled();
  });
});
