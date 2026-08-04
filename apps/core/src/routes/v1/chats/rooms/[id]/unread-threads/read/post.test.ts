import { OpenAPIHono } from "@hono/zod-openapi";
import { MemberRole } from "@sokosumi/database";
import type { RequestIdVariables } from "hono/request-id";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { errorHandler } from "@/helpers/error-handler";
import type { OpenAPIHonoWithAuth } from "@/lib/hono";
import { defaultValidationHook } from "@/lib/hono";
import type { AuthVariables } from "@/middleware/auth";

import mountMarkAllChatRoomUnreadThreadsRead from "./post";

const {
  roomFindFirstMock,
  organizationFindUniqueMock,
  memberFindUniqueMock,
  queryRawUnsafeMock,
  threadReadUpsertMock,
} = vi.hoisted(() => ({
  roomFindFirstMock: vi.fn(),
  organizationFindUniqueMock: vi.fn(),
  memberFindUniqueMock: vi.fn(),
  queryRawUnsafeMock: vi.fn(),
  threadReadUpsertMock: vi.fn(),
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
    chatRoomThreadReadState: {
      upsert: threadReadUpsertMock,
    },
    $queryRawUnsafe: queryRawUnsafeMock,
  },
}));

const ROOM_ID = "550e8400-e29b-41d4-a716-446655440000";
const PARENT_A = "550e8400-e29b-41d4-a716-446655440001";
const PARENT_B = "550e8400-e29b-41d4-a716-446655440002";
const USER_ID = "user_123";
const ORG_ID = "org_1";

function createApp(authContext: AuthVariables["authContext"]) {
  const app = new OpenAPIHono<{
    Variables: AuthVariables & RequestIdVariables;
  }>({
    defaultHook: defaultValidationHook,
  });

  app.use("*", async (c, next) => {
    c.set("requestId", "req_mark_all_unread_threads");
    c.set("isAuthenticated", true);
    c.set("authContext", authContext);
    return await next();
  });

  app.onError(errorHandler);
  mountMarkAllChatRoomUnreadThreadsRead(app as unknown as OpenAPIHonoWithAuth);
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

describe("POST /chats/rooms/{id}/unread-threads/read", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    roomFindFirstMock.mockResolvedValue(room());
    organizationFindUniqueMock.mockResolvedValue({ id: ORG_ID });
    memberFindUniqueMock.mockResolvedValue({
      role: MemberRole.MEMBER,
      organizationId: ORG_ID,
    });
    queryRawUnsafeMock.mockResolvedValue([
      {
        parentMessageId: PARENT_A,
        unreadReplyCount: 2,
        lastUnreadReplyAt: new Date("2026-08-01T01:00:00.000Z"),
      },
      {
        parentMessageId: PARENT_B,
        unreadReplyCount: 1,
        lastUnreadReplyAt: new Date("2026-08-01T02:00:00.000Z"),
      },
    ]);
    threadReadUpsertMock.mockImplementation(
      async (args: {
        create: { parentMessageId: string; lastReadAt: Date };
      }) => ({
        parentMessageId: args.create.parentMessageId,
        lastReadAt: args.create.lastReadAt,
      }),
    );
  });

  it("upserts look state for each attention parent and returns markedCount", async () => {
    const app = createApp(userAuthContext);
    const response = await app.request(`/${ROOM_ID}/unread-threads/read`, {
      method: "POST",
    });

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.data).toEqual({ markedCount: 2 });
    expect(threadReadUpsertMock).toHaveBeenCalledTimes(2);
    expect(threadReadUpsertMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          userId_parentMessageId: {
            userId: USER_ID,
            parentMessageId: PARENT_A,
          },
        },
      }),
    );
    expect(threadReadUpsertMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          userId_parentMessageId: {
            userId: USER_ID,
            parentMessageId: PARENT_B,
          },
        },
      }),
    );
  });

  it("returns markedCount 0 when nothing needs attention", async () => {
    queryRawUnsafeMock.mockResolvedValue([]);
    const app = createApp(userAuthContext);
    const response = await app.request(`/${ROOM_ID}/unread-threads/read`, {
      method: "POST",
    });

    expect(response.status).toBe(200);
    expect((await response.json()).data).toEqual({ markedCount: 0 });
    expect(threadReadUpsertMock).not.toHaveBeenCalled();
  });

  it("rejects non-user auth contexts", async () => {
    const response = await createApp(coworkerAuthContext).request(
      `/${ROOM_ID}/unread-threads/read`,
      {
        method: "POST",
      },
    );
    expect(response.status).toBe(403);
  });
});
