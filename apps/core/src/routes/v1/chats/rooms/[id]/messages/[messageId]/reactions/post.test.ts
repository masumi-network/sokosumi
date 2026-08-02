import { OpenAPIHono } from "@hono/zod-openapi";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { OpenAPIHonoWithAuth } from "@/lib/hono";
import { defaultValidationHook } from "@/lib/hono";
import type { AuthVariables } from "@/middleware/auth";

import mountToggleReaction from "./post";

const {
  roomFindFirstMock,
  organizationFindUniqueMock,
  memberFindUniqueMock,
  queryRawMock,
  deleteManyMock,
  createManyMock,
  messageFindUniqueOrThrowMock,
  prismaTransactionMock,
} = vi.hoisted(() => ({
  roomFindFirstMock: vi.fn(),
  organizationFindUniqueMock: vi.fn(),
  memberFindUniqueMock: vi.fn(),
  queryRawMock: vi.fn(),
  deleteManyMock: vi.fn(),
  createManyMock: vi.fn(),
  messageFindUniqueOrThrowMock: vi.fn(),
  prismaTransactionMock: vi.fn(),
}));

vi.mock("@/lib/db/prisma", () => ({
  default: {
    $transaction: prismaTransactionMock,
  },
}));

const ROOM_ID = "550e8400-e29b-41d4-a716-446655440000";
const MESSAGE_ID = "550e8400-e29b-41d4-a716-446655440001";
const USER_ID = "user_123";

const tx = {
  $queryRaw: queryRawMock,
  chatRoom: {
    findFirst: roomFindFirstMock,
  },
  organization: {
    findUnique: organizationFindUniqueMock,
  },
  member: {
    findUnique: memberFindUniqueMock,
  },
  chatRoomReaction: {
    deleteMany: deleteManyMock,
    createMany: createManyMock,
  },
  chatRoomMessage: {
    findUniqueOrThrow: messageFindUniqueOrThrowMock,
  },
};

function createApp(authContext: AuthVariables["authContext"]) {
  const app = new OpenAPIHono<{ Variables: AuthVariables }>({
    defaultHook: defaultValidationHook,
  });

  app.use("*", async (c, next) => {
    c.set("isAuthenticated", true);
    c.set("authContext", authContext);
    return await next();
  });

  mountToggleReaction(app as unknown as OpenAPIHonoWithAuth);
  return app;
}

const userAuthContext: AuthVariables["authContext"] = {
  actor: "user",
  userId: USER_ID,
  organizationId: "org_1",
  role: "user",
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
  senderUser: {
    id: USER_ID,
    name: "Ada",
    email: "ada@example.com",
    image: null,
  },
  senderCoworker: null,
  mentionsAsSource: [],
  reactions: [],
  _count: { replies: 0 },
  replies: [],
};

describe("POST /chat-rooms/:id/messages/:messageId/reactions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    prismaTransactionMock.mockImplementation(
      async (fn: (client: typeof tx) => Promise<unknown>) => fn(tx),
    );
    roomFindFirstMock.mockResolvedValue({
      id: ROOM_ID,
      organizationId: "org_1",
      kind: "channel",
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
    queryRawMock.mockResolvedValue([{ id: MESSAGE_ID }]);
    deleteManyMock.mockResolvedValue({ count: 0 });
    createManyMock.mockResolvedValue({ count: 1 });
    messageFindUniqueOrThrowMock.mockResolvedValue(mappedMessage);
  });

  it("locks the message with FOR UPDATE before toggling", async () => {
    const callOrder: string[] = [];
    queryRawMock.mockImplementation(async () => {
      callOrder.push("lock");
      return [{ id: MESSAGE_ID }];
    });
    deleteManyMock.mockImplementation(async () => {
      callOrder.push("delete");
      return { count: 0 };
    });
    createManyMock.mockImplementation(async () => {
      callOrder.push("create");
      return { count: 1 };
    });

    const app = createApp(userAuthContext);
    const response = await app.request(
      `/${ROOM_ID}/messages/${MESSAGE_ID}/reactions`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ emoji: "👍" }),
      },
    );

    expect(response.status).toBe(200);
    expect(callOrder).toEqual(["lock", "delete", "create"]);

    const sqlParts = queryRawMock.mock.calls[0]?.[0] as TemplateStringsArray;
    const sql = sqlParts.join(" ");
    expect(sql).toContain("FOR UPDATE");
    expect(sql).toContain("chat_room_message");
  });

  it("removes an existing reaction without inserting", async () => {
    deleteManyMock.mockResolvedValue({ count: 1 });

    const app = createApp(userAuthContext);
    const response = await app.request(
      `/${ROOM_ID}/messages/${MESSAGE_ID}/reactions`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ emoji: "🎉" }),
      },
    );

    expect(response.status).toBe(200);
    expect(deleteManyMock).toHaveBeenCalledWith({
      where: {
        messageId: MESSAGE_ID,
        userId: USER_ID,
        emoji: "🎉",
      },
    });
    expect(createManyMock).not.toHaveBeenCalled();
  });

  it("returns 404 when the locked message is missing", async () => {
    queryRawMock.mockResolvedValue([]);

    const app = createApp(userAuthContext);
    const response = await app.request(
      `/${ROOM_ID}/messages/${MESSAGE_ID}/reactions`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ emoji: "👍" }),
      },
    );

    expect(response.status).toBe(404);
    expect(deleteManyMock).not.toHaveBeenCalled();
  });

  it("returns reactors with id and name after toggling on", async () => {
    messageFindUniqueOrThrowMock.mockResolvedValue({
      ...mappedMessage,
      reactions: [
        {
          emoji: "👍",
          userId: USER_ID,
          user: { id: USER_ID, name: "Ada" },
        },
        {
          emoji: "👍",
          userId: "user_456",
          user: { id: "user_456", name: "Bob" },
        },
      ],
    });

    const app = createApp(userAuthContext);
    const response = await app.request(
      `/${ROOM_ID}/messages/${MESSAGE_ID}/reactions`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ emoji: "👍" }),
      },
    );

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.data.reactions).toEqual([
      {
        emoji: "👍",
        count: 2,
        reactedByCurrentUser: true,
        reactors: [
          { id: USER_ID, name: "Ada" },
          { id: "user_456", name: "Bob" },
        ],
      },
    ]);
  });
});
