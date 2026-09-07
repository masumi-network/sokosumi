import { MemberRole } from "@sokosumi/database";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { errorHandler } from "@/helpers/error-handler";
import { OpenAPIHonoWithAuth } from "@/lib/hono";
import type { AuthVariables } from "@/middleware/auth";

import mountGetChatRoomMessage from "./get";

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
  prismaTransactionMock,
} = vi.hoisted(() => ({
  roomFindFirstMock: vi.fn(),
  organizationFindUniqueMock: vi.fn(),
  memberFindUniqueMock: vi.fn(),
  messageFindFirstMock: vi.fn(),
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
    chatRoomMessage: {
      findFirst: messageFindFirstMock,
    },
    $transaction: prismaTransactionMock,
  },
}));

const ROOM_ID = "550e8400-e29b-41d4-a716-446655440000";
const MESSAGE_ID = "550e8400-e29b-41d4-a716-446655440001";
const PARENT_MESSAGE_ID = "550e8400-e29b-41d4-a716-446655440021";
const USER_ID = "user_123";
const ORG_ID = "org_1";

function createApp(authContext: AuthVariables["authContext"]) {
  const app = new OpenAPIHonoWithAuth();

  app.use("*", async (c, next) => {
    c.set("requestId", "req_get_chat_room_message");
    c.set("isAuthenticated", true);
    c.set("authContext", authContext);
    return await next();
  });

  app.onError(errorHandler);
  mountGetChatRoomMessage(app);
  return app;
}

const userAuthContext: AuthVariables["authContext"] = {
  actor: "user",
  userId: USER_ID,
  organizationId: ORG_ID,
  role: "user",
};

function message(overrides: Record<string, unknown> = {}) {
  return {
    id: MESSAGE_ID,
    roomId: ROOM_ID,
    parentMessageId: null,
    content: "Hello room",
    createdAt: new Date("2026-01-01T00:00:00.000Z"),
    editedAt: null,
    metadata: null,
    senderUser: {
      id: USER_ID,
      name: "Ada",
      email: "ada@example.com",
      image: null,
      sessions: [],
    },
    senderCoworker: null,
    mentionsAsSource: [],
    reactions: [],
    replies: [],
    _count: { replies: 0 },
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  messageFindFirstMock.mockReset();
  roomFindFirstMock.mockResolvedValue({
    id: ROOM_ID,
    organizationId: ORG_ID,
    userMembers: [{ access: "member" }],
  });
  organizationFindUniqueMock.mockResolvedValue({ id: ORG_ID });
  memberFindUniqueMock.mockResolvedValue({ role: MemberRole.MEMBER });
  messageFindFirstMock.mockResolvedValue(message());
});

describe("GET /chats/rooms/{id}/messages/{messageId}", () => {
  it("returns the message without opening an interactive transaction", async () => {
    const response = await createApp(userAuthContext).request(
      `/${ROOM_ID}/messages/${MESSAGE_ID}`,
    );

    expect(response.status).toBe(200);
    expect(prismaTransactionMock).not.toHaveBeenCalled();

    const body = await response.json();
    expect(body.data).toEqual(
      expect.objectContaining({
        id: MESSAGE_ID,
        roomId: ROOM_ID,
        content: "Hello room",
      }),
    );
  });

  it("names the parent of a thread reply, which is what a jump needs", async () => {
    messageFindFirstMock.mockResolvedValue(
      message({ parentMessageId: PARENT_MESSAGE_ID }),
    );

    const response = await createApp(userAuthContext).request(
      `/${ROOM_ID}/messages/${MESSAGE_ID}`,
    );

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.data.parentMessageId).toBe(PARENT_MESSAGE_ID);
  });

  it("looks the message up inside its own room", async () => {
    await createApp(userAuthContext).request(
      `/${ROOM_ID}/messages/${MESSAGE_ID}`,
    );

    expect(messageFindFirstMock).toHaveBeenCalledOnce();
    expect(messageFindFirstMock.mock.calls[0]?.[0]).toEqual(
      expect.objectContaining({
        where: { id: MESSAGE_ID, roomId: ROOM_ID },
      }),
    );
  });

  it("reads the reactions from the caller's side", async () => {
    messageFindFirstMock.mockResolvedValue(
      message({
        reactions: [
          {
            emoji: "\u{1F44D}",
            userId: USER_ID,
            user: { id: USER_ID, name: "Ada" },
          },
          {
            emoji: "\u{1F389}",
            userId: "user_other",
            user: { id: "user_other", name: "Ben" },
          },
        ],
      }),
    );

    const response = await createApp(userAuthContext).request(
      `/${ROOM_ID}/messages/${MESSAGE_ID}`,
    );

    expect(response.status).toBe(200);
    const body = await response.json();
    const mine = body.data.reactions.find(
      (reaction: { emoji: string }) => reaction.emoji === "\u{1F44D}",
    );
    const theirs = body.data.reactions.find(
      (reaction: { emoji: string }) => reaction.emoji === "\u{1F389}",
    );

    // Pins the caller argument. Without it every reaction reads as somebody
    // else's, and the reader's own reaction loses its highlight.
    expect(mine.reactedByCurrentUser).toBe(true);
    expect(theirs.reactedByCurrentUser).toBe(false);
  });

  it("returns a deleted message as a tombstone", async () => {
    messageFindFirstMock.mockResolvedValue(
      message({
        content: "Regretted",
        deletedAt: new Date("2026-01-02T00:00:00.000Z"),
        reactions: [
          {
            emoji: "\u{1F44D}",
            userId: USER_ID,
            user: { id: USER_ID, name: "Ada" },
          },
        ],
      }),
    );

    const response = await createApp(userAuthContext).request(
      `/${ROOM_ID}/messages/${MESSAGE_ID}`,
    );

    // The reader followed a notification to a message somebody deleted. They
    // get the room around it rather than an error, and none of what it said.
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.data.content).toBe("");
    expect(body.data.deletedAt).toBe("2026-01-02T00:00:00.000Z");
    expect(body.data.reactions).toEqual([]);
  });

  it("returns 404 when the message is not in the room", async () => {
    messageFindFirstMock.mockResolvedValue(null);

    const response = await createApp(userAuthContext).request(
      `/${ROOM_ID}/messages/${MESSAGE_ID}`,
    );

    expect(response.status).toBe(404);
  });

  it("returns 404 when the reader is not in the room", async () => {
    roomFindFirstMock.mockResolvedValue(null);

    const response = await createApp(userAuthContext).request(
      `/${ROOM_ID}/messages/${MESSAGE_ID}`,
    );

    expect(response.status).toBe(404);
    expect(messageFindFirstMock).not.toHaveBeenCalled();
  });
});
