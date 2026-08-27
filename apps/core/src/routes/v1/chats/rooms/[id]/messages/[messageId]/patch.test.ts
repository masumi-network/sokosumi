import { beforeEach, describe, expect, it, vi } from "vitest";
import { OpenAPIHonoWithAuth } from "@/lib/hono";
import type { AuthVariables } from "@/middleware/auth";

import mountPatchChatRoomMessage from "./patch";

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
  messageUpdateMock,
  prismaTransactionMock,
  waitUntilMock,
  scheduleUnfurlsMock,
} = vi.hoisted(() => ({
  roomFindFirstMock: vi.fn(),
  organizationFindUniqueMock: vi.fn(),
  memberFindUniqueMock: vi.fn(),
  messageFindFirstMock: vi.fn(),
  messageUpdateMock: vi.fn(),
  prismaTransactionMock: vi.fn(),
  waitUntilMock: vi.fn(),
  scheduleUnfurlsMock: vi.fn(),
}));

vi.mock("@/lib/db/prisma", () => ({
  default: {
    $transaction: prismaTransactionMock,
  },
}));

vi.mock("@vercel/functions", () => ({
  waitUntil: waitUntilMock,
}));

vi.mock("@/services/chat-room-message-unfurl.service", () => ({
  scheduleChatRoomMessageUnfurls: scheduleUnfurlsMock,
}));

vi.mock("@/helpers/chat-room-message-realtime", () => ({
  publishChatRoomMessageRealtime: vi.fn().mockResolvedValue(undefined),
}));

const ROOM_ID = "550e8400-e29b-41d4-a716-446655440000";
const MESSAGE_ID = "550e8400-e29b-41d4-a716-446655440001";
const USER_ID = "user_123";
const OTHER_USER_ID = "user_456";

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
    update: messageUpdateMock,
  },
};

function createApp(authContext: AuthVariables["authContext"]) {
  const app = new OpenAPIHonoWithAuth();

  app.use("*", async (c, next) => {
    c.set("isAuthenticated", true);
    c.set("authContext", authContext);
    return await next();
  });

  mountPatchChatRoomMessage(app);
  return app;
}

const userAuthContext: AuthVariables["authContext"] = {
  actor: "user",
  userId: USER_ID,
  organizationId: "org_1",
  role: "user",
};

const coworkerAuthContext: AuthVariables["authContext"] = {
  actor: "coworker",
  coworkerId: "coworker_1",
  vendorId: "vendor_1",
};

const mappedMessage = {
  id: MESSAGE_ID,
  roomId: ROOM_ID,
  parentMessageId: null,
  content: "hello",
  createdAt: new Date("2026-07-01T12:00:00.000Z"),
  editedAt: null,
  senderUserId: USER_ID,
  senderCoworkerId: null,
  metadata: null,
  clientMessageId: null,
  responsesApiResponseId: null,
  senderUser: {
    id: USER_ID,
    name: "Ada",
    email: "ada@example.com",
    image: null,
    sessions: [],
  },
  senderCoworker: null,
  mentionsAsSource: [],
  reactions: [],
  _count: { replies: 0 },
  replies: [],
};

