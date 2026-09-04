import { MemberRole } from "@sokosumi/database";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { errorHandler } from "@/helpers/error-handler";
import { OpenAPIHonoWithAuth } from "@/lib/hono";
import type { AuthVariables } from "@/middleware/auth";

import mountPostChatRoomThreadRead from "./post";

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
  messageFindFirstMock,
  threadReadUpsertMock,
} = vi.hoisted(() => ({
  roomFindFirstMock: vi.fn(),
  organizationFindUniqueMock: vi.fn(),
  memberFindUniqueMock: vi.fn(),
  messageFindFirstMock: vi.fn(),
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
    chatRoomMessage: {
      findFirst: messageFindFirstMock,
    },
    chatRoomThreadReadState: {
      upsert: threadReadUpsertMock,
    },
  },
}));

const ROOM_ID = "550e8400-e29b-41d4-a716-446655440000";
const PARENT_ID = "550e8400-e29b-41d4-a716-446655440001";
const USER_ID = "user_123";
const ORG_ID = "org_1";
const COWORKER_ID = "cow_123";

function createApp(authContext: AuthVariables["authContext"]) {
  const app = new OpenAPIHonoWithAuth();

  app.use("*", async (c, next) => {
    c.set("requestId", "req_mark_chat_room_thread_read");
    c.set("isAuthenticated", true);
    c.set("authContext", authContext);
    return await next();
  });

  app.onError(errorHandler);
  mountPostChatRoomThreadRead(app);
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

beforeEach(() => {
  vi.clearAllMocks();
  roomFindFirstMock.mockResolvedValue(room());
  organizationFindUniqueMock.mockResolvedValue({ id: ORG_ID });
  memberFindUniqueMock.mockResolvedValue({ role: MemberRole.MEMBER });
  messageFindFirstMock.mockResolvedValue({ id: PARENT_ID });
  threadReadUpsertMock.mockResolvedValue({
    parentMessageId: PARENT_ID,
    lastReadAt: new Date("2026-07-02T12:00:00.000Z"),
  });
});

describe("POST /chats/rooms/{id}/threads/{parentMessageId}/read", () => {
  it("upserts ChatRoomThreadReadState for the parent", async () => {
    const response = await createApp(userAuthContext).request(
      `/${ROOM_ID}/threads/${PARENT_ID}/read`,
      { method: "POST" },
    );

    expect(response.status).toBe(200);
    expect(messageFindFirstMock).toHaveBeenCalledWith({
      where: {
        id: PARENT_ID,
        roomId: ROOM_ID,
        parentMessageId: null,
      },
      select: { id: true },
    });
    expect(threadReadUpsertMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          userId_parentMessageId: {
            userId: USER_ID,
            parentMessageId: PARENT_ID,
          },
        },
        update: { lastReadAt: expect.any(Date) },
        create: expect.objectContaining({
          userId: USER_ID,
          parentMessageId: PARENT_ID,
          lastReadAt: expect.any(Date),
        }),
      }),
    );

    const body = await response.json();
    expect(body.data).toEqual({
      parentMessageId: PARENT_ID,
      lastReadAt: "2026-07-02T12:00:00.000Z",
    });
  });

  it("returns 404 when the parent message is missing", async () => {
    messageFindFirstMock.mockResolvedValue(null);

    const response = await createApp(userAuthContext).request(
      `/${ROOM_ID}/threads/${PARENT_ID}/read`,
      { method: "POST" },
    );

    expect(response.status).toBe(404);
    expect(threadReadUpsertMock).not.toHaveBeenCalled();
  });

  it("rejects coworker auth with 403", async () => {
    const response = await createApp(coworkerAuthContext).request(
      `/${ROOM_ID}/threads/${PARENT_ID}/read`,
      { method: "POST" },
    );

    expect(response.status).toBe(403);
    expect(roomFindFirstMock).not.toHaveBeenCalled();
    expect(messageFindFirstMock).not.toHaveBeenCalled();
    expect(threadReadUpsertMock).not.toHaveBeenCalled();
  });
});
