import { beforeEach, describe, expect, it, vi } from "vitest";
import { publishChatRoomPinnedMessageRealtime } from "@/helpers/chat-room-pinned-message-realtime";
import { errorHandler } from "@/helpers/error-handler";
import { OpenAPIHonoWithAuth } from "@/lib/hono";
import type { AuthVariables } from "@/middleware/auth";

import mountPinChatRoomMessage from "./post";

vi.mock("@/middleware/auth", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/middleware/auth")>();
  const { stubAuthMiddleware } = await import(
    "@/test-fixtures/auth-middleware"
  );
  return { ...actual, authMiddleware: stubAuthMiddleware };
});

const {
  roomFindFirstMock,
  organizationFindUniqueMock,
  memberFindUniqueMock,
  messageFindFirstMock,
  pinCreateManyMock,
  pinCountMock,
  prismaTransactionMock,
} = vi.hoisted(() => ({
  roomFindFirstMock: vi.fn(),
  organizationFindUniqueMock: vi.fn(),
  memberFindUniqueMock: vi.fn(),
  messageFindFirstMock: vi.fn(),
  pinCreateManyMock: vi.fn(),
  pinCountMock: vi.fn(),
  prismaTransactionMock: vi.fn(),
}));

vi.mock("@/lib/db/prisma", () => ({
  default: {
    $transaction: prismaTransactionMock,
  },
}));

vi.mock("@/helpers/chat-room-pinned-message-realtime", () => ({
  publishChatRoomPinnedMessageRealtime: vi.fn().mockResolvedValue(undefined),
}));

const ROOM_ID = "550e8400-e29b-41d4-a716-446655440000";
const MESSAGE_ID = "550e8400-e29b-41d4-a716-446655440001";
const USER_ID = "user_123";
const ORG_ID = "org_1";

const tx = {
  chatRoom: {
    findFirst: roomFindFirstMock,
  },
  organization: {
    findUnique: organizationFindUniqueMock,
  },
  member: {
    findUnique: memberFindUniqueMock,
  },
  chatRoomMessage: {
    findFirst: messageFindFirstMock,
  },
  chatRoomPinnedMessage: {
    createMany: pinCreateManyMock,
    count: pinCountMock,
  },
};

function createApp(authContext: AuthVariables["authContext"]) {
  const app = new OpenAPIHonoWithAuth();

  app.use("*", async (c, next) => {
    c.set("requestId", "req_pin_message");
    c.set("isAuthenticated", true);
    c.set("authContext", authContext);
    return await next();
  });

  app.onError(errorHandler);
  mountPinChatRoomMessage(app);
  return app;
}

const userAuthContext: AuthVariables["authContext"] = {
  actor: "user",
  userId: USER_ID,
  organizationId: ORG_ID,
  role: "user",
};

function membershipRoom(kind = "channel") {
  return {
    id: ROOM_ID,
    organizationId: ORG_ID,
    kind,
    userMembers: [{ access: "member" }],
  };
}

function contentMessage(
  overrides: {
    parentMessageId?: string | null;
    deletedAt?: Date | null;
    metadata?: unknown;
  } = {},
) {
  return {
    id: MESSAGE_ID,
    roomId: ROOM_ID,
    parentMessageId: overrides.parentMessageId ?? null,
    deletedAt: overrides.deletedAt ?? null,
    metadata: overrides.metadata ?? null,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  prismaTransactionMock.mockImplementation(async (cb) => cb(tx));
  roomFindFirstMock.mockResolvedValue(membershipRoom());
  organizationFindUniqueMock.mockResolvedValue({ id: ORG_ID });
  memberFindUniqueMock.mockResolvedValue({
    id: "member_1",
    userId: USER_ID,
    organizationId: ORG_ID,
    role: "member",
  });
  messageFindFirstMock.mockResolvedValue(contentMessage());
  pinCreateManyMock.mockResolvedValue({ count: 1 });
  pinCountMock.mockResolvedValue(1);
});

