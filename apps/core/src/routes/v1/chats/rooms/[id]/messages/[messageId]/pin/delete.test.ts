import { beforeEach, describe, expect, it, vi } from "vitest";

import { publishChatRoomPinnedMessageRealtime } from "@/helpers/chat-room-pinned-message-realtime";
import { errorHandler } from "@/helpers/error-handler";
import { OpenAPIHonoWithAuth } from "@/lib/hono";
import type { AuthVariables } from "@/middleware/auth";

import mountUnpinChatRoomMessage from "./delete";

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
  pinDeleteManyMock,
  pinCountMock,
  prismaTransactionMock,
} = vi.hoisted(() => ({
  roomFindFirstMock: vi.fn(),
  organizationFindUniqueMock: vi.fn(),
  memberFindUniqueMock: vi.fn(),
  pinDeleteManyMock: vi.fn(),
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
  chatRoomPinnedMessage: {
    deleteMany: pinDeleteManyMock,
    count: pinCountMock,
  },
};

function createApp(authContext: AuthVariables["authContext"]) {
  const app = new OpenAPIHonoWithAuth();

  app.use("*", async (c, next) => {
    c.set("requestId", "req_unpin_message");
    c.set("isAuthenticated", true);
    c.set("authContext", authContext);
    return await next();
  });

  app.onError(errorHandler);
  mountUnpinChatRoomMessage(app);
  return app;
}

const userAuthContext: AuthVariables["authContext"] = {
  actor: "user",
  userId: USER_ID,
  organizationId: ORG_ID,
  role: "user",
};

beforeEach(() => {
  vi.clearAllMocks();
  prismaTransactionMock.mockImplementation(async (cb) => cb(tx));
  roomFindFirstMock.mockResolvedValue({
    id: ROOM_ID,
    organizationId: ORG_ID,
    kind: "channel",
    userMembers: [{ access: "member" }],
  });
  organizationFindUniqueMock.mockResolvedValue({ id: ORG_ID });
  memberFindUniqueMock.mockResolvedValue({
    id: "member_1",
    userId: USER_ID,
    organizationId: ORG_ID,
    role: "member",
  });
  pinDeleteManyMock.mockResolvedValue({ count: 1 });
  pinCountMock.mockResolvedValue(0);
});

describe("DELETE /chats/rooms/{id}/messages/{messageId}/pin", () => {
  it("unpins a Channel message and returns the remaining count", async () => {
    const response = await createApp(userAuthContext).request(
      `/${ROOM_ID}/messages/${MESSAGE_ID}/pin`,
      { method: "DELETE" },
    );

    expect(response.status).toBe(200);
    expect(pinDeleteManyMock).toHaveBeenCalledWith({
      where: { roomId: ROOM_ID, messageId: MESSAGE_ID },
    });
    const body = await response.json();
    expect(body.data).toEqual({
      messageId: MESSAGE_ID,
      pinnedMessageCount: 0,
    });
    expect(publishChatRoomPinnedMessageRealtime).toHaveBeenCalledWith({
      action: "unpin",
      roomId: ROOM_ID,
      messageId: MESSAGE_ID,
      pinnedMessageCount: 0,
    });
  });

  it("is idempotent when the message is not pinned", async () => {
    pinDeleteManyMock.mockResolvedValue({ count: 0 });
    pinCountMock.mockResolvedValue(0);

    const response = await createApp(userAuthContext).request(
      `/${ROOM_ID}/messages/${MESSAGE_ID}/pin`,
      { method: "DELETE" },
    );

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.data.pinnedMessageCount).toBe(0);
    expect(publishChatRoomPinnedMessageRealtime).not.toHaveBeenCalled();
  });

  it("rejects unpinning in a Direct", async () => {
    roomFindFirstMock.mockResolvedValue({
      id: ROOM_ID,
      organizationId: ORG_ID,
      kind: "direct",
      userMembers: [{ access: "member" }],
    });

    const response = await createApp(userAuthContext).request(
      `/${ROOM_ID}/messages/${MESSAGE_ID}/pin`,
      { method: "DELETE" },
    );

    expect(response.status).toBe(400);
    expect(pinDeleteManyMock).not.toHaveBeenCalled();
  });
});
