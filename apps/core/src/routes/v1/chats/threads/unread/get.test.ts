import { beforeEach, describe, expect, it, vi } from "vitest";

import { errorHandler } from "@/helpers/error-handler";
import { OpenAPIHonoWithAuth } from "@/lib/hono";
import type { AuthVariables } from "@/middleware/auth";

import mountGetUnreadChatThreads from "./get";

vi.mock("@/middleware/auth", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/middleware/auth")>();
  const { stubAuthMiddleware } = await import(
    "@/test-fixtures/auth-middleware"
  );
  return { ...actual, authMiddleware: stubAuthMiddleware };
});

const { roomFindManyMock, queryRawUnsafeMock } = vi.hoisted(() => ({
  roomFindManyMock: vi.fn(),
  queryRawUnsafeMock: vi.fn(),
}));

vi.mock("@/lib/db/prisma", () => ({
  default: {
    chatRoom: { findMany: roomFindManyMock },
    $queryRawUnsafe: queryRawUnsafeMock,
  },
}));

const USER_ID = "user_123";
const ORG_ID = "org_1";
const ROOM_A = "550e8400-e29b-41d4-a716-4466554400aa";
const ROOM_B = "550e8400-e29b-41d4-a716-4466554400bb";
const PARENT_A = "550e8400-e29b-41d4-a716-4466554401aa";
const PARENT_B = "550e8400-e29b-41d4-a716-4466554401bb";

const userAuthContext: AuthVariables["authContext"] = {
  actor: "user",
  userId: USER_ID,
  organizationId: ORG_ID,
  role: "user",
};

const coworkerAuthContext: AuthVariables["authContext"] = {
  actor: "coworker",
  coworkerId: "cow_123",
  vendorId: "01960001-0001-7001-8001-000000000001",
  context: { userId: USER_ID, organizationId: ORG_ID },
};

function createApp(authContext: AuthVariables["authContext"]) {
  const app = new OpenAPIHonoWithAuth();
  app.use("*", async (c, next) => {
    c.set("requestId", "req_get_unread_chat_threads");
    c.set("isAuthenticated", true);
    c.set("authContext", authContext);
    return await next();
  });
  app.onError(errorHandler);
  mountGetUnreadChatThreads(app);
  return app;
}

function unreadRow(roomId: string, parentMessageId: string) {
  return {
    roomId,
    parentMessageId,
    firstUnreadReplyId: PARENT_B,
    parentContent: "added it into linear",
    unreadReplyCount: 2,
    unreadMentionCount: 0,
    lastUnreadAt: new Date("2026-09-23T09:00:00.000Z"),
    totalThreadCount: 5,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  roomFindManyMock.mockResolvedValue([{ id: ROOM_A }, { id: ROOM_B }]);
  queryRawUnsafeMock.mockResolvedValue([]);
});

describe("GET /chats/threads/unread", () => {
  it("lists the reader's unread Threads across their rooms, one page", async () => {
    queryRawUnsafeMock.mockResolvedValue([
      unreadRow(ROOM_B, PARENT_B),
      unreadRow(ROOM_A, PARENT_A),
    ]);

    const response =
      await createApp(userAuthContext).request("/unread?limit=1");

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.data).toEqual([
      {
        roomId: ROOM_B,
        parentMessageId: PARENT_B,
        firstUnreadReplyId: PARENT_B,
        parentContent: "added it into linear",
        unreadReplyCount: 2,
        unreadMentionCount: 0,
        lastUnreadAt: "2026-09-23T09:00:00.000Z",
      },
    ]);
    expect(body.meta.pagination).toEqual({
      cursor: null,
      limit: 1,
      total: 5,
      nextCursor: PARENT_B,
    });
  });

  it("reads only rooms the reader sees in the sidebar and has not muted", async () => {
    await createApp(userAuthContext).request("/unread");

    const where = roomFindManyMock.mock.calls[0]?.[0]?.where;
    expect(where.userMembers).toEqual({
      some: { userId: USER_ID, mutedAt: null },
    });
    expect(where.archivedAt).toBeNull();
    expect(queryRawUnsafeMock.mock.calls[0]?.slice(1, 4)).toEqual([
      ROOM_A,
      ROOM_B,
      USER_ID,
    ]);
  });

  it("continues from the cursor Thread", async () => {
    await createApp(userAuthContext).request(
      `/unread?cursor=${PARENT_A}&limit=10`,
    );

    expect(queryRawUnsafeMock.mock.calls[0]?.slice(-2)).toEqual([11, PARENT_A]);
  });

  it("answers an empty list without reading replies when the reader is in no room", async () => {
    roomFindManyMock.mockResolvedValue([]);

    const response = await createApp(userAuthContext).request("/unread");

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.data).toEqual([]);
    expect(body.meta.pagination.total).toBe(0);
    expect(queryRawUnsafeMock).not.toHaveBeenCalled();
  });

  it("rejects a coworker key", async () => {
    const response = await createApp(coworkerAuthContext).request("/unread");

    expect(response.status).toBe(403);
    expect(roomFindManyMock).not.toHaveBeenCalled();
  });
});
