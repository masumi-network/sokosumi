import { OpenAPIHono } from "@hono/zod-openapi";
import { MemberRole } from "@sokosumi/database";
import type { RequestIdVariables } from "hono/request-id";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { errorHandler } from "@/helpers/error-handler";
import type { OpenAPIHonoWithAuth } from "@/lib/hono";
import { defaultValidationHook } from "@/lib/hono";
import type { AuthVariables } from "@/middleware/auth";

import mountPostChatRoomThreadRead from "./post";

const {
  roomFindFirstMock,
  organizationFindUniqueMock,
  memberFindUniqueMock,
  messageFindFirstMock,
  threadReadUpsertMock,
  roomReadUpsertMock,
  notificationUpdateManyMock,
} = vi.hoisted(() => ({
  roomFindFirstMock: vi.fn(),
  organizationFindUniqueMock: vi.fn(),
  memberFindUniqueMock: vi.fn(),
  messageFindFirstMock: vi.fn(),
  threadReadUpsertMock: vi.fn(),
  roomReadUpsertMock: vi.fn(),
  notificationUpdateManyMock: vi.fn(),
}));

vi.mock("@/lib/db/prisma", () => ({
  default: {
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
    chatRoomThreadReadState: {
      upsert: threadReadUpsertMock,
    },
    chatRoomReadState: {
      upsert: roomReadUpsertMock,
    },
    notification: {
      updateMany: notificationUpdateManyMock,
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
    c.set("requestId", "req_thread_read");
    c.set("isAuthenticated", true);
    c.set("authContext", authContext);
    return await next();
  });

  app.onError(errorHandler);
  mountPostChatRoomThreadRead(app as unknown as OpenAPIHonoWithAuth);
  return app;
}

const userAuthContext: AuthVariables["authContext"] = {
  actor: "user",
  userId: USER_ID,
  organizationId: ORG_ID,
  role: "user",
};

const coworkerAuthContext: AuthVariables["authContext"] = {
  actor: "coworker",
  coworkerId: "cow_1",
  vendorId: "vendor_1",
};

function room() {
  return {
    id: ROOM_ID,
    organizationId: ORG_ID,
    name: "Launch Room",
    slug: "launch-room",
    kind: "channel",
    directKey: null,
    topic: null,
    discoverability: "public",
    createdByUserId: USER_ID,
    createdAt: new Date("2026-01-01T00:00:00.000Z"),
    updatedAt: new Date("2026-01-01T00:00:00.000Z"),
    archivedAt: null,
    userMembers: [
      {
        user: {
          id: USER_ID,
          name: "Ada",
          email: "ada@example.com",
          image: null,
          sessions: [],
        },
      },
    ],
    coworkerMembers: [],
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  roomFindFirstMock.mockResolvedValue(room());
  organizationFindUniqueMock.mockResolvedValue({ id: ORG_ID });
  memberFindUniqueMock.mockResolvedValue({ role: MemberRole.MEMBER });
  messageFindFirstMock.mockResolvedValue({ id: MESSAGE_ID });
  threadReadUpsertMock.mockResolvedValue({
    parentMessageId: MESSAGE_ID,
    lastReadAt: new Date("2026-07-03T12:00:00.000Z"),
  });
});

describe("POST /chats/rooms/{id}/messages/{messageId}/thread-read", () => {
  it("upserts ChatRoomThreadReadState for a top-level parent without touching room read", async () => {
    const response = await createApp(userAuthContext).request(
      `/${ROOM_ID}/messages/${MESSAGE_ID}/thread-read`,
      { method: "POST" },
    );

    expect(response.status).toBe(200);
    expect(messageFindFirstMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          id: MESSAGE_ID,
          roomId: ROOM_ID,
          parentMessageId: null,
        },
      }),
    );
    expect(threadReadUpsertMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          userId_parentMessageId: {
            userId: USER_ID,
            parentMessageId: MESSAGE_ID,
          },
        },
        update: expect.objectContaining({
          lastReadAt: expect.any(Date),
        }),
        create: expect.objectContaining({
          userId: USER_ID,
          parentMessageId: MESSAGE_ID,
          lastReadAt: expect.any(Date),
        }),
      }),
    );
    expect(roomReadUpsertMock).not.toHaveBeenCalled();
    expect(notificationUpdateManyMock).not.toHaveBeenCalled();

    const body = await response.json();
    expect(body.data).toMatchObject({
      parentMessageId: MESSAGE_ID,
      lastReadAt: "2026-07-03T12:00:00.000Z",
    });
  });

  it("returns 404 when message is missing, nested, or not in room", async () => {
    messageFindFirstMock.mockResolvedValue(null);

    const response = await createApp(userAuthContext).request(
      `/${ROOM_ID}/messages/${MESSAGE_ID}/thread-read`,
      { method: "POST" },
    );

    expect(response.status).toBe(404);
    expect(threadReadUpsertMock).not.toHaveBeenCalled();
  });

  it("returns 404 when the caller is not a room member", async () => {
    roomFindFirstMock.mockResolvedValue(null);

    const response = await createApp(userAuthContext).request(
      `/${ROOM_ID}/messages/${MESSAGE_ID}/thread-read`,
      { method: "POST" },
    );

    expect(response.status).toBe(404);
    expect(messageFindFirstMock).not.toHaveBeenCalled();
    expect(threadReadUpsertMock).not.toHaveBeenCalled();
  });

  it("rejects non-user auth contexts", async () => {
    const response = await createApp(coworkerAuthContext).request(
      `/${ROOM_ID}/messages/${MESSAGE_ID}/thread-read`,
      { method: "POST" },
    );

    expect(response.status).toBe(403);
    expect(roomFindFirstMock).not.toHaveBeenCalled();
  });
});
