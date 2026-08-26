import { OpenAPIHono } from "@hono/zod-openapi";
import { MemberRole } from "@sokosumi/database";
import type { RequestIdVariables } from "hono/request-id";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { errorHandler } from "@/helpers/error-handler";
import type { OpenAPIHonoWithAuth } from "@/lib/hono";
import { defaultValidationHook } from "@/lib/hono";
import type { AuthVariables } from "@/middleware/auth";

import mountPinChatRoom from "./post";

const {
  roomFindFirstMock,
  organizationFindUniqueMock,
  memberFindUniqueMock,
  membershipUpdateManyMock,
  membershipFindUniqueMock,
  unreadQueryMock,
  mentionGroupByMock,
  membershipFindManyMock,
  readStateFindManyMock,
  prismaTransactionMock,
} = vi.hoisted(() => ({
  roomFindFirstMock: vi.fn(),
  organizationFindUniqueMock: vi.fn(),
  memberFindUniqueMock: vi.fn(),
  membershipUpdateManyMock: vi.fn(),
  membershipFindUniqueMock: vi.fn(),
  unreadQueryMock: vi.fn(),
  mentionGroupByMock: vi.fn(),
  membershipFindManyMock: vi.fn(),
  readStateFindManyMock: vi.fn(),
  prismaTransactionMock: vi.fn(),
}));

vi.mock("@/lib/db/prisma", () => ({
  default: {
    $transaction: prismaTransactionMock,
    $queryRawUnsafe: unreadQueryMock,
    notification: { groupBy: mentionGroupByMock },
    chatRoomUserMember: { findMany: membershipFindManyMock },
    chatRoomReadState: { findMany: readStateFindManyMock },
    chatRoomPinnedMessage: { groupBy: vi.fn().mockResolvedValue([]) },
  },
}));

const ROOM_ID = "550e8400-e29b-41d4-a716-446655440000";
const USER_ID = "user_123";
const ORG_ID = "org_1";

const tx = {
  chatRoom: { findFirst: roomFindFirstMock },
  organization: { findUnique: organizationFindUniqueMock },
  member: { findUnique: memberFindUniqueMock },
  chatRoomUserMember: {
    updateMany: membershipUpdateManyMock,
    findUnique: membershipFindUniqueMock,
  },
};

function createApp(authContext: AuthVariables["authContext"]) {
  const app = new OpenAPIHono<{
    Variables: AuthVariables & RequestIdVariables;
  }>({
    defaultHook: defaultValidationHook,
  });

  app.use("*", async (c, next) => {
    c.set("requestId", "req_pin_chat_room");
    c.set("isAuthenticated", true);
    c.set("authContext", authContext);
    return await next();
  });

  app.onError(errorHandler);
  mountPinChatRoom(app as unknown as OpenAPIHonoWithAuth);
  return app;
}

const userAuthContext: AuthVariables["authContext"] = {
  actor: "user",
  userId: USER_ID,
  organizationId: ORG_ID,
  role: "user",
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
  prismaTransactionMock.mockImplementation(async (cb) => cb(tx));
  roomFindFirstMock.mockResolvedValue(room());
  organizationFindUniqueMock.mockResolvedValue({ id: ORG_ID });
  memberFindUniqueMock.mockResolvedValue({ role: MemberRole.MEMBER });
  membershipUpdateManyMock.mockResolvedValue({ count: 1 });
  unreadQueryMock.mockResolvedValue([]);
  mentionGroupByMock.mockResolvedValue([]);
  membershipFindManyMock.mockResolvedValue([
    {
      roomId: ROOM_ID,
      starredAt: new Date("2026-08-02T12:00:00.000Z"),
      mutedAt: null,
    },
  ]);
  readStateFindManyMock.mockResolvedValue([]);
});

describe("POST /chats/rooms/{id}/star", () => {
  it("sets membership starredAt and returns starred room", async () => {
    const response = await createApp(userAuthContext).request(
      `/${ROOM_ID}/star`,
      { method: "POST" },
    );

    expect(response.status).toBe(200);
    expect(membershipUpdateManyMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          roomId: ROOM_ID,
          userId: USER_ID,
          mutedAt: null,
        },
        data: { starredAt: expect.any(Date) },
      }),
    );

    const body = await response.json();
    expect(body.data).toMatchObject({
      id: ROOM_ID,
      starredAt: "2026-08-02T12:00:00.000Z",
      markedUnread: false,
    });
  });

  it("rejects star when the room is muted", async () => {
    membershipUpdateManyMock.mockResolvedValue({ count: 0 });
    membershipFindUniqueMock.mockResolvedValue({
      mutedAt: new Date("2026-08-03T10:00:00.000Z"),
    });

    const response = await createApp(userAuthContext).request(
      `/${ROOM_ID}/star`,
      { method: "POST" },
    );

    expect(response.status).toBe(422);
    const body = await response.json();
    expect(body.message).toBe("Cannot star a muted room. Unmute it first.");
  });

  it("404s when membership disappears after access check", async () => {
    membershipUpdateManyMock.mockResolvedValue({ count: 0 });
    membershipFindUniqueMock.mockResolvedValue(null);

    const response = await createApp(userAuthContext).request(
      `/${ROOM_ID}/star`,
      { method: "POST" },
    );

    expect(response.status).toBe(404);
    const body = await response.json();
    expect(body.message).toBe("Room not found");
  });
});
