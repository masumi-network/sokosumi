import { beforeEach, describe, expect, it, vi } from "vitest";

import { errorHandler } from "@/helpers/error-handler";
import { OpenAPIHonoWithAuth } from "@/lib/hono";
import type { AuthVariables } from "@/middleware/auth";

import savedMessagesRouter from "./index";

vi.mock("@/middleware/auth", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/middleware/auth")>();
  const { stubAuthMiddleware } = await import(
    "@/test-fixtures/auth-middleware"
  );
  return { ...actual, authMiddleware: stubAuthMiddleware };
});

const db = vi.hoisted(() => ({
  chatRoom: { findFirst: vi.fn() },
  organization: { findUnique: vi.fn() },
  member: { findUnique: vi.fn() },
  chatRoomMessage: { findFirst: vi.fn(), groupBy: vi.fn() },
  chatRoomSavedMessage: {
    createMany: vi.fn(),
    deleteMany: vi.fn(),
    findMany: vi.fn(),
    count: vi.fn(),
  },
  $transaction: vi.fn(),
}));

vi.mock("@/lib/db/prisma", () => ({ default: db }));

const ROOM_ID = "550e8400-e29b-41d4-a716-446655440000";
const MESSAGE_ID = "550e8400-e29b-41d4-a716-446655440001";
const USER_ID = "user_123";
const ORG_ID = "org_1";

function createApp() {
  const app = new OpenAPIHonoWithAuth();
  app.use("*", async (c, next) => {
    c.set("requestId", "req_saved_messages");
    c.set("isAuthenticated", true);
    c.set("authContext", {
      actor: "user",
      userId: USER_ID,
      organizationId: ORG_ID,
      role: "user",
    } satisfies AuthVariables["authContext"]);
    return await next();
  });
  app.onError(errorHandler);
  app.route("/", savedMessagesRouter);
  return app;
}

beforeEach(() => {
  vi.clearAllMocks();
  db.$transaction.mockImplementation(async (run) => run(db));
  db.chatRoomMessage.findFirst.mockResolvedValue({
    roomId: ROOM_ID,
    metadata: null,
  });
  db.chatRoomMessage.groupBy.mockResolvedValue([]);
  db.chatRoom.findFirst.mockResolvedValue({
    id: ROOM_ID,
    organizationId: ORG_ID,
    kind: "direct",
    discoverability: null,
    userMembers: [{ access: "member" }],
  });
  db.organization.findUnique.mockResolvedValue({ id: ORG_ID });
  db.member.findUnique.mockResolvedValue({ id: "member_1", role: "member" });
  db.chatRoomSavedMessage.createMany.mockResolvedValue({ count: 1 });
  db.chatRoomSavedMessage.deleteMany.mockResolvedValue({ count: 1 });
  db.chatRoomSavedMessage.findMany.mockResolvedValue([]);
  db.chatRoomSavedMessage.count.mockResolvedValue(0);
});

describe("PUT /chats/saved-messages/{messageId}", () => {
  it("saves a message in a room the reader belongs to, idempotently", async () => {
    const response = await createApp().request(`/${MESSAGE_ID}`, {
      method: "PUT",
    });

    expect(response.status).toBe(200);
    expect((await response.json()).data).toEqual({
      messageId: MESSAGE_ID,
      saved: true,
    });
    expect(db.chatRoomSavedMessage.createMany).toHaveBeenCalledWith({
      data: { userId: USER_ID, messageId: MESSAGE_ID },
      skipDuplicates: true,
    });
  });

  it("refuses a message in a room the reader is not in", async () => {
    db.chatRoom.findFirst.mockResolvedValue(null);

    const response = await createApp().request(`/${MESSAGE_ID}`, {
      method: "PUT",
    });

    expect(response.status).toBe(404);
    expect(db.chatRoomSavedMessage.createMany).not.toHaveBeenCalled();
  });

  it("refuses a deleted or unknown message", async () => {
    db.chatRoomMessage.findFirst.mockResolvedValue(null);

    const response = await createApp().request(`/${MESSAGE_ID}`, {
      method: "PUT",
    });

    expect(response.status).toBe(404);
    expect(db.chatRoomMessage.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: MESSAGE_ID, deletedAt: null },
      }),
    );
    expect(db.chatRoomSavedMessage.createMany).not.toHaveBeenCalled();
  });
});

describe("DELETE /chats/saved-messages/{messageId}", () => {
  it("removes only the reader's own save", async () => {
    const response = await createApp().request(`/${MESSAGE_ID}`, {
      method: "DELETE",
    });

    expect(response.status).toBe(200);
    expect((await response.json()).data.saved).toBe(false);
    expect(db.chatRoomSavedMessage.deleteMany).toHaveBeenCalledWith({
      where: { userId: USER_ID, messageId: MESSAGE_ID },
    });
  });
});

describe("GET /chats/saved-messages", () => {
  it("lists readable saves newest first with the live message", async () => {
    db.chatRoomSavedMessage.findMany.mockResolvedValue([
      {
        id: "save_1",
        messageId: MESSAGE_ID,
        savedAt: new Date("2026-11-09T08:00:00.000Z"),
        message: {
          id: MESSAGE_ID,
          roomId: ROOM_ID,
          parentMessageId: null,
          content: "ship it friday",
          createdAt: new Date("2026-11-08T08:00:00.000Z"),
          deletedAt: null,
          editedAt: null,
          metadata: null,
          senderUser: {
            id: "user_2",
            name: "Ada",
            email: "ada@example.com",
            image: null,
            sessions: [],
          },
          senderCoworker: null,
          mentionsAsSource: [],
          reactions: [],
          replies: [],
          pins: [],
        },
      },
    ]);
    db.chatRoomSavedMessage.count.mockResolvedValue(1);

    const response = await createApp().request("/");

    expect(response.status).toBe(200);
    const findArgs = db.chatRoomSavedMessage.findMany.mock.calls[0][0];
    expect(findArgs.orderBy).toEqual([{ savedAt: "desc" }, { id: "desc" }]);
    expect(findArgs.where).toMatchObject({
      userId: USER_ID,
      message: {
        deletedAt: null,
        room: { userMembers: { some: { userId: USER_ID } } },
      },
    });
    const body = await response.json();
    expect(body.data).toEqual([
      expect.objectContaining({
        messageId: MESSAGE_ID,
        message: expect.objectContaining({ content: "ship it friday" }),
      }),
    ]);
  });
});
