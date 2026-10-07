import { createMiddleware } from "hono/factory";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { errorHandler } from "@/helpers/error-handler.js";
import { OpenAPIHonoWithAuth } from "@/lib/hono.js";
import type { AuthenticationContext } from "@/middleware/auth";
import { requireAdminAuthContext } from "@/middleware/auth";

const BOT_ID = "11111111-1111-4111-8111-111111111111";
const ROOM_ID = "22222222-2222-4222-8222-222222222222";

const { authContextState, db } = vi.hoisted(() => ({
  authContextState: {
    current: {
      actor: "user",
      userId: "user_admin",
      organizationId: null,
      role: "admin",
    } as AuthenticationContext,
  },
  db: {
    sokoBot: { findUnique: vi.fn() },
    chatRoom: { findMany: vi.fn(), findFirst: vi.fn() },
    chatRoomMessage: { findMany: vi.fn(), count: vi.fn() },
    chatRoomUserMember: { update: vi.fn(), updateMany: vi.fn() },
    chatRoomReadState: { upsert: vi.fn(), updateMany: vi.fn() },
  },
}));

vi.mock("@/middleware/auth", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/middleware/auth")>();
  return {
    ...actual,
    authMiddleware: async (
      c: { set: (key: string, value: unknown) => void },
      next: () => Promise<unknown>,
    ) => {
      c.set("isAuthenticated", true);
      c.set("authContext", authContextState.current);
      return await next();
    },
  };
});

vi.mock("@/lib/db/prisma", () => ({ default: db }));
vi.mock("../../../../chats/rooms/helpers", () => ({
  chatRoomMessageInclude: {},
  mapChatRoomMessage: (message: { id: string }, viewer?: string) => ({
    id: message.id,
    viewer,
  }),
}));
vi.mock("@/schemas/chat-room.schema", async () => {
  const { z } = await import("@hono/zod-openapi");
  return {
    chatRoomMessageSchema: z.object({ id: z.string(), viewer: z.string() }),
  };
});

const { default: mountRooms } = await import("./get.js");
const { default: mountMessages } = await import("./[roomId]/messages/get.js");

function createApp(role: string) {
  authContextState.current = {
    actor: "user",
    userId: "user_admin",
    organizationId: null,
    role,
  };
  const app = new OpenAPIHonoWithAuth();
  app.use(
    "*",
    createMiddleware(async (c, next) => {
      requireAdminAuthContext(c.var.authContext);
      await next();
    }),
  );
  app.onError(errorHandler);
  mountRooms(app);
  mountMessages(app);
  return app;
}

function message(id: string, minute: number) {
  return { id, createdAt: new Date(Date.UTC(2026, 9, 1, 8, minute)) };
}

describe("admin Soko Bot chat view", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    db.sokoBot.findUnique.mockResolvedValue({ userId: "owner" });
  });

  it("refuses non-admins", async () => {
    const response = await createApp("user").request(`/${BOT_ID}/chats`);
    expect(response.status).toBe(403);
    expect(db.chatRoom.findMany).not.toHaveBeenCalled();
  });

  it("lists the bot's direct chats and marks the owner's", async () => {
    db.chatRoom.findMany.mockResolvedValue([
      {
        id: ROOM_ID,
        archivedAt: null,
        updatedAt: new Date("2026-10-01T08:00:00Z"),
        userMembers: [{ user: { id: "owner", name: "Patrick" } }],
      },
    ]);
    const response = await createApp("admin").request(`/${BOT_ID}/chats`);
    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      data: { isOwnerRoom: boolean }[];
    };
    expect(body.data[0]?.isOwnerRoom).toBe(true);
  });

  it("pages newest first, returns reading order, and writes nothing", async () => {
    db.chatRoom.findFirst.mockResolvedValue({ id: ROOM_ID });
    db.chatRoomMessage.findMany.mockResolvedValue([
      message("m3", 3),
      message("m2", 2),
      message("m1", 1),
    ]);
    db.chatRoomMessage.count.mockResolvedValue(3);
    const response = await createApp("admin").request(
      `/${BOT_ID}/chats/${ROOM_ID}/messages?limit=2`,
    );
    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      data: { id: string; viewer: string }[];
      meta: { pagination: { nextCursor: string | null } };
    };
    expect(body.data.map((m) => m.id)).toEqual(["m2", "m3"]);
    expect(body.data[0]?.viewer).toBe("owner");
    // The oldest message on the page anchors the next, older page.
    expect(body.meta.pagination.nextCursor).toBe("m2");
    expect(db.chatRoomMessage.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      }),
    );
    expect(db.chatRoomUserMember.update).not.toHaveBeenCalled();
    expect(db.chatRoomUserMember.updateMany).not.toHaveBeenCalled();
    expect(db.chatRoomReadState.upsert).not.toHaveBeenCalled();
  });

  it("404s for a room that isn't this bot's direct chat", async () => {
    db.chatRoom.findFirst.mockResolvedValue(null);
    const response = await createApp("admin").request(
      `/${BOT_ID}/chats/${ROOM_ID}/messages`,
    );
    expect(response.status).toBe(404);
  });
});
