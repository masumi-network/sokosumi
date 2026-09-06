import { beforeEach, describe, expect, it, vi } from "vitest";
import { OpenAPIHonoWithAuth } from "@/lib/hono";
import type { AuthVariables } from "@/middleware/auth";

import mountGetRoomStreamMessages from "./get";

vi.mock("@/middleware/auth", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/middleware/auth")>();
  const { stubAuthMiddleware } = await import(
    "@/test-fixtures/auth-middleware"
  );
  return { ...actual, authMiddleware: stubAuthMiddleware };
});

const {
  roomFindFirstMock,
  chatRoomMessageFindManyMock,
  chatRoomMessageCountMock,
  organizationFindUniqueMock,
  memberFindUniqueMock,
  validateUIMessagesMock,
} = vi.hoisted(() => ({
  roomFindFirstMock: vi.fn(),
  chatRoomMessageFindManyMock: vi.fn(),
  chatRoomMessageCountMock: vi.fn(),
  organizationFindUniqueMock: vi.fn(),
  memberFindUniqueMock: vi.fn(),
  validateUIMessagesMock: vi.fn(),
}));

vi.mock("ai", () => ({
  validateUIMessages: validateUIMessagesMock,
}));

vi.mock("@/lib/db/prisma", () => ({
  default: {
    chatRoom: {
      findFirst: roomFindFirstMock,
    },
    chatRoomMessage: {
      findMany: chatRoomMessageFindManyMock,
      count: chatRoomMessageCountMock,
    },
    organization: {
      findUnique: organizationFindUniqueMock,
    },
    member: {
      findUnique: memberFindUniqueMock,
    },
  },
}));

const ROOM_ID = "550e8400-e29b-41d4-a716-446655440000";
const USER_ID = "user_123";

const userAuthContext: AuthVariables["authContext"] = {
  actor: "user",
  userId: USER_ID,
  organizationId: "org_1",
  role: "user",
};

function createApp(
  authContext: AuthVariables["authContext"] = userAuthContext,
) {
  const app = new OpenAPIHonoWithAuth();

  app.use("*", async (c, next) => {
    c.set("isAuthenticated", true);
    c.set("authContext", authContext);
    return await next();
  });

  mountGetRoomStreamMessages(app);
  return app;
}

beforeEach(() => {
  vi.clearAllMocks();
  organizationFindUniqueMock.mockResolvedValue({ id: "org_1" });
  memberFindUniqueMock.mockResolvedValue({ role: "member" });
  chatRoomMessageCountMock.mockResolvedValue(0);
  validateUIMessagesMock.mockImplementation(
    async ({ messages }: { messages: unknown[] }) => messages,
  );
});

describe("GET /chats/rooms/{id}/stream/messages", () => {
  it("returns 404 when room is missing or caller is not a member", async () => {
    roomFindFirstMock.mockResolvedValue(null);

    const app = createApp();
    const response = await app.request(`/${ROOM_ID}/stream/messages`);

    expect(response.status).toBe(404);
    expect(chatRoomMessageFindManyMock).not.toHaveBeenCalled();
  });

  it("returns empty messages when room has no stream history", async () => {
    roomFindFirstMock.mockResolvedValue({
      id: ROOM_ID,
      organizationId: "org_1",
      userMembers: [{ access: "member" }],
    });
    chatRoomMessageFindManyMock.mockResolvedValue([]);

    const app = createApp();
    const response = await app.request(`/${ROOM_ID}/stream/messages`);

    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      data: { messages: unknown[] };
      meta: { pagination: { total: number } };
    };
    expect(body.data.messages).toEqual([]);
    expect(body.meta.pagination.total).toBe(0);
  });

  it("returns UIMessages from persisted chat_room_message rows", async () => {
    roomFindFirstMock.mockResolvedValue({
      id: ROOM_ID,
      organizationId: "org_1",
      userMembers: [{ access: "member" }],
    });
    chatRoomMessageCountMock.mockResolvedValue(2);
    // findMany is newest-first; handler reverses to reading order.
    chatRoomMessageFindManyMock.mockResolvedValue([
      {
        id: "m2",
        content: "Hello back",
        senderUserId: null,
        senderCoworkerId: "coworker_1",
        metadata: null,
        createdAt: new Date("2026-01-01T00:00:01.000Z"),
      },
      {
        id: "m1",
        content: "Hi",
        senderUserId: USER_ID,
        senderCoworkerId: null,
        metadata: null,
        createdAt: new Date("2026-01-01T00:00:00.000Z"),
      },
    ]);

    const app = createApp();
    const response = await app.request(`/${ROOM_ID}/stream/messages`);

    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      data: {
        messages: Array<{ id: string; role: string; parts: unknown[] }>;
      };
      meta: { pagination: { total: number; nextCursor: string | null } };
    };
    expect(body.data.messages).toHaveLength(2);
    expect(body.data.messages[0]?.id).toBe("m1");
    expect(body.data.messages[0]?.role).toBe("user");
    expect(body.data.messages[1]?.id).toBe("m2");
    expect(body.data.messages[1]?.role).toBe("assistant");
    expect(body.meta.pagination.total).toBe(2);
    expect(body.meta.pagination.nextCursor).toBeNull();
    expect(chatRoomMessageFindManyMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          roomId: ROOM_ID,
          parentMessageId: null,
        },
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      }),
    );
  });

  it("pages newest-first so nextCursor is the oldest id on the page", async () => {
    roomFindFirstMock.mockResolvedValue({
      id: ROOM_ID,
      organizationId: "org_1",
      userMembers: [{ access: "member" }],
    });
    chatRoomMessageCountMock.mockResolvedValue(3);
    chatRoomMessageFindManyMock.mockResolvedValue([
      {
        id: "m3",
        content: "newest",
        senderUserId: USER_ID,
        senderCoworkerId: null,
        metadata: null,
        createdAt: new Date("2026-01-01T00:00:02.000Z"),
      },
      {
        id: "m2",
        content: "middle",
        senderUserId: USER_ID,
        senderCoworkerId: null,
        metadata: null,
        createdAt: new Date("2026-01-01T00:00:01.000Z"),
      },
      {
        id: "m1",
        content: "oldest on page",
        senderUserId: USER_ID,
        senderCoworkerId: null,
        metadata: null,
        createdAt: new Date("2026-01-01T00:00:00.000Z"),
      },
    ]);

    const app = createApp();
    const response = await app.request(`/${ROOM_ID}/stream/messages?limit=2`);

    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      data: { messages: Array<{ id: string }> };
      meta: { pagination: { nextCursor: string | null; limit: number } };
    };
    expect(body.meta.pagination.limit).toBe(2);
    // Reading order after reverse of newest-first page of 2: m2 then m3.
    expect(body.data.messages.map((m) => m.id)).toEqual(["m2", "m3"]);
    // nextCursor anchors older history at the oldest id on the page (m2).
    expect(body.meta.pagination.nextCursor).toBe("m2");
  });
});
