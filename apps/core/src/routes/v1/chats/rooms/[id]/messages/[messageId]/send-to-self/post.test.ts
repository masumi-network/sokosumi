import { beforeEach, describe, expect, it, vi } from "vitest";
import { publishChatRoomMessageRealtime } from "@/helpers/chat-room-message-realtime";
import { errorHandler } from "@/helpers/error-handler";
import { publishChatRoomsChanged } from "@/lib/ably/publish";
import { OpenAPIHonoWithAuth } from "@/lib/hono";
import type { AuthVariables } from "@/middleware/auth";

import mountSendChatRoomMessageToSelf from "./post";

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
  messageCreateMock,
  roomUpdateMock,
  readStateUpsertMock,
  prismaTransactionMock,
  createOrGetDirectRoomMock,
} = vi.hoisted(() => ({
  roomFindFirstMock: vi.fn(),
  organizationFindUniqueMock: vi.fn(),
  memberFindUniqueMock: vi.fn(),
  messageFindFirstMock: vi.fn(),
  messageCreateMock: vi.fn(),
  roomUpdateMock: vi.fn(),
  readStateUpsertMock: vi.fn(),
  prismaTransactionMock: vi.fn(),
  createOrGetDirectRoomMock: vi.fn(),
}));

vi.mock("@/lib/db/prisma", () => ({
  default: {
    $transaction: prismaTransactionMock,
    chatRoom: { findFirst: roomFindFirstMock },
    organization: { findUnique: organizationFindUniqueMock },
    member: { findUnique: memberFindUniqueMock },
    chatRoomMessage: { findFirst: messageFindFirstMock },
  },
}));

// Find-or-create runs in its own transaction, so only that helper is replaced;
// room access and the quote snapshot stay real against the mocked client.
vi.mock("../../../../helpers", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../../../helpers")>();
  return { ...actual, createOrGetDirectRoom: createOrGetDirectRoomMock };
});

