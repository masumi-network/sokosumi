import { beforeEach, describe, expect, it, vi } from "vitest";

import { errorHandler } from "@/helpers/error-handler";
import { OpenAPIHonoWithAuth } from "@/lib/hono";
import type { AuthVariables } from "@/middleware/auth";

import mountGetRecentSokoBotChats, { RECENT_SOKO_BOT_ROOM_LIMIT } from "./get";

vi.mock("@/middleware/auth", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/middleware/auth")>();
  const { stubAuthMiddleware } = await import(
    "@/test-fixtures/auth-middleware"
  );
  return { ...actual, authMiddleware: stubAuthMiddleware };
});

const { groupByMock, findManyMock } = vi.hoisted(() => ({
  groupByMock: vi.fn(),
  findManyMock: vi.fn(),
}));

vi.mock("@/lib/db/prisma", () => ({
  default: {
    chatRoomMessage: { groupBy: groupByMock, findMany: findManyMock },
  },
}));

const USER_ID = "user_123";
const ROOM_A = "550e8400-e29b-41d4-a716-4466554400aa";
const ROOM_B = "550e8400-e29b-41d4-a716-4466554400bb";
const PARENT = "550e8400-e29b-41d4-a716-4466554401aa";
const REPLY = "550e8400-e29b-41d4-a716-4466554402aa";
const OLDER_TWIN = "550e8400-e29b-41d4-a716-4466554402ab";
const TOP = "550e8400-e29b-41d4-a716-4466554402bb";

function createApp(organizationId: string | null) {
  const app = new OpenAPIHonoWithAuth();
  app.use("*", async (c, next) => {
    c.set("requestId", "req_recent_soko_bot_chats");
    c.set("isAuthenticated", true);
    c.set("authContext", {
      actor: "user",
      userId: USER_ID,
      organizationId,
      role: "user",
    } satisfies AuthVariables["authContext"]);
    return await next();
  });
  app.onError(errorHandler);
  mountGetRecentSokoBotChats(app);
  return app;
}

describe("GET /chats/recent", () => {
  beforeEach(() => {
    groupByMock.mockReset();
    findManyMock.mockReset();
  });

  it("groups only the reader's own messages, replies included, in this workspace's Soko Bot rooms before capping", async () => {
    groupByMock.mockResolvedValue([]);
    const response = await createApp("org_1").request("http://localhost/");
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ data: [] });
    const query = groupByMock.mock.calls[0]?.[0];
    expect(query).toMatchObject({
      by: ["roomId"],
      where: {
        senderUserId: USER_ID,
        deletedAt: null,
        room: {
          archivedAt: null,
          organizationId: "org_1",
          userMembers: { some: { userId: USER_ID } },
          sokoBotMembers: { some: {} },
        },
      },
      orderBy: { _max: { createdAt: "desc" } },
      take: RECENT_SOKO_BOT_ROOM_LIMIT,
    });
    // No Thread filter: a reply counts as much as a top-level message.
    expect(query.where).not.toHaveProperty("parentMessageId");
    expect(
      Date.now() - query.where.createdAt.gte.getTime(),
    ).toBeLessThanOrEqual(24 * 60 * 60 * 1000 + 1000);
    expect(findManyMock).not.toHaveBeenCalled();
  });

  it("returns one row per room in group order, a reply with its parent", async () => {
    const at = new Date("2026-11-09T10:00:00Z");
    groupByMock.mockResolvedValue([
      { roomId: ROOM_A, _max: { createdAt: at } },
      { roomId: ROOM_B, _max: { createdAt: new Date("2026-11-09T09:00:00Z") } },
    ]);
    findManyMock.mockResolvedValue([
      {
        id: REPLY,
        roomId: ROOM_A,
        parentMessageId: PARENT,
        content: "today's answer",
        createdAt: at,
      },
      {
        id: OLDER_TWIN,
        roomId: ROOM_A,
        parentMessageId: null,
        content: "same millisecond",
        createdAt: at,
      },
      {
        id: TOP,
        roomId: ROOM_B,
        parentMessageId: null,
        content: "plan posts",
        createdAt: new Date("2026-11-09T09:00:00Z"),
      },
    ]);

    const response = await createApp(null).request("http://localhost/");
    const body = await response.json();
    expect(response.status).toBe(200);
    expect(groupByMock.mock.calls[0]?.[0].where.room.organizationId).toBe(null);
    expect(
      body.data.map(
        (row: {
          roomId: string;
          messageId: string;
          parentMessageId: string;
        }) => [row.roomId, row.messageId, row.parentMessageId],
      ),
    ).toEqual([
      [ROOM_A, REPLY, PARENT],
      [ROOM_B, TOP, null],
    ]);
  });
});
