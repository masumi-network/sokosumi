import { MemberRole } from "@sokosumi/database";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { errorHandler } from "@/helpers/error-handler";
import { OpenAPIHonoWithAuth } from "@/lib/hono";
import type { AuthVariables } from "@/middleware/auth";

import mountGetChatRoom from "./get";

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
  memberFindManyMock,
  queryRawUnsafeMock,
  notificationGroupByMock,
  pinGroupByMock,
  membershipFindManyMock,
  readStateFindManyMock,
  prismaTransactionMock,
} = vi.hoisted(() => ({
  roomFindFirstMock: vi.fn(),
  organizationFindUniqueMock: vi.fn(),
  memberFindUniqueMock: vi.fn(),
  memberFindManyMock: vi.fn(),
  queryRawUnsafeMock: vi.fn(),
  notificationGroupByMock: vi.fn(),
  pinGroupByMock: vi.fn(),
  membershipFindManyMock: vi.fn(),
  readStateFindManyMock: vi.fn(),
  prismaTransactionMock: vi.fn(),
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
      findMany: memberFindManyMock,
    },
    notification: {
      groupBy: notificationGroupByMock,
    },
    chatRoomPinnedMessage: {
      groupBy: pinGroupByMock,
    },
    chatRoomUserMember: {
      findMany: membershipFindManyMock,
    },
    chatRoomReadState: {
      findMany: readStateFindManyMock,
    },
    $queryRawUnsafe: queryRawUnsafeMock,
    $transaction: prismaTransactionMock,
  },
}));

const ROOM_ID = "550e8400-e29b-41d4-a716-446655440000";
const USER_ID = "user_123";
const PEER_ID = "user_456";
const ORG_ID = "org_1";

function createApp(authContext: AuthVariables["authContext"]) {
  const app = new OpenAPIHonoWithAuth();

  app.use("*", async (c, next) => {
    c.set("requestId", "req_get_chat_room");
    c.set("isAuthenticated", true);
    c.set("authContext", authContext);
    return await next();
  });

  app.onError(errorHandler);
  mountGetChatRoom(app);
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

function personalDirectRoom() {
  return {
    ...room(),
    organizationId: null,
    name: "Ada, Guest",
    kind: "direct",
    userMembers: [
      {
        userId: USER_ID,
        user: {
          id: USER_ID,
          name: "Ada",
          email: "ada@example.com",
          image: null,
          sessions: [],
        },
      },
      {
        userId: PEER_ID,
        user: {
          id: PEER_ID,
          name: "Guest",
          email: "guest@example.com",
          image: null,
          sessions: [],
        },
      },
    ],
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  roomFindFirstMock.mockResolvedValue(room());
  // Membership gate + organizationName on GET both load the org.
  organizationFindUniqueMock.mockResolvedValue({
    id: ORG_ID,
    name: "Acme Corp",
  });
  memberFindUniqueMock.mockResolvedValue({ role: MemberRole.MEMBER });
  memberFindManyMock.mockResolvedValue([]);
  queryRawUnsafeMock.mockResolvedValue([{ roomId: ROOM_ID, unreadCount: 2 }]);
  notificationGroupByMock.mockResolvedValue([
    { referenceId: ROOM_ID, _count: { _all: 1 } },
  ]);
  pinGroupByMock.mockResolvedValue([]);
  membershipFindManyMock.mockResolvedValue([]);
  readStateFindManyMock.mockResolvedValue([]);
});

describe("GET /chats/rooms/{id}", () => {
  it("returns the room without opening an interactive transaction", async () => {
    const response = await createApp(userAuthContext).request(`/${ROOM_ID}`);

    expect(response.status).toBe(200);
    expect(prismaTransactionMock).not.toHaveBeenCalled();
    expect(roomFindFirstMock).toHaveBeenCalledOnce();
    // once for host-org membership resolve, once for organizationName
    expect(organizationFindUniqueMock).toHaveBeenCalledTimes(2);
    expect(memberFindUniqueMock).toHaveBeenCalledOnce();
    expect(queryRawUnsafeMock).toHaveBeenCalledOnce();
    expect(notificationGroupByMock).toHaveBeenCalledOnce();
    expect(membershipFindManyMock).toHaveBeenCalledOnce();
    expect(readStateFindManyMock).toHaveBeenCalledOnce();

    const body = await response.json();
    expect(body.data).toMatchObject({
      id: ROOM_ID,
      name: "Launch Room",
      organizationName: "Acme Corp",
      unreadCount: 2,
      unreadMentionCount: 1,
      starredAt: null,
      markedUnread: false,
    });
  });

  it("sets peerInActiveOrganization true for a Personal Direct whose peer is an org Member", async () => {
    roomFindFirstMock.mockResolvedValue(personalDirectRoom());
    memberFindManyMock.mockResolvedValue([{ userId: PEER_ID }]);

    const response = await createApp(userAuthContext).request(`/${ROOM_ID}`);

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.data.peerInActiveOrganization).toBe(true);
    expect(body.data.organizationId).toBeNull();
    expect(memberFindManyMock).toHaveBeenCalledWith({
      where: {
        organizationId: ORG_ID,
        userId: { in: [PEER_ID] },
      },
      select: { userId: true },
    });
  });

  it("sets peerInActiveOrganization false for a Personal Direct whose peer is not an org Member", async () => {
    roomFindFirstMock.mockResolvedValue(personalDirectRoom());
    memberFindManyMock.mockResolvedValue([]);

    const response = await createApp(userAuthContext).request(`/${ROOM_ID}`);

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.data.peerInActiveOrganization).toBe(false);
  });

  it("returns 404 when the room is missing", async () => {
    roomFindFirstMock.mockResolvedValue(null);

    const response = await createApp(userAuthContext).request(`/${ROOM_ID}`);

    expect(response.status).toBe(404);
    expect(prismaTransactionMock).not.toHaveBeenCalled();
    expect(organizationFindUniqueMock).not.toHaveBeenCalled();
    expect(memberFindUniqueMock).not.toHaveBeenCalled();
    expect(queryRawUnsafeMock).not.toHaveBeenCalled();
  });
});