describe("POST /chats/rooms/{id}/messages/{messageId}/pin", () => {
  it("pins a top-level Channel message and returns the list count", async () => {
    const response = await createApp(userAuthContext).request(
      `/${ROOM_ID}/messages/${MESSAGE_ID}/pin`,
      { method: "POST" },
    );

    expect(response.status).toBe(200);
    expect(pinCreateManyMock).toHaveBeenCalledWith({
      data: {
        roomId: ROOM_ID,
        messageId: MESSAGE_ID,
        pinnedByUserId: USER_ID,
      },
      skipDuplicates: true,
    });
    const body = await response.json();
    expect(body.data).toEqual({
      messageId: MESSAGE_ID,
      pinnedMessageCount: 1,
    });
    expect(publishChatRoomPinnedMessageRealtime).toHaveBeenCalledWith({
      action: "pin",
      roomId: ROOM_ID,
      messageId: MESSAGE_ID,
      pinnedMessageCount: 1,
    });
  });

  it("rejects pinning in a Direct", async () => {
    roomFindFirstMock.mockResolvedValue(membershipRoom("direct"));

    const response = await createApp(userAuthContext).request(
      `/${ROOM_ID}/messages/${MESSAGE_ID}/pin`,
      { method: "POST" },
    );

    expect(response.status).toBe(400);
    expect(pinCreateManyMock).not.toHaveBeenCalled();
  });

  it("rejects pinning a thread reply", async () => {
    messageFindFirstMock.mockResolvedValue(
      contentMessage({
        parentMessageId: "550e8400-e29b-41d4-a716-446655440099",
      }),
    );

    const response = await createApp(userAuthContext).request(
      `/${ROOM_ID}/messages/${MESSAGE_ID}/pin`,
      { method: "POST" },
    );

    expect(response.status).toBe(400);
    expect(pinCreateManyMock).not.toHaveBeenCalled();
  });

  it("404s when the message is deleted", async () => {
    messageFindFirstMock.mockResolvedValue(
      contentMessage({ deletedAt: new Date("2026-08-01T00:00:00.000Z") }),
    );

    const response = await createApp(userAuthContext).request(
      `/${ROOM_ID}/messages/${MESSAGE_ID}/pin`,
      { method: "POST" },
    );

    expect(response.status).toBe(404);
    expect(pinCreateManyMock).not.toHaveBeenCalled();
  });

  it("rejects pinning a membership status message", async () => {
    messageFindFirstMock.mockResolvedValue(
      contentMessage({
        metadata: {
          membership: {
            action: "joined",
            subject: { type: "user", id: USER_ID, name: "Ada" },
          },
        },
      }),
    );

    const response = await createApp(userAuthContext).request(
      `/${ROOM_ID}/messages/${MESSAGE_ID}/pin`,
      { method: "POST" },
    );

    expect(response.status).toBe(400);
    expect(pinCreateManyMock).not.toHaveBeenCalled();
  });

  it("is idempotent when the message is already pinned", async () => {
    pinCreateManyMock.mockResolvedValue({ count: 0 });
    pinCountMock.mockResolvedValue(1);

    const response = await createApp(userAuthContext).request(
      `/${ROOM_ID}/messages/${MESSAGE_ID}/pin`,
      { method: "POST" },
    );

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.data.pinnedMessageCount).toBe(1);
    expect(publishChatRoomPinnedMessageRealtime).not.toHaveBeenCalled();
  });

  it("rejects coworker actors", async () => {
    const response = await createApp({
      actor: "coworker",
      coworkerId: "cow_1",
      vendorId: "01960001-0001-7001-8001-000000000001",
      context: { userId: USER_ID, organizationId: ORG_ID },
    }).request(`/${ROOM_ID}/messages/${MESSAGE_ID}/pin`, { method: "POST" });

    expect(response.status).toBe(403);
    expect(pinCreateManyMock).not.toHaveBeenCalled();
  });
});
