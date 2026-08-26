import { OpenAPIHono } from "@hono/zod-openapi";
import type { RequestIdVariables } from "hono/request-id";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { errorHandler } from "@/helpers/error-handler";
import type { OpenAPIHonoWithAuth } from "@/lib/hono";
import { defaultValidationHook } from "@/lib/hono";
import type { AuthVariables } from "@/middleware/auth";

import mountGetChatRoomPinnedMessages from "./get";

const {
  roomFindFirstMock,
  organizationFindUniqueMock,
  memberFindUniqueMock,
  pinFindManyMock,
  pinCountMock,
} = vi.hoisted(() => ({
  roomFindFirstMock: vi.fn(),
  organizationFindUniqueMock: vi.fn(),
  memberFindUniqueMock: vi.fn(),
  pinFindManyMock: vi.fn(),
  pinCountMock: vi.fn(),
}));

vi.mock("@/lib/db/prisma", () => ({
  default: {
    chatRoom: { findFirst: roomFindFirstMock },
    organization: { findUnique: organizationFindUniqueMock },
    member: { findUnique: memberFindUniqueMock },
    chatRoomPinnedMessage: {
      findMany: pinFindManyMock,
      count: pinCountMock,
    },
  },
}));

const ROOM_ID = "550e8400-e29b-41d4-a716-446655440000";
const MESSAGE_ID = "550e8400-e29b-41d4-a716-446655440001";
const USER_ID = "user_123";
const ORG_ID = "org_1";

function createApp(authContext: AuthVariables["authContext"]) {
  const app = new OpenAPIHono<{
    Variables: AuthVariables & RequestIdVariables;
  }>({
    defaultHook: defaultValidationHook,
  });

  app.use("*", async (c, next) => {
    c.set("requestId", "req_pinned_messages");
    c.set("isAuthenticated", true);
    c.set("authContext", authContext);
    return await next();
  });

  app.onError(errorHandler);
  mountGetChatRoomPinnedMessages(app as unknown as OpenAPIHonoWithAuth);
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
  pinFindManyMock.mockResolvedValue([]);
  pinCountMock.mockResolvedValue(0);
});

describe("GET /chats/rooms/{id}/pinned-messages", () => {
  it("returns newest pin first with a live message payload", async () => {
    pinFindManyMock.mockResolvedValue([
      {
        id: "pin_1",
        messageId: MESSAGE_ID,
        pinnedAt: new Date("2026-08-26T12:00:00.000Z"),
        pinnedByUser: { id: USER_ID, name: "Ada" },
        message: {
          id: MESSAGE_ID,
          roomId: ROOM_ID,
          parentMessageId: null,
          content: "announce",
          createdAt: new Date("2026-08-01T00:00:00.000Z"),
          deletedAt: null,
          editedAt: null,
          metadata: null,
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
          replies: [],
          _count: { replies: 0 },
        },
      },
    ]);
    pinCountMock.mockResolvedValue(1);

    const response = await createApp(userAuthContext).request(
      `/${ROOM_ID}/pinned-messages`,
    );

    expect(response.status).toBe(200);
    expect(pinFindManyMock).toHaveBeenCalledWith(
      expect.objectContaining({
        orderBy: [{ pinnedAt: "desc" }, { id: "desc" }],
      }),
    );
    const body = await response.json();
    expect(body.data).toEqual([
      expect.objectContaining({
        messageId: MESSAGE_ID,
        pinnedBy: { id: USER_ID, name: "Ada" },
        message: expect.objectContaining({
          id: MESSAGE_ID,
          content: "announce",
        }),
      }),
    ]);
  });

  it("returns message null for a tombstone pin row", async () => {
    pinFindManyMock.mockResolvedValue([
      {
        id: "pin_1",
        messageId: MESSAGE_ID,
        pinnedAt: new Date("2026-08-26T12:00:00.000Z"),
        pinnedByUser: null,
        message: {
          id: MESSAGE_ID,
          roomId: ROOM_ID,
          parentMessageId: null,
          content: "",
          createdAt: new Date("2026-08-01T00:00:00.000Z"),
          deletedAt: new Date("2026-08-26T12:00:00.000Z"),
          editedAt: null,
          metadata: null,
          senderUser: null,
          senderCoworker: null,
          mentionsAsSource: [],
          reactions: [],
          replies: [],
          _count: { replies: 0 },
        },
      },
    ]);
    pinCountMock.mockResolvedValue(1);

    const response = await createApp(userAuthContext).request(
      `/${ROOM_ID}/pinned-messages`,
    );

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.data[0].message).toBeNull();
    expect(body.data[0].messageId).toBe(MESSAGE_ID);
  });

  it("rejects Directs", async () => {
    roomFindFirstMock.mockResolvedValue({
      id: ROOM_ID,
      organizationId: ORG_ID,
      kind: "direct",
      userMembers: [{ access: "member" }],
    });

    const response = await createApp(userAuthContext).request(
      `/${ROOM_ID}/pinned-messages`,
    );

    expect(response.status).toBe(400);
    expect(pinFindManyMock).not.toHaveBeenCalled();
  });
});
