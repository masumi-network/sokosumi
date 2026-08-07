import { OpenAPIHono } from "@hono/zod-openapi";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { OpenAPIHonoWithAuth } from "@/lib/hono";
import { defaultValidationHook } from "@/lib/hono";
import type { AuthVariables } from "@/middleware/auth";

import mountDeleteChatRoomMember from "./delete";

const {
  roomFindFirstMock,
  userMemberFindUniqueMock,
  userMemberDeleteManyMock,
  readStateDeleteManyMock,
  messageCreateMock,
  prismaTransactionMock,
  publishChatRoomMessageRealtimeMock,
  publishChatMembershipRevokedMock,
} = vi.hoisted(() => ({
  roomFindFirstMock: vi.fn(),
  userMemberFindUniqueMock: vi.fn(),
  userMemberDeleteManyMock: vi.fn(),
  readStateDeleteManyMock: vi.fn(),
  messageCreateMock: vi.fn(),
  prismaTransactionMock: vi.fn(),
  publishChatRoomMessageRealtimeMock: vi.fn(),
  publishChatMembershipRevokedMock: vi.fn(),
}));

vi.mock("@/lib/db/prisma", () => ({
  default: { $transaction: prismaTransactionMock },
}));

vi.mock("@/helpers/chat-room-message-realtime", () => ({
  publishChatRoomMessageRealtime: publishChatRoomMessageRealtimeMock,
}));

vi.mock("@/lib/ably/publish", () => ({
  publishChatMembershipRevoked: publishChatMembershipRevokedMock,
}));

const ROOM_ID = "550e8400-e29b-41d4-a716-446655440000";
const HOST_ID = "user_host";
const GUEST_ID = "user_guest";
const OTHER_HOST_ID = "user_other_host";
const ORG_ID = "org_1";

const MEMBERSHIP_MESSAGE = {
  id: "550e8400-e29b-41d4-a716-446655440099",
  roomId: ROOM_ID,
  parentMessageId: null,
  senderUserId: null,
  senderCoworkerId: null,
  content: "guest left",
  createdAt: new Date("2026-01-01T00:00:00.000Z"),
  deletedAt: null,
  editedAt: null,
  metadata: {
    membership: {
      action: "left",
      subject: { type: "user", id: GUEST_ID, name: "Guest" },
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
    findUnique: userMemberFindUniqueMock,
    deleteMany: userMemberDeleteManyMock,
    count: vi.fn().mockResolvedValue(1),
  },
  chatRoomReadState: { deleteMany: readStateDeleteManyMock },
  chatRoomMessage: { create: messageCreateMock },
  organization: {
    findUnique: vi.fn().mockResolvedValue({ id: ORG_ID, name: "Host Org" }),
  },
  member: {
    findUnique: vi.fn().mockResolvedValue({ id: "mem_1", role: "member" }),
  },
  user: { findUnique: vi.fn() },
};

function room(
  overrides: {
    callerId?: string;
    callerAccess?: "member" | "guest";
    kind?: string;
  } = {},
) {
  const callerId = overrides.callerId ?? HOST_ID;
  const callerAccess = overrides.callerAccess ?? "member";
  return {
    id: ROOM_ID,
    organizationId: ORG_ID,
    kind: overrides.kind ?? "channel",
    discoverability: "external",
    archivedAt: null,
    name: "Client",
    userMembers: [
      {
        userId: callerId,
        access: callerAccess,
        user: {
          id: callerId,
          name: "Host",
          email: "host@example.com",
          image: null,
          sessions: [],
        },
      },
      {
        userId: GUEST_ID,
        access: "guest",
        user: {
          id: GUEST_ID,
          name: "Guest",
          email: "guest@example.com",
          image: null,
          sessions: [],
        },
      },
    ],
    coworkerMembers: [],
  };
}

function createApp(userId = HOST_ID) {
  const app = new OpenAPIHono<{ Variables: AuthVariables }>({
    defaultHook: defaultValidationHook,
  });
  app.use("*", async (c, next) => {
    c.set("isAuthenticated", true);
    c.set("authContext", {
      actor: "user",
      userId,
      organizationId: ORG_ID,
      role: "user",
    });
    return await next();
  });
  mountDeleteChatRoomMember(app as unknown as OpenAPIHonoWithAuth);
  return app;
}

describe("DELETE /chats/rooms/{id}/members/{userId}", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    prismaTransactionMock.mockImplementation(
      async (fn: (client: typeof tx) => Promise<unknown>) => fn(tx),
    );
    messageCreateMock.mockResolvedValue(MEMBERSHIP_MESSAGE);
    userMemberDeleteManyMock.mockResolvedValue({ count: 1 });
    readStateDeleteManyMock.mockResolvedValue({ count: 1 });
    publishChatRoomMessageRealtimeMock.mockResolvedValue(undefined);
    publishChatMembershipRevokedMock.mockResolvedValue(undefined);
  });

  it("removes a guest when caller is a host member", async () => {
    roomFindFirstMock.mockResolvedValue(room());
    userMemberFindUniqueMock.mockResolvedValue({
      access: "guest",
      user: { id: GUEST_ID, name: "Guest" },
    });

    const response = await createApp().request(
      `/${ROOM_ID}/members/${GUEST_ID}`,
      { method: "DELETE" },
    );

    expect(response.status).toBe(200);
    expect(userMemberDeleteManyMock).toHaveBeenCalledWith({
      where: { roomId: ROOM_ID, userId: GUEST_ID },
    });
    expect(readStateDeleteManyMock).toHaveBeenCalledWith({
      where: { roomId: ROOM_ID, userId: GUEST_ID },
    });
    expect(publishChatMembershipRevokedMock).toHaveBeenCalledWith({
      userId: GUEST_ID,
      roomId: ROOM_ID,
      reason: "removed",
    });
  });

  it("rejects guest callers", async () => {
    roomFindFirstMock.mockResolvedValue(
      room({ callerId: GUEST_ID, callerAccess: "guest" }),
    );

    const response = await createApp(GUEST_ID).request(
      `/${ROOM_ID}/members/${OTHER_HOST_ID}`,
      { method: "DELETE" },
    );

    expect(response.status).toBe(403);
    expect(userMemberDeleteManyMock).not.toHaveBeenCalled();
  });

  it("rejects removing a host member", async () => {
    roomFindFirstMock.mockResolvedValue(room());
    userMemberFindUniqueMock.mockResolvedValue({
      access: "member",
      user: { id: OTHER_HOST_ID, name: "Other" },
    });

    const response = await createApp().request(
      `/${ROOM_ID}/members/${OTHER_HOST_ID}`,
      { method: "DELETE" },
    );

    expect(response.status).toBe(400);
    expect(userMemberDeleteManyMock).not.toHaveBeenCalled();
  });

  it("rejects removing self", async () => {
    roomFindFirstMock.mockResolvedValue(room());

    const response = await createApp().request(
      `/${ROOM_ID}/members/${HOST_ID}`,
      { method: "DELETE" },
    );

    expect(response.status).toBe(400);
    expect(userMemberDeleteManyMock).not.toHaveBeenCalled();
  });
});