vi.mock("@/helpers/chat-room-message-realtime", () => ({
  publishChatRoomMessageRealtime: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("@/lib/ably/publish", () => ({
  publishChatRoomsChanged: vi.fn().mockResolvedValue(undefined),
}));

const ROOM_ID = "550e8400-e29b-41d4-a716-446655440000";
const MESSAGE_ID = "550e8400-e29b-41d4-a716-446655440001";
const SELF_DIRECT_ID = "550e8400-e29b-41d4-a716-446655440002";
const SAVED_MESSAGE_ID = "550e8400-e29b-41d4-a716-446655440003";
const USER_ID = "user_123";
const ORG_ID = "org_1";

const tx = {
  chatRoomMessage: { create: messageCreateMock },
  chatRoom: { update: roomUpdateMock },
  chatRoomReadState: { upsert: readStateUpsertMock },
};

function createApp(authContext: AuthVariables["authContext"]) {
  const app = new OpenAPIHonoWithAuth();

  app.use("*", async (c, next) => {
    c.set("requestId", "req_send_to_self");
    c.set("isAuthenticated", true);
    c.set("authContext", authContext);
    return await next();
  });

  app.onError(errorHandler);
  mountSendChatRoomMessageToSelf(app);
  return app;
}

const userAuthContext: AuthVariables["authContext"] = {
  actor: "user",
  userId: USER_ID,
  organizationId: ORG_ID,
  role: "user",
};

function sourceRoom() {
  return {
    id: ROOM_ID,
    organizationId: ORG_ID,
    kind: "channel",
    directKey: null,
    userMembers: [{ userId: USER_ID, access: "member", user: { id: USER_ID } }],
    coworkerMembers: [],
    sokoBotMembers: [],
  };
}

function selfDirectRoom() {
  return {
    id: SELF_DIRECT_ID,
    organizationId: null,
    kind: "direct",
    directKey: `direct:self:${USER_ID}`,
    userMembers: [{ userId: USER_ID, access: "member", user: { id: USER_ID } }],
    coworkerMembers: [],
    sokoBotMembers: [],
  };
}

function sourceMessage(overrides: { metadata?: unknown } = {}) {
  return {
    id: MESSAGE_ID,
    content: "Ship the launch notes",
    metadata: overrides.metadata ?? null,
    senderUser: { name: "Alice" },
    senderCoworker: null,
    senderSokoBot: null,
  };
}

function savedMessage(metadata: Record<string, unknown> | null) {
  return {
    id: SAVED_MESSAGE_ID,
    roomId: SELF_DIRECT_ID,
    parentMessageId: null,
    senderUserId: USER_ID,
    senderCoworkerId: null,
    senderSokoBotId: null,
    content: "",
    metadata,
    createdAt: new Date("2026-09-17T00:00:00.000Z"),
    editedAt: null,
    senderUser: {
      id: USER_ID,
      name: "Patrick",
      email: "patrick@example.com",
      image: null,
      sessions: [],
    },
    senderCoworker: null,
    senderSokoBot: null,
    mentionsAsSource: [],
    reactions: [],
    replies: [],
    pins: [],
    _count: { replies: 0 },
  };
}

function sendToSelf() {
  return createApp(userAuthContext).request(
    `/${ROOM_ID}/messages/${MESSAGE_ID}/send-to-self`,
    { method: "POST" },
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  prismaTransactionMock.mockImplementation(async (cb) => cb(tx));
  roomFindFirstMock.mockResolvedValue(sourceRoom());
  organizationFindUniqueMock.mockResolvedValue({ id: ORG_ID });
  memberFindUniqueMock.mockResolvedValue({
    id: "member_1",
    userId: USER_ID,
    organizationId: ORG_ID,
    role: "member",
  });
  messageFindFirstMock.mockResolvedValue(sourceMessage());
  createOrGetDirectRoomMock.mockResolvedValue({
    room: { id: SELF_DIRECT_ID },
    created: false,
  });
  messageCreateMock.mockImplementation(async ({ data }) =>
    savedMessage((data.metadata ?? null) as Record<string, unknown> | null),
  );
});

describe("POST /chats/rooms/{id}/messages/{messageId}/send-to-self", () => {
  it("posts a quote of the source message into the caller's Self Direct", async () => {
    const response = await sendToSelf();

    expect(response.status).toBe(201);
    expect(messageCreateMock).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          roomId: SELF_DIRECT_ID,
          senderUserId: USER_ID,
          content: "",
          metadata: {
            quote: {
              messageId: MESSAGE_ID,
              roomId: ROOM_ID,
              authorName: "Alice",
              snippet: "Ship the launch notes",
              attachment: null,
            },
          },
        }),
      }),
    );
    expect(roomUpdateMock).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: SELF_DIRECT_ID } }),
    );
    expect(readStateUpsertMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          roomId_userId: { roomId: SELF_DIRECT_ID, userId: USER_ID },
        },
      }),
    );
    expect(publishChatRoomMessageRealtime).toHaveBeenCalledWith(
      expect.objectContaining({ id: SAVED_MESSAGE_ID }),
      "create",
    );
    const body = await response.json();
    expect(body.data).toMatchObject({
      id: SAVED_MESSAGE_ID,
      roomId: SELF_DIRECT_ID,
      content: "",
      quote: { messageId: MESSAGE_ID, roomId: ROOM_ID, authorName: "Alice" },
    });
  });

  it("refreshes the sidebar only when the Self Direct was created", async () => {
    await sendToSelf();
    expect(publishChatRoomsChanged).not.toHaveBeenCalled();

    createOrGetDirectRoomMock.mockResolvedValue({
      room: { id: SELF_DIRECT_ID },
      created: true,
    });
    await sendToSelf();

    expect(publishChatRoomsChanged).toHaveBeenCalledWith({
      userIds: [USER_ID],
      collections: ["active"],
      roomId: SELF_DIRECT_ID,
    });
  });

  it("404s when the caller cannot read the source room", async () => {
    roomFindFirstMock.mockResolvedValue(null);

    const response = await sendToSelf();

    expect(response.status).toBe(404);
    expect(createOrGetDirectRoomMock).not.toHaveBeenCalled();
    expect(messageCreateMock).not.toHaveBeenCalled();
  });

  it("404s when the message is missing or deleted", async () => {
    messageFindFirstMock.mockResolvedValue(null);

    const response = await sendToSelf();

    expect(response.status).toBe(404);
    expect(messageFindFirstMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: MESSAGE_ID, roomId: ROOM_ID, deletedAt: null },
      }),
    );
    expect(messageCreateMock).not.toHaveBeenCalled();
  });

  it("rejects a message that is already in the Self Direct", async () => {
    roomFindFirstMock.mockResolvedValue(selfDirectRoom());

    const response = await sendToSelf();

    expect(response.status).toBe(400);
    expect(messageCreateMock).not.toHaveBeenCalled();
  });

  it("rejects a membership status message", async () => {
    messageFindFirstMock.mockResolvedValue(
      sourceMessage({
        metadata: {
          membership: {
            action: "joined",
            subject: { type: "user", id: USER_ID, name: "Patrick" },
          },
        },
      }),
    );

    const response = await sendToSelf();

    expect(response.status).toBe(400);
    expect(messageCreateMock).not.toHaveBeenCalled();
  });
});