async function patchMessage(body: unknown, auth = userAuthContext) {
  const app = createApp(auth);
  return app.request(`/${ROOM_ID}/messages/${MESSAGE_ID}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("PATCH /chats/rooms/:id/messages/:messageId", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    prismaTransactionMock.mockImplementation(
      async (fn: (client: typeof tx) => Promise<unknown>) => fn(tx),
    );
    roomFindFirstMock.mockResolvedValue({
      id: ROOM_ID,
      organizationId: "org_1",
      kind: "channel",
      name: "general",
      archivedAt: null,
      userMembers: [{ userId: USER_ID }],
      coworkerMembers: [],
    });
    organizationFindUniqueMock.mockResolvedValue({ id: "org_1" });
    memberFindUniqueMock.mockResolvedValue({
      id: "member_1",
      userId: USER_ID,
      organizationId: "org_1",
      role: "member",
    });
    messageFindFirstMock.mockResolvedValue(mappedMessage);
    messageUpdateMock.mockResolvedValue({
      ...mappedMessage,
      content: "hello fixed",
      editedAt: new Date("2026-07-01T12:05:00.000Z"),
    });
    scheduleUnfurlsMock.mockResolvedValue({
      messageId: MESSAGE_ID,
      attempted: 0,
      persisted: 0,
    });
    waitUntilMock.mockImplementation(() => {});
  });

  it("updates content and sets editedAt when content changes", async () => {
    const response = await patchMessage({ content: "hello fixed" });

    expect(response.status).toBe(200);
    expect(messageUpdateMock).toHaveBeenCalledWith({
      where: { id: MESSAGE_ID },
      data: {
        content: "hello fixed",
        editedAt: expect.any(Date),
      },
      include: expect.any(Object),
    });

    const body = await response.json();
    expect(body.data.content).toBe("hello fixed");
    expect(body.data.editedAt).toBe("2026-07-01T12:05:00.000Z");
    expect(scheduleUnfurlsMock).toHaveBeenCalledWith(MESSAGE_ID);
    expect(waitUntilMock).toHaveBeenCalledTimes(1);
  });

  it("returns current DTO without bumping editedAt when content is unchanged", async () => {
    const response = await patchMessage({ content: "hello" });

    expect(response.status).toBe(200);
    expect(messageUpdateMock).not.toHaveBeenCalled();

    const body = await response.json();
    expect(body.data.content).toBe("hello");
    expect(body.data.editedAt).toBeNull();
    expect(scheduleUnfurlsMock).not.toHaveBeenCalled();
    expect(waitUntilMock).not.toHaveBeenCalled();
  });

  it("trims content before comparing and updating", async () => {
    const response = await patchMessage({ content: "  hello fixed  " });

    expect(response.status).toBe(200);
    expect(messageUpdateMock).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ content: "hello fixed" }),
      }),
    );
  });

  it("returns 422 for empty content", async () => {
    const response = await patchMessage({ content: "   " });

    expect(response.status).toBe(422);
    expect(messageFindFirstMock).not.toHaveBeenCalled();
  });

  it("returns 403 for coworker actors", async () => {
    const response = await patchMessage(
      { content: "hello fixed" },
      coworkerAuthContext,
    );

    expect(response.status).toBe(403);
    expect(prismaTransactionMock).not.toHaveBeenCalled();
  });

  it("returns 403 when the caller is not the message author", async () => {
    messageFindFirstMock.mockResolvedValue({
      ...mappedMessage,
      senderUserId: OTHER_USER_ID,
      senderUser: {
        id: OTHER_USER_ID,
        name: "Bob",
        email: "bob@example.com",
        image: null,
        sessions: [],
      },
    });

    const response = await patchMessage({ content: "hello fixed" });

    expect(response.status).toBe(403);
    expect(messageUpdateMock).not.toHaveBeenCalled();
  });

  it("returns 403 when the message was sent by a coworker", async () => {
    messageFindFirstMock.mockResolvedValue({
      ...mappedMessage,
      senderUserId: null,
      senderCoworkerId: "coworker_1",
      senderUser: null,
      senderCoworker: {
        id: "coworker_1",
        name: "Elena",
        slug: "elena",
        caption: null,
        image: null,
      },
    });

    const response = await patchMessage({ content: "hello fixed" });

    expect(response.status).toBe(403);
    expect(messageUpdateMock).not.toHaveBeenCalled();
  });

  it("returns 403 when the message is soft-deleted", async () => {
    messageFindFirstMock.mockResolvedValue({
      ...mappedMessage,
      content: "",
      deletedAt: new Date("2026-08-02T00:00:00.000Z"),
      metadata: null,
    });

    const response = await patchMessage({ content: "hello resurrected" });

    expect(response.status).toBe(403);
    expect(messageUpdateMock).not.toHaveBeenCalled();
  });

  it("returns 404 when the message is missing from the room", async () => {
    messageFindFirstMock.mockResolvedValue(null);

    const response = await patchMessage({ content: "hello fixed" });

    expect(response.status).toBe(404);
    expect(messageUpdateMock).not.toHaveBeenCalled();
  });

  it("returns 404 when the caller lacks room write access", async () => {
    roomFindFirstMock.mockResolvedValue(null);

    const response = await patchMessage({ content: "hello fixed" });

    expect(response.status).toBe(404);
    expect(messageFindFirstMock).not.toHaveBeenCalled();
  });

  it("does not touch room.updatedAt on edit", async () => {
    const response = await patchMessage({ content: "hello fixed" });

    expect(response.status).toBe(200);
    expect(tx).not.toHaveProperty("chatRoom.update");
    expect(Object.keys(tx.chatRoom).every((key) => key === "findFirst")).toBe(
      true,
    );
  });
});
