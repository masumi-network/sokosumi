import { OpenAPIHono } from "@hono/zod-openapi";
import { MemberRole } from "@sokosumi/database";
import type { RequestIdVariables } from "hono/request-id";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { errorHandler } from "@/helpers/error-handler";
import type { OpenAPIHonoWithAuth } from "@/lib/hono";
import { defaultValidationHook } from "@/lib/hono";
import type { AuthVariables } from "@/middleware/auth";

import mountGetChatRoomThreadsAttentionCount from "./get";

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
    $queryRawUnsafe: queryRawUnsafeMock,
    chatRoomMessage: {
      findMany: messageFindManyMock,
    },
  },
}));

const ROOM_ID = "550e8400-e29b-41d4-a716-446655440000";
const USER_ID = "user_123";
const ORG_ID = "org_1";
const COWORKER_ID = "cow_123";

function createApp(authContext: AuthVariables["authContext"]) {
  const app = new OpenAPIHono<{
    Variables: AuthVariables & RequestIdVariables;
  }>({
    defaultHook: defaultValidationHook,
  });

  app.use("*", async (c, next) => {
    c.set("requestId", "req_get_chat_room_threads_attention_count");
    c.set("isAuthenticated", true);
    c.set("authContext", authContext);
    return await next();
  });

  app.onError(errorHandler);
  mountGetChatRoomThreadsAttentionCount(app as unknown as OpenAPIHonoWithAuth);
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
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  roomFindFirstMock.mockResolvedValue(room());
  organizationFindUniqueMock.mockResolvedValue({ id: ORG_ID });
  memberFindUniqueMock.mockResolvedValue({ role: MemberRole.MEMBER });
  queryRawUnsafeMock.mockResolvedValue([{ count: 4 }]);
});

describe("GET /chats/rooms/{id}/threads/attention-count", () => {
  it("returns the attention thread count without hydrating parents", async () => {
    const response = await createApp(userAuthContext).request(
      `/${ROOM_ID}/threads/attention-count`,
    );

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.data).toEqual({ count: 4 });
    expect(queryRawUnsafeMock).toHaveBeenCalledOnce();
    expect(messageFindManyMock).not.toHaveBeenCalled();
    const sql = String(queryRawUnsafeMock.mock.calls[0]?.[0]);
    expect(sql).toContain("COUNT(DISTINCT parent.id)");
    expect(sql).toContain('room_read."createdAt"');
    expect(sql).not.toContain('"unreadReplyCount"');
  });

  it("rejects coworker auth with 403", async () => {
    const response = await createApp(coworkerAuthContext).request(
      `/${ROOM_ID}/threads/attention-count`,
    );

    expect(response.status).toBe(403);
    expect(roomFindFirstMock).not.toHaveBeenCalled();
    expect(queryRawUnsafeMock).not.toHaveBeenCalled();
    expect(messageFindManyMock).not.toHaveBeenCalled();
  });
});
