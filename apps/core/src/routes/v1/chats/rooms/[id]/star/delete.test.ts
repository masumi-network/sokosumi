import { OpenAPIHono } from "@hono/zod-openapi";
import { MemberRole } from "@sokosumi/database";
import type { RequestIdVariables } from "hono/request-id";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { errorHandler } from "@/helpers/error-handler";
import type { OpenAPIHonoWithAuth } from "@/lib/hono";
import { defaultValidationHook } from "@/lib/hono";
import type { AuthVariables } from "@/middleware/auth";

import mountUnpinChatRoom from "./delete";

const {
  roomFindFirstMock,
  organizationFindUniqueMock,
  memberFindUniqueMock,
  membershipUpdateMock,
  unreadQueryMock,
  mentionGroupByMock,
  membershipFindManyMock,
  readStateFindManyMock,
  prismaTransactionMock,
} = vi.hoisted(() => ({
  roomFindFirstMock: vi.fn(),
  organizationFindUniqueMock: vi.fn(),
  memberFindUniqueMock: vi.fn(),
  membershipUpdateMock: vi.fn(),
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
  chatRoomUserMember: { update: membershipUpdateMock },
};

function createApp(authContext: AuthVariables["authContext"]) {
  const app = new OpenAPIHono<{
    Variables: AuthVariables & RequestIdVariables;
  }>({
    defaultHook: defaultValidationHook,
  });

  app.use("*", async (c, next) => {
    c.set("requestId", "req_unpin_chat_room");
    c.set("isAuthenticated", true);
    c.set("authContext", authContext);
    return await next();
  });

  app.onError(errorHandler);
  mountUnpinChatRoom(app as unknown as OpenAPIHonoWithAuth);
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
  membershipUpdateMock.mockResolvedValue({});
  unreadQueryMock.mockResolvedValue([]);
  mentionGroupByMock.mockResolvedValue([]);
  membershipFindManyMock.mockResolvedValue([
    { roomId: ROOM_ID, starredAt: null },
  ]);
  readStateFindManyMock.mockResolvedValue([]);
});

describe("DELETE /chats/rooms/{id}/star", () => {
  it("clears membership starredAt and returns unpinned room", async () => {
    const response = await createApp(userAuthContext).request(
      `/${ROOM_ID}/star`,
      { method: "DELETE" },
    );

    expect(response.status).toBe(200);
    expect(membershipUpdateMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          roomId_userId: { roomId: ROOM_ID, userId: USER_ID },
        },
        data: { starredAt: null },
      }),
    );

    const body = await response.json();
    expect(body.data).toMatchObject({
      id: ROOM_ID,
      starredAt: null,
      markedUnread: false,
    });
  });
});
