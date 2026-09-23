import { beforeEach, describe, expect, it, vi } from "vitest";

import { errorHandler } from "@/helpers/error-handler";
import { OpenAPIHonoWithAuth } from "@/lib/hono";
import type { AuthVariables } from "@/middleware/auth";

import mountGetEarlierChatThreads from "./get";

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
    c.set("requestId", "req_get_earlier_chat_threads");
    c.set("isAuthenticated", true);
    c.set("authContext", authContext);
    return await next();
  });
  app.onError(errorHandler);
  mountGetEarlierChatThreads(app);
  return app;
}

function earlierRow(roomId: string, parentMessageId: string) {
  return {
    roomId,
    parentMessageId,
    parentContent: "we support max 1GB",
    replyCount: 6,
    lastReplyAt: new Date("2026-09-23T09:00:00.000Z"),
    lastReplyId: PARENT_B,
    totalThreadCount: 3,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  roomFindManyMock.mockResolvedValue([{ id: ROOM_A }, { id: ROOM_B }]);
  queryRawUnsafeMock.mockResolvedValue([]);
});

describe("GET /chats/threads/earlier", () => {
  it("lists the reader's read Threads across their rooms, one page", async () => {
    queryRawUnsafeMock.mockResolvedValue([
      earlierRow(ROOM_B, PARENT_B),
      earlierRow(ROOM_A, PARENT_A),
    ]);

    const response =
      await createApp(userAuthContext).request("/earlier?limit=1");

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.data).toEqual([
      {
        roomId: ROOM_B,
        parentMessageId: PARENT_B,
        parentContent: "we support max 1GB",
        replyCount: 6,
        lastReplyAt: "2026-09-23T09:00:00.000Z",
        lastReplyId: PARENT_B,
      },
    ]);
    expect(body.meta.pagination).toMatchObject({
      total: 3,
      nextCursor: PARENT_B,
    });
  });

  it("reads the same rooms as the unread list: sidebar rooms the reader has not muted", async () => {
    await createApp(userAuthContext).request("/earlier");

    const where = roomFindManyMock.mock.calls[0]?.[0]?.where;
    expect(where.userMembers).toEqual({
      some: { userId: USER_ID, mutedAt: null },
    });
  });

  it("rejects a coworker key", async () => {
    const response = await createApp(coworkerAuthContext).request("/earlier");

    expect(response.status).toBe(403);
    expect(roomFindManyMock).not.toHaveBeenCalled();
  });
});
