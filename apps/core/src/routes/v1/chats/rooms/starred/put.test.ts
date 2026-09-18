import { beforeEach, describe, expect, it, vi } from "vitest";

import { errorHandler } from "@/helpers/error-handler";
import { OpenAPIHonoWithAuth } from "@/lib/hono";
import type { AuthVariables } from "@/middleware/auth";

import mountPutStarredChatRooms from "./put";

vi.mock("@/middleware/auth", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/middleware/auth")>();
  const { stubAuthMiddleware } = await import(
    "@/test-fixtures/auth-middleware"
  );
  return { ...actual, authMiddleware: stubAuthMiddleware };
});

const { membershipFindManyMock, membershipUpdateMock, prismaTransactionMock } =
  vi.hoisted(() => ({
    membershipFindManyMock: vi.fn(),
    membershipUpdateMock: vi.fn(),
    prismaTransactionMock: vi.fn(),
  }));

vi.mock("@/lib/db/prisma", () => ({
  default: { $transaction: prismaTransactionMock },
}));

const USER_ID = "user_123";
const ROOM_A = "550e8400-e29b-41d4-a716-44665544000a";
const ROOM_B = "550e8400-e29b-41d4-a716-44665544000b";
const ROOM_C = "550e8400-e29b-41d4-a716-44665544000c";
const ROOM_NOT_STARRED = "550e8400-e29b-41d4-a716-44665544000d";

const tx = {
  chatRoomUserMember: {
    findMany: membershipFindManyMock,
    updateMany: membershipUpdateMock,
  },
};

const userAuthContext: AuthVariables["authContext"] = {
  actor: "user",
  userId: USER_ID,
  organizationId: "org_1",
  role: "user",
};

function createApp(authContext: AuthVariables["authContext"]) {
  const app = new OpenAPIHonoWithAuth();
  app.use("*", async (c, next) => {
    c.set("requestId", "req_reorder_starred");
    c.set("isAuthenticated", true);
    c.set("authContext", authContext);
    return await next();
  });
  app.onError(errorHandler);
  mountPutStarredChatRooms(app);
  return app;
}

function put(body: unknown) {
  return createApp(userAuthContext).request("/starred", {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

function writtenOrder(): string[] {
  return membershipUpdateMock.mock.calls
    .map(([args]) => ({
      roomId: args.where.roomId as string,
      at: (args.data.starredAt as Date).getTime(),
    }))
    .sort((a, b) => a.at - b.at)
    .map((row) => row.roomId);
}

beforeEach(() => {
  vi.clearAllMocks();
  prismaTransactionMock.mockImplementation(async (cb) => cb(tx));
  // Current order: A, B, C (oldest starredAt first).
  membershipFindManyMock.mockResolvedValue([
    { roomId: ROOM_A, starredAt: new Date("2026-01-01T00:00:00.000Z") },
    { roomId: ROOM_B, starredAt: new Date("2026-01-02T00:00:00.000Z") },
    { roomId: ROOM_C, starredAt: new Date("2026-01-03T00:00:00.000Z") },
  ]);
  membershipUpdateMock.mockResolvedValue({});
});

describe("PUT /chats/rooms/starred", () => {
  it("rewrites starredAt so rooms sort in the requested order", async () => {
    const response = await put({ roomIds: [ROOM_C, ROOM_A, ROOM_B] });

    expect(response.status).toBe(200);
    expect(membershipFindManyMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          userId: USER_ID,
          starredAt: { not: null },
          room: expect.objectContaining({
            archivedAt: null,
            OR: expect.arrayContaining([{ organizationId: "org_1" }]),
          }),
        },
      }),
    );
    expect(writtenOrder()).toEqual([ROOM_C, ROOM_A, ROOM_B]);

    const body = await response.json();
    expect(body.data.map((row: { roomId: string }) => row.roomId)).toEqual([
      ROOM_C,
      ROOM_A,
      ROOM_B,
    ]);
    const times = body.data.map((row: { starredAt: string }) =>
      new Date(row.starredAt).getTime(),
    );
    expect(new Set(times).size).toBe(3);
    expect(Math.max(...times)).toBeLessThanOrEqual(Date.now());
  });

  it("ignores unstarred ids and keeps omitted starred rooms after the listed ones", async () => {
    const response = await put({
      roomIds: [ROOM_NOT_STARRED, ROOM_C, ROOM_C],
    });

    expect(response.status).toBe(200);
    expect(writtenOrder()).toEqual([ROOM_C, ROOM_A, ROOM_B]);
    expect(membershipUpdateMock).toHaveBeenCalledTimes(3);
  });

  it("only ever writes to rows that are still starred", async () => {
    await put({ roomIds: [ROOM_C, ROOM_A, ROOM_B] });

    for (const [args] of membershipUpdateMock.mock.calls) {
      expect(args.where).toEqual({
        roomId: expect.any(String),
        userId: USER_ID,
        starredAt: { not: null },
      });
    }
  });

  it("writes nothing when the order is already the one asked for", async () => {
    const response = await put({ roomIds: [ROOM_A, ROOM_B] });

    expect(response.status).toBe(200);
    expect(membershipUpdateMock).not.toHaveBeenCalled();
    const body = await response.json();
    expect(body.data.map((row: { roomId: string }) => row.roomId)).toEqual([
      ROOM_A,
      ROOM_B,
      ROOM_C,
    ]);
  });

  it("writes nothing when the caller has no starred rooms", async () => {
    membershipFindManyMock.mockResolvedValue([]);

    const response = await put({ roomIds: [ROOM_A] });

    expect(response.status).toBe(200);
    expect((await response.json()).data).toEqual([]);
    expect(membershipUpdateMock).not.toHaveBeenCalled();
  });

  it("rejects a malformed body", async () => {
    const response = await put({ roomIds: ["not-a-uuid"] });

    expect(response.status).toBe(422);
    expect(prismaTransactionMock).not.toHaveBeenCalled();
  });

  it("does not load starred rooms from another workspace", async () => {
    await put({ roomIds: [ROOM_C, ROOM_A, ROOM_B] });

    const where = membershipFindManyMock.mock.calls[0]?.[0]?.where as {
      room: { OR: unknown[] };
    };
    expect(where.room.OR).toContainEqual({ organizationId: "org_1" });
    expect(where.room.OR).not.toContainEqual({
      organizationId: "org_other",
    });
  });

  it("scopes personal workspace to org-less rooms, not an org", async () => {
    await createApp({
      ...userAuthContext,
      organizationId: null,
    }).request("/starred", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ roomIds: [ROOM_A, ROOM_B] }),
    });

    const where = membershipFindManyMock.mock.calls[0]?.[0]?.where as {
      room: { OR: unknown[] };
    };
    expect(where.room.OR).toContainEqual({
      organizationId: null,
      kind: "direct",
    });
    expect(where.room.OR).not.toContainEqual({ organizationId: "org_1" });
  });

  it("rejects a non-user actor", async () => {
    const response = await createApp({
      actor: "coworker",
      coworkerId: "cw_1",
    } as AuthVariables["authContext"]).request("/starred", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ roomIds: [] }),
    });

    expect(response.status).toBeGreaterThanOrEqual(401);
    expect(prismaTransactionMock).not.toHaveBeenCalled();
  });
});
