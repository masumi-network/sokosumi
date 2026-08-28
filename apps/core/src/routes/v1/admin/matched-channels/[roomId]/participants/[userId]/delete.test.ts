import { createMiddleware } from "hono/factory";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { errorHandler } from "@/helpers/error-handler";
import { OpenAPIHonoWithAuth } from "@/lib/hono";
import type { AuthenticationContext } from "@/middleware/auth";
import { requireAdminAuthContext } from "@/middleware/auth";

import mountRemoveAdminMatchedChannelParticipant from "./delete";

const {
  removeMatchedChannelParticipantMock,
  prismaTransactionMock,
  publishChatRoomMessageRealtimeMock,
  publishChatMembershipRevokedMock,
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
  removeMatchedChannelParticipantMock: vi.fn(),
  prismaTransactionMock: vi.fn(),
  publishChatRoomMessageRealtimeMock: vi.fn(),
  publishChatMembershipRevokedMock: vi.fn(),
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
  removeMatchedChannelParticipant: (...args: unknown[]) =>
    removeMatchedChannelParticipantMock(...args),
}));

vi.mock("@/helpers/chat-room-message-realtime.js", () => ({
  publishChatRoomMessageRealtime: (...args: unknown[]) =>
    publishChatRoomMessageRealtimeMock(...args),
}));

vi.mock("@/lib/ably/publish", () => ({
  publishChatMembershipRevoked: (...args: unknown[]) =>
    publishChatMembershipRevokedMock(...args),
}));

vi.mock("@/lib/db/prisma", () => ({
  default: {
    $transaction: (...args: unknown[]) => prismaTransactionMock(...args),
  },
}));

const ROOM_ID = "550e8400-e29b-41d4-a716-446655440000";
const USER_ID = "user_1";

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
  mountRemoveAdminMatchedChannelParticipant(app);
  return app;
}

async function del(userId = USER_ID) {
  return createApp().request(
    `http://localhost/${ROOM_ID}/participants/${userId}`,
    { method: "DELETE" },
  );
}

describe("DELETE /admin/matched-channels/{roomId}/participants/{userId}", () => {
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
    removeMatchedChannelParticipantMock.mockResolvedValue({
      result: {
        userId: USER_ID,
        roomId: ROOM_ID,
        roomName: "Partners",
        outcome: "removed",
      },
      statusMessages: [{ id: "msg_left" }],
    });
    publishChatRoomMessageRealtimeMock.mockResolvedValue(undefined);
    publishChatMembershipRevokedMock.mockResolvedValue(undefined);
  });

  it("removes member and publishes left status plus revoke", async () => {
    const response = await del();
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.data).toEqual({
      userId: USER_ID,
      roomId: ROOM_ID,
      outcome: "removed",
    });
    expect(removeMatchedChannelParticipantMock).toHaveBeenCalledWith(
      expect.anything(),
      { userId: USER_ID, roomId: ROOM_ID },
    );
    expect(publishChatRoomMessageRealtimeMock).toHaveBeenCalledWith(
      { id: "msg_left" },
      "create",
    );
    expect(publishChatMembershipRevokedMock).toHaveBeenCalledWith({
      userId: USER_ID,
      roomId: ROOM_ID,
      reason: "removed",
    });
  });
});
