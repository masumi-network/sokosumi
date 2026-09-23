import { MemberRole } from "@sokosumi/database";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { errorHandler } from "@/helpers/error-handler";
import { OpenAPIHonoWithAuth } from "@/lib/hono";
import type { AuthVariables } from "@/middleware/auth";

import mountPostChatRoomThreadMute from "./post";

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
  setThreadMutedMock,
  getThreadMock,
} = vi.hoisted(() => ({
  roomFindFirstMock: vi.fn(),
  organizationFindUniqueMock: vi.fn(),
  memberFindUniqueMock: vi.fn(),
  setThreadMutedMock: vi.fn(),
  getThreadMock: vi.fn(),
}));

vi.mock("@/lib/db/prisma", () => ({
  default: {
    chatRoom: { findFirst: roomFindFirstMock },
    organization: { findUnique: organizationFindUniqueMock },
    member: { findUnique: memberFindUniqueMock },
  },
}));

vi.mock("../../../../room-unread", () => ({
  setChatRoomThreadMuted: (...args: unknown[]) => setThreadMutedMock(...args),
  getChatRoomThread: (...args: unknown[]) => getThreadMock(...args),
}));

const ROOM_ID = "550e8400-e29b-41d4-a716-446655440000";
const PARENT_ID = "550e8400-e29b-41d4-a716-446655440001";
const USER_ID = "user_123";
const ORG_ID = "org_1";
const MUTED_AT = new Date("2026-07-02T12:00:00.000Z");

function createApp(authContext: AuthVariables["authContext"]) {
  const app = new OpenAPIHonoWithAuth();

  app.use("*", async (c, next) => {
    c.set("requestId", "req_mute_chat_room_thread");
    c.set("isAuthenticated", true);
    c.set("authContext", authContext);
    return await next();
  });

  app.onError(errorHandler);
  mountPostChatRoomThreadMute(app);
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
  coworkerId: "cow_123",
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
    groupName: null,
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

function thread() {
  return {
    parentMessage: {
      id: PARENT_ID,
      roomId: ROOM_ID,
      parentMessageId: null,
      content: "root",
      createdAt: "2026-07-02T11:00:00.000Z",
      editedAt: null,
      deletedAt: null,
      pinnedAt: null,
      sender: {
        type: "user",
        user: {
          id: USER_ID,
          name: "Ada",
          email: "ada@example.com",
          image: null,
          presence: "offline",
        },
      },
      mentions: [],
      reactions: [],
      threadReplyCount: 2,
      threadLastReplyAt: "2026-07-02T11:30:00.000Z",
      metadata: null,
      quote: null,
      membership: null,
      groupNameChange: null,
      unfurls: null,
    },
    replyCount: 2,
    lastReplyAt: "2026-07-02T11:30:00.000Z",
    unreadReplyCount: 0,
    lastUnreadReplyAt: null,
    hasLooked: true,
    mutedAt: MUTED_AT.toISOString(),
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  roomFindFirstMock.mockResolvedValue(room());
  organizationFindUniqueMock.mockResolvedValue({ id: ORG_ID });
  memberFindUniqueMock.mockResolvedValue({ role: MemberRole.MEMBER });
  setThreadMutedMock.mockResolvedValue({
    parentMessageId: PARENT_ID,
    mutedAt: MUTED_AT,
  });
  getThreadMock.mockResolvedValue(thread());
});

describe("POST /chats/rooms/{id}/threads/{parentMessageId}/mute", () => {
  it("mutes the thread for the caller and answers with it", async () => {
    const response = await createApp(userAuthContext).request(
      `/${ROOM_ID}/threads/${PARENT_ID}/mute`,
      { method: "POST" },
    );

    expect(response.status).toBe(200);
    expect(setThreadMutedMock).toHaveBeenCalledWith(
      ROOM_ID,
      USER_ID,
      PARENT_ID,
      true,
      expect.anything(),
    );

    const body = await response.json();
    expect(body.data.mutedAt).toBe(MUTED_AT.toISOString());
  });

  it("returns 404 when the parent is not a live root of this room", async () => {
    setThreadMutedMock.mockResolvedValue(null);

    const response = await createApp(userAuthContext).request(
      `/${ROOM_ID}/threads/${PARENT_ID}/mute`,
      { method: "POST" },
    );

    expect(response.status).toBe(404);
    expect(getThreadMock).not.toHaveBeenCalled();
  });

  it("rejects coworker auth with 403", async () => {
    const response = await createApp(coworkerAuthContext).request(
      `/${ROOM_ID}/threads/${PARENT_ID}/mute`,
      { method: "POST" },
    );

    expect(response.status).toBe(403);
    expect(setThreadMutedMock).not.toHaveBeenCalled();
  });
});
