import { OpenAPIHono } from "@hono/zod-openapi";
import type { RequestIdVariables } from "hono/request-id";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { errorHandler } from "@/helpers/error-handler";
import type { OpenAPIHonoWithAuth } from "@/lib/hono";
import { defaultValidationHook } from "@/lib/hono";
import type { AuthVariables } from "@/middleware/auth";

import mountAcceptInviteeInvitation from "./post";

const {
  userFindUniqueMock,
  invitationFindUniqueMock,
  invitationUpdateMock,
  userMemberFindUniqueMock,
  userMemberCreateMock,
  readStateCreateManyMock,
  memberFindUniqueMock,
  messageCreateMock,
  prismaTransactionMock,
  publishChatRoomMessageRealtimeMock,
} = vi.hoisted(() => ({
  userFindUniqueMock: vi.fn(),
  invitationFindUniqueMock: vi.fn(),
  invitationUpdateMock: vi.fn(),
  userMemberFindUniqueMock: vi.fn(),
  userMemberCreateMock: vi.fn(),
  readStateCreateManyMock: vi.fn(),
  memberFindUniqueMock: vi.fn(),
  messageCreateMock: vi.fn(),
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
  chatRoomGuestInvitation: {
    findUnique: invitationFindUniqueMock,
    update: invitationUpdateMock,
  },
  chatRoomUserMember: {
    findUnique: userMemberFindUniqueMock,
    create: userMemberCreateMock,
  },
  chatRoomReadState: { createMany: readStateCreateManyMock },
  member: { findUnique: memberFindUniqueMock },
  chatRoomMessage: { create: messageCreateMock },
};

function createApp(
  authContext: AuthVariables["authContext"] = {
    actor: "user",
    userId: GUEST_ID,
    organizationId: "guest_org",
    role: "user",
  },
) {
  const app = new OpenAPIHono<{
    Variables: AuthVariables & RequestIdVariables;
  }>({
    defaultHook: defaultValidationHook,
  });

  app.use("*", async (c, next) => {
    c.set("requestId", "req_accept_invite");
    c.set("isAuthenticated", true);
    c.set("authContext", authContext);
    return await next();
  });

  app.onError(errorHandler);
  mountAcceptInviteeInvitation(app as unknown as OpenAPIHonoWithAuth);
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
    email: "Guest@Example.com",
    name: "Guest User",
  });
  invitationFindUniqueMock.mockResolvedValue(pendingInvitation());
  userMemberFindUniqueMock.mockResolvedValue(null);
  memberFindUniqueMock.mockResolvedValue(null);
  userMemberCreateMock.mockResolvedValue({
    id: "mem_row",
    roomId: ROOM_ID,
    userId: GUEST_ID,
    access: "guest",
  });
  readStateCreateManyMock.mockResolvedValue({ count: 1 });
  invitationUpdateMock.mockResolvedValue(
    pendingInvitation({ status: "accepted" }),
  );
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
    expect(invitationUpdateMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: INVITE_ID },
        data: expect.objectContaining({
          status: "accepted",
          acceptedByUserId: GUEST_ID,
          acceptedAt: expect.any(Date),
        }),
      }),
    );
    // No org Member create — only the host-membership check.
    expect(memberFindUniqueMock).toHaveBeenCalled();
    expect(publishChatRoomMessageRealtimeMock).toHaveBeenCalledOnce();
  });

  it("accept rejects email mismatch", async () => {
    userFindUniqueMock.mockResolvedValue({
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
    expect(invitationUpdateMock).not.toHaveBeenCalled();
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
    expect(invitationUpdateMock).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: "accepted" }),
      }),
    );
  });
});
