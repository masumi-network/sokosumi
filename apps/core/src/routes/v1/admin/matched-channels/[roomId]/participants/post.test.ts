import { createMiddleware } from "hono/factory";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { errorHandler } from "@/helpers/error-handler";
import { OpenAPIHonoWithAuth } from "@/lib/hono";
import type { AuthenticationContext } from "@/middleware/auth";
import { requireAdminAuthContext } from "@/middleware/auth";

import mountAddAdminMatchedChannelParticipant from "./post";

const {
  ensureMatchedChannelParticipantMock,
  prismaTransactionMock,
  publishChatRoomMessageRealtimeMock,
  authContextState,
} = vi.hoisted(() => ({
  authContextState: {
    current: {
      actor: "user",
      userId: "user_admin",
      organizationId: null,
      role: "admin",
    } as AuthenticationContext,
  },
  ensureMatchedChannelParticipantMock: vi.fn(),
  prismaTransactionMock: vi.fn(),
  publishChatRoomMessageRealtimeMock: vi.fn(),
}));

vi.mock("@/middleware/auth", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/middleware/auth")>();
  return {
    ...actual,
    authMiddleware: async (
      c: {
        json: (body: unknown, status: number) => unknown;
        set: (key: string, value: unknown) => void;
      },
      next: () => Promise<unknown>,
    ) => {
      if (!authContextState.current) {
        return c.json({ error: "Unauthorized", message: "Unauthorized" }, 401);
      }
      c.set("isAuthenticated", true);
      c.set("authContext", authContextState.current);
      return await next();
    },
  };
});

vi.mock("@/helpers/chat-room-matched-membership.js", () => ({
  ensureMatchedChannelParticipant: (...args: unknown[]) =>
    ensureMatchedChannelParticipantMock(...args),
}));

vi.mock("@/helpers/chat-room-message-realtime.js", () => ({
  publishChatRoomMessageRealtime: (...args: unknown[]) =>
    publishChatRoomMessageRealtimeMock(...args),
}));

vi.mock("@/lib/db/prisma", () => ({
  default: {
    $transaction: (...args: unknown[]) => prismaTransactionMock(...args),
  },
}));

const ROOM_ID = "550e8400-e29b-41d4-a716-446655440000";

function createApp() {
  const app = new OpenAPIHonoWithAuth();
  app.use(
    "*",
    createMiddleware(async (c, next) => {
      requireAdminAuthContext(c.var.authContext);
      await next();
    }),
  );
  app.onError(errorHandler);
  mountAddAdminMatchedChannelParticipant(app);
  return app;
}

async function post(userId = "user_1") {
  return createApp().request(`http://localhost/${ROOM_ID}/participants`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ userId }),
  });
}

describe("POST /admin/matched-channels/{roomId}/participants", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    authContextState.current = {
      actor: "user",
      userId: "user_admin",
      organizationId: null,
      role: "admin",
    };
    prismaTransactionMock.mockImplementation(
      async (fn: (tx: unknown) => Promise<unknown>) => fn({}),
    );
    ensureMatchedChannelParticipantMock.mockResolvedValue({
      result: {
        userId: "user_1",
        roomId: ROOM_ID,
        roomName: "Partners",
        access: "member",
        outcome: "joined",
      },
      statusMessages: [{ id: "msg_joined" }],
    });
  });

  it("ensures member and publishes joined status when newly added", async () => {
    const response = await post();
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.data).toEqual({
      userId: "user_1",
      roomId: ROOM_ID,
      access: "member",
      outcome: "joined",
    });
    expect(ensureMatchedChannelParticipantMock).toHaveBeenCalledWith(
      expect.anything(),
      { userId: "user_1", roomId: ROOM_ID },
    );
    expect(publishChatRoomMessageRealtimeMock).toHaveBeenCalledWith(
      { id: "msg_joined" },
      "create",
    );
  });

  it("does not publish when already a member", async () => {
    ensureMatchedChannelParticipantMock.mockResolvedValue({
      result: {
        userId: "user_1",
        roomId: ROOM_ID,
        roomName: "Partners",
        access: "member",
        outcome: "already_member",
      },
      statusMessages: [],
    });

    const response = await post();
    expect(response.status).toBe(200);
    expect((await response.json()).data.outcome).toBe("already_member");
    expect(publishChatRoomMessageRealtimeMock).not.toHaveBeenCalled();
  });
});
