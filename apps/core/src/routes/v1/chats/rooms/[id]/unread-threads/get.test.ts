import { OpenAPIHono } from "@hono/zod-openapi";
import { MemberRole } from "@sokosumi/database";
import type { RequestIdVariables } from "hono/request-id";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { errorHandler } from "@/helpers/error-handler";
import type { OpenAPIHonoWithAuth } from "@/lib/hono";
import { defaultValidationHook } from "@/lib/hono";
import type { AuthVariables } from "@/middleware/auth";

import mountGetChatRoomUnreadThreads from "./get";

const {
  roomFindFirstMock,
  organizationFindUniqueMock,
  memberFindUniqueMock,
  queryRawUnsafeMock,
  messageFindManyMock,
} = vi.hoisted(() => ({
  roomFindFirstMock: vi.fn(),
  organizationFindUniqueMock: vi.fn(),
  memberFindUniqueMock: vi.fn(),
  queryRawUnsafeMock: vi.fn(),
  messageFindManyMock: vi.fn(),
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
      findMany: messageFindManyMock,
    },
    $queryRawUnsafe: queryRawUnsafeMock,
  },
}));

const ROOM_ID = "550e8400-e29b-41d4-a716-446655440000";
const PARENT_ID = "550e8400-e29b-41d4-a716-446655440001";
const USER_ID = "user_123";
const OTHER_USER_ID = "user_456";
const ORG_ID = "org_1";

function createApp(authContext: AuthVariables["authContext"]) {
  const app = new OpenAPIHono<{
    Variables: AuthVariables & RequestIdVariables;
  }>({
    defaultHook: defaultValidationHook,
  });

  app.use("*", async (c, next) => {
    c.set("requestId", "req_unread_threads");
    c.set("isAuthenticated", true);
    c.set("authContext", authContext);
    return await next();
  });

  app.onError(errorHandler);
  mountGetChatRoomUnreadThreads(app as unknown as OpenAPIHonoWithAuth);
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

function parentMessage() {
  return {
    id: PARENT_ID,
    roomId: ROOM_ID,
    parentMessageId: null,
    content: "parent",
    createdAt: new Date("2026-07-01T12:00:00.000Z"),
    deletedAt: null,
    editedAt: null,
    senderUserId: OTHER_USER_ID,
    senderCoworkerId: null,
    metadata: null,
    senderUser: {
      id: OTHER_USER_ID,
      name: "Bob",
      email: "bob@example.com",
      image: null,
      sessions: [],
    },
    senderCoworker: null,
    mentionsAsSource: [],
    reactions: [],
    _count: { replies: 2 },
    replies: [{ createdAt: new Date("2026-07-02T12:00:00.000Z") }],
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  roomFindFirstMock.mockResolvedValue(room());
  organizationFindUniqueMock.mockResolvedValue({ id: ORG_ID });
  memberFindUniqueMock.mockResolvedValue({ role: MemberRole.MEMBER });
  queryRawUnsafeMock.mockResolvedValue([
    {
      parentMessageId: PARENT_ID,
      unreadReplyCount: 2,
      lastUnreadReplyAt: new Date("2026-07-02T12:00:00.000Z"),
    },
  ]);
  messageFindManyMock.mockResolvedValue([parentMessage()]);
});

describe("GET /chats/rooms/{id}/unread-threads", () => {
  it("returns parents with unread non-self replies after look baseline", async () => {
    const response = await createApp(userAuthContext).request(
      `/${ROOM_ID}/unread-threads`,
    );

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.data).toEqual([
      expect.objectContaining({
        unreadReplyCount: 2,
        lastUnreadReplyAt: "2026-07-02T12:00:00.000Z",
        parentMessage: expect.objectContaining({
          id: PARENT_ID,
          roomId: ROOM_ID,
          parentMessageId: null,
          content: "parent",
        }),
      }),
    ]);

    expect(queryRawUnsafeMock).toHaveBeenCalledOnce();
    const sql = String(queryRawUnsafeMock.mock.calls[0]?.[0]);
    // Look baseline: thread lastReadAt, else room read-state createdAt, else -infinity.
    // Never room lastReadAt.
    expect(sql).toContain('thread_read."lastReadAt"');
    expect(sql).toContain('room_read."createdAt"');
    expect(sql).toContain("'-infinity'::timestamp");
    expect(sql).not.toMatch(/room_read\."lastReadAt"/);
    expect(sql).toContain('reply."deletedAt" IS NULL');
    expect(sql).toContain('parent."deletedAt" IS NULL');
    expect(sql).toMatch(
      /reply\."senderUserId" IS NULL OR reply\."senderUserId" <>/,
    );
  });

  it("returns 404 when the caller is not a room member", async () => {
    roomFindFirstMock.mockResolvedValue(null);

    const response = await createApp(userAuthContext).request(
      `/${ROOM_ID}/unread-threads`,
    );

    expect(response.status).toBe(404);
    expect(queryRawUnsafeMock).not.toHaveBeenCalled();
  });

  it("rejects non-user auth contexts", async () => {
    const response = await createApp(coworkerAuthContext).request(
      `/${ROOM_ID}/unread-threads`,
    );

    expect(response.status).toBe(403);
    expect(roomFindFirstMock).not.toHaveBeenCalled();
  });

  it("returns an empty list when no threads need attention", async () => {
    queryRawUnsafeMock.mockResolvedValue([]);

    const response = await createApp(userAuthContext).request(
      `/${ROOM_ID}/unread-threads`,
    );

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.data).toEqual([]);
    expect(messageFindManyMock).not.toHaveBeenCalled();
  });
});
