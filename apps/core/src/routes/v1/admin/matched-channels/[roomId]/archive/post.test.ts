import { createMiddleware } from "hono/factory";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { errorHandler } from "@/helpers/error-handler";
import { OpenAPIHonoWithAuth } from "@/lib/hono";
import type { AuthenticationContext } from "@/middleware/auth";
import { requireAdminAuthContext } from "@/middleware/auth";

import mountArchiveAdminMatchedChannel from "./post";

const {
  queryRawMock,
  roomUpdateManyMock,
  userMemberFindManyMock,
  prismaTransactionMock,
  publishChatMembershipRevokedToUsersMock,
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
  queryRawMock: vi.fn(),
  roomUpdateManyMock: vi.fn(),
  userMemberFindManyMock: vi.fn(),
  prismaTransactionMock: vi.fn(),
  publishChatMembershipRevokedToUsersMock: vi.fn(),
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

vi.mock("@/lib/ably/publish", () => ({
  publishChatMembershipRevokedToUsers: (...args: unknown[]) =>
    publishChatMembershipRevokedToUsersMock(...args),
}));

vi.mock("@/lib/db/prisma", () => ({
  default: {
    $transaction: (...args: unknown[]) => prismaTransactionMock(...args),
  },
}));

const ROOM_ID = "550e8400-e29b-41d4-a716-446655440000";
const USER_A = "user_a";
const USER_B = "user_b";

const tx = {
  $queryRaw: queryRawMock,
  chatRoom: { updateMany: roomUpdateManyMock },
  chatRoomUserMember: { findMany: userMemberFindManyMock },
};

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
  mountArchiveAdminMatchedChannel(app);
  return app;
}

async function archive() {
  return createApp().request(`http://localhost/${ROOM_ID}/archive`, {
    method: "POST",
  });
}

describe("POST /admin/matched-channels/{roomId}/archive", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    authContextState.current = {
      actor: "user",
      userId: "user_admin",
      organizationId: null,
      role: "admin",
    };
    prismaTransactionMock.mockImplementation(
      async (fn: (client: typeof tx) => Promise<unknown>) => fn(tx),
    );
    queryRawMock.mockResolvedValue([
      {
        id: ROOM_ID,
        organizationId: null,
        kind: "channel",
        discoverability: "matched",
        archivedAt: null,
      },
    ]);
    roomUpdateManyMock.mockResolvedValue({ count: 1 });
    userMemberFindManyMock.mockResolvedValue([
      { userId: USER_A },
      { userId: USER_B },
    ]);
    publishChatMembershipRevokedToUsersMock.mockResolvedValue(undefined);
  });

  it("archives a live matched channel and revokes remaining members", async () => {
    const response = await archive();
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.data.id).toBe(ROOM_ID);
    expect(body.data.archivedAt).toEqual(expect.any(String));
    expect(roomUpdateManyMock).toHaveBeenCalledWith({
      where: { id: ROOM_ID, archivedAt: null },
      data: { archivedAt: expect.any(Date) },
    });
    expect(publishChatMembershipRevokedToUsersMock).toHaveBeenCalledWith(
      ROOM_ID,
      [USER_A, USER_B],
      "removed",
    );
  });

  it("archives an empty matched channel without revoking anyone", async () => {
    userMemberFindManyMock.mockResolvedValue([]);

    const response = await archive();
    expect(response.status).toBe(200);
    expect(publishChatMembershipRevokedToUsersMock).not.toHaveBeenCalled();
  });

  it("404s when the room is not a live org-less matched channel", async () => {
    queryRawMock.mockResolvedValue([
      {
        id: ROOM_ID,
        organizationId: "org_1",
        kind: "channel",
        discoverability: "private",
        archivedAt: null,
      },
    ]);

    expect((await archive()).status).toBe(404);
    expect(roomUpdateManyMock).not.toHaveBeenCalled();
  });

  it("404s when the room is already archived", async () => {
    queryRawMock.mockResolvedValue([
      {
        id: ROOM_ID,
        organizationId: null,
        kind: "channel",
        discoverability: "matched",
        archivedAt: new Date("2026-02-01T00:00:00.000Z"),
      },
    ]);

    expect((await archive()).status).toBe(404);
    expect(roomUpdateManyMock).not.toHaveBeenCalled();
  });
});
