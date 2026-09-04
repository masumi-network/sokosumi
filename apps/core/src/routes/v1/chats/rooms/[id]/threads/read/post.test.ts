import { MemberRole } from "@sokosumi/database";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { errorHandler } from "@/helpers/error-handler";
import { OpenAPIHonoWithAuth } from "@/lib/hono";
import type { AuthVariables } from "@/middleware/auth";

import mountPostChatRoomThreadsRead from "./post";

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
  queryRawUnsafeMock,
  threadReadUpsertMock,
  prismaTransactionMock,
} = vi.hoisted(() => ({
  roomFindFirstMock: vi.fn(),
  organizationFindUniqueMock: vi.fn(),
  memberFindUniqueMock: vi.fn(),
  queryRawUnsafeMock: vi.fn(),
  threadReadUpsertMock: vi.fn(),
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
    },
    $queryRawUnsafe: queryRawUnsafeMock,
    chatRoomThreadReadState: {
      upsert: threadReadUpsertMock,
    },
    $transaction: prismaTransactionMock,
  },
}));

const ROOM_ID = "550e8400-e29b-41d4-a716-446655440000";
const PARENT_ID_1 = "550e8400-e29b-41d4-a716-446655440001";
const PARENT_ID_2 = "550e8400-e29b-41d4-a716-446655440002";
const USER_ID = "user_123";
const ORG_ID = "org_1";
const COWORKER_ID = "cow_123";

const tx = {
  chatRoom: { findFirst: roomFindFirstMock },
  organization: { findUnique: organizationFindUniqueMock },
  member: { findUnique: memberFindUniqueMock },
  $queryRawUnsafe: queryRawUnsafeMock,
  chatRoomThreadReadState: { upsert: threadReadUpsertMock },
};

function createApp(authContext: AuthVariables["authContext"]) {
  const app = new OpenAPIHonoWithAuth();

  app.use("*", async (c, next) => {
    c.set("requestId", "req_mark_chat_room_threads_read");
    c.set("isAuthenticated", true);
    c.set("authContext", authContext);
    return await next();
  });

  app.onError(errorHandler);
  mountPostChatRoomThreadsRead(app);
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
  coworkerId: COWORKER_ID,
  vendorId: "01960001-0001-7001-8001-000000000001",
  context: { userId: USER_ID, organizationId: ORG_ID },
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
    sokoBotMembers: [],
  };
}

function unreadAggregate(parentMessageId: string) {
  return {
    parentMessageId,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  prismaTransactionMock.mockImplementation(async (cb) => cb(tx));
  roomFindFirstMock.mockResolvedValue(room());
  organizationFindUniqueMock.mockResolvedValue({ id: ORG_ID });
  memberFindUniqueMock.mockResolvedValue({ role: MemberRole.MEMBER });
  threadReadUpsertMock.mockResolvedValue({});
});

describe("POST /chats/rooms/{id}/threads/read", () => {
  it("upserts look state for dual-baseline attention parents and returns markedCount", async () => {
    queryRawUnsafeMock.mockResolvedValue([
      unreadAggregate(PARENT_ID_1),
      unreadAggregate(PARENT_ID_2),
    ]);

    const response = await createApp(userAuthContext).request(
      `/${ROOM_ID}/threads/read`,
      { method: "POST" },
    );

    expect(response.status).toBe(200);
    expect(prismaTransactionMock).toHaveBeenCalledOnce();
    expect(queryRawUnsafeMock).toHaveBeenCalledOnce();
    const sql = String(queryRawUnsafeMock.mock.calls[0]?.[0]);
    expect(sql).toContain('room_read."createdAt"');
    expect(sql).toContain("'-infinity'::timestamp");
    expect(sql).toContain('thread_read."lastReadAt"');
    expect(threadReadUpsertMock).toHaveBeenCalledTimes(2);
    expect(threadReadUpsertMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          userId_parentMessageId: {
            userId: USER_ID,
            parentMessageId: PARENT_ID_1,
          },
        },
        update: { lastReadAt: expect.any(Date) },
        create: expect.objectContaining({
          userId: USER_ID,
          parentMessageId: PARENT_ID_1,
          lastReadAt: expect.any(Date),
        }),
      }),
    );
    expect(threadReadUpsertMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          userId_parentMessageId: {
            userId: USER_ID,
            parentMessageId: PARENT_ID_2,
          },
        },
      }),
    );

    const body = await response.json();
    expect(body.data).toEqual({ markedCount: 2 });
  });

  it("returns markedCount 0 when no unread threads exist", async () => {
    queryRawUnsafeMock.mockResolvedValue([]);

    const response = await createApp(userAuthContext).request(
      `/${ROOM_ID}/threads/read`,
      { method: "POST" },
    );

    expect(response.status).toBe(200);
    expect(threadReadUpsertMock).not.toHaveBeenCalled();

    const body = await response.json();
    expect(body.data).toEqual({ markedCount: 0 });
  });

  it("rejects coworker auth with 403", async () => {
    const response = await createApp(coworkerAuthContext).request(
      `/${ROOM_ID}/threads/read`,
      { method: "POST" },
    );

    expect(response.status).toBe(403);
    expect(roomFindFirstMock).not.toHaveBeenCalled();
    expect(queryRawUnsafeMock).not.toHaveBeenCalled();
    expect(threadReadUpsertMock).not.toHaveBeenCalled();
  });
});
