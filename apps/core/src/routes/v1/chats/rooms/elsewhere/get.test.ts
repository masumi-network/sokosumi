import { beforeEach, describe, expect, it, vi } from "vitest";
import { errorHandler } from "@/helpers/error-handler";
import { OpenAPIHonoWithAuth } from "@/lib/hono";
import type { AuthenticationContext } from "@/middleware/auth";
import { answerRoomUnreadReads } from "@/test-fixtures/chat-room-unread";

import mountGetElsewhereChatRooms from "./get";

vi.mock("@/middleware/auth", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/middleware/auth")>();
  const { stubAuthMiddleware } = await import(
    "@/test-fixtures/auth-middleware"
  );
  return { ...actual, authMiddleware: stubAuthMiddleware };
});

const {
  roomFindManyMock,
  organizationFindManyMock,
  notificationGroupByMock,
  membershipFindManyMock,
  readStateFindManyMock,
  queryRawUnsafeMock,
  prismaTransactionMock,
} = vi.hoisted(() => ({
  roomFindManyMock: vi.fn(),
  organizationFindManyMock: vi.fn(),
  notificationGroupByMock: vi.fn(),
  membershipFindManyMock: vi.fn(),
  readStateFindManyMock: vi.fn(),
  queryRawUnsafeMock: vi.fn(),
  prismaTransactionMock: vi.fn(),
}));

vi.mock("@/lib/db/prisma", () => ({
  default: {
    chatRoom: { findMany: roomFindManyMock },
    organization: { findMany: organizationFindManyMock },
    member: { findMany: vi.fn().mockResolvedValue([]) },
    chatRoomMessage: { groupBy: vi.fn().mockResolvedValue([]) },
    chatRoomPinnedMessage: { groupBy: vi.fn().mockResolvedValue([]) },
    notification: {
      groupBy: notificationGroupByMock,
      findMany: vi.fn().mockResolvedValue([]),
    },
    chatRoomUserMember: { findMany: membershipFindManyMock },
    chatRoomReadState: { findMany: readStateFindManyMock },
    user: { findMany: vi.fn().mockResolvedValue([]) },
    $queryRawUnsafe: queryRawUnsafeMock,
    $transaction: prismaTransactionMock,
  },
}));

const USER_ID = "user_123";
const ACTIVE_ORG = "org_active";
const OTHER_ORG = "org_other";
const FORMER_ORG = "org_former";

type Row = ReturnType<typeof roomRow>;

let nextRoomNumber = 0;

function roomRow(overrides: Record<string, unknown> & { id?: string } = {}) {
  nextRoomNumber += 1;
  const id =
    overrides.id ??
    `550e8400-e29b-41d4-a716-${String(nextRoomNumber).padStart(12, "0")}`;
  return {
    id,
    organizationId: OTHER_ORG as string | null,
    name: `room-${nextRoomNumber}`,
    slug: `room-${nextRoomNumber}`,
    kind: "channel",
    directKey: null,
    groupName: null,
    topic: null,
    discoverability: "public" as string | null,
    createdByUserId: USER_ID,
    createdAt: new Date("2026-01-01T00:00:00.000Z"),
    updatedAt: new Date("2026-01-02T00:00:00.000Z"),
    archivedAt: null as Date | null,
    providerConversationId: null,
    sharedSokoBot: null,
    userMembers: [
      {
        id: `member-${id}`,
        roomId: id,
        userId: USER_ID,
        access: "member",
        starredAt: null,
        mutedAt: null as Date | null,
        createdAt: new Date("2026-01-01T00:00:00.000Z"),
        user: {
          id: USER_ID,
          name: "Ada",
          email: "ada@example.com",
          image: null,
        },
      },
    ],
    coworkerMembers: [] as Array<Record<string, unknown>>,
    sokoBotMembers: [] as Array<Record<string, unknown>>,
    readStates: [],
    ...overrides,
  };
}

const COWORKER_MEMBER = {
  id: "cwm_1",
  roomId: "room",
  coworkerId: "coworker_1",
  createdAt: new Date("2026-01-01T00:00:00.000Z"),
  coworker: {
    id: "coworker_1",
    name: "Coworker",
    slug: "coworker",
    caption: null,
    image: null,
  },
};

const SOKO_BOT_MEMBER = {
  id: "sbm_1",
  roomId: "room",
  sokoBotId: "550e8400-e29b-41d4-a716-446655449999",
  createdAt: new Date("2026-01-01T00:00:00.000Z"),
  sokoBot: {
    id: "550e8400-e29b-41d4-a716-446655449999",
    name: "Soko",
    avatarImageUrl: null,
    avatarSeed: null,
    userId: USER_ID,
    projectId: null,
    sharedRoomId: null,
    user: { name: "Ada" },
  },
};

type Fields = Record<string, unknown>;

/** The Organizations the reader still belongs to, as a room's relation filter sees them. */
function readerOrganizations(row: Fields): Fields[] {
  return row.organizationId === null || row.organizationId === FORMER_ORG
    ? []
    : [{ userId: USER_ID, organizationId: row.organizationId }];
}

type Sql = boolean | null;

function sqlAnd(values: Sql[]): Sql {
  if (values.includes(false)) return false;
  return values.includes(null) ? null : true;
}

function sqlOr(values: Sql[]): Sql {
  if (values.includes(true)) return true;
  return values.includes(null) ? null : false;
}

function sqlNot(value: Sql): Sql {
  return value === null ? null : !value;
}

function list(value: Fields | Fields[]): Fields[] {
  return Array.isArray(value) ? value : [value];
}

/**
 * A `where` answered the way Postgres answers it, nulls included: `NOT (x = y)`
 * over a null column is not true. Only the operators this route's filter uses;
 * anything else throws, so a new operator cannot silently match.
 */
function evaluate(where: Fields, row: Fields): Sql {
  return sqlAnd(
    Object.entries(where).map(([key, condition]): Sql => {
      if (key === "AND") {
        return sqlAnd(
          list(condition as Fields | Fields[]).map((part) =>
            evaluate(part, row),
          ),
        );
      }
      if (key === "OR") {
        return sqlOr(
          (condition as Fields[]).map((part) => evaluate(part, row)),
        );
      }
      if (key === "NOT") {
        return sqlNot(
          sqlAnd(
            list(condition as Fields | Fields[]).map((part) =>
              evaluate(part, row),
            ),
          ),
        );
      }
      if (key === "userMembers") {
        const { some } = condition as { some: Fields };
        return (row.userMembers as Fields[]).some(
          (member) => evaluate(some, member) === true,
        );
      }
      if (key === "coworkerMembers" || key === "sokoBotMembers") {
        return (row[key] as unknown[]).length === 0;
      }
      if (key === "organization") {
        const { some } = (condition as { members: { some: Fields } }).members;
        return readerOrganizations(row).some(
          (member) => evaluate(some, member) === true,
        );
      }
      const value = row[key];
      if (condition === null) return value === null;
      if (typeof condition === "object") {
        const { in: oneOf } = condition as { in?: unknown[] };
        if (!oneOf) throw new Error(`Unhandled filter on ${key}`);
        return value === null ? null : oneOf.includes(value);
      }
      return value === null || value === undefined ? null : value === condition;
    }),
  );
}

interface UnreadFixture {
  roomId: string;
  channel?: number;
  thread?: number;
}

function arrange({
  rooms,
  unread = [],
  mentions = {},
  markedUnread = [],
}: {
  rooms: Row[];
  unread?: UnreadFixture[];
  mentions?: Record<string, number>;
  markedUnread?: string[];
}) {
  roomFindManyMock.mockImplementation(
    async ({
      where,
      orderBy,
    }: {
      where: Record<string, unknown>;
      orderBy?: unknown;
    }) => {
      const matched = rooms.filter((row) => evaluate(where, row) === true);
      return orderBy
        ? matched.sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime())
        : matched;
    },
  );
  answerRoomUnreadReads(
    queryRawUnsafeMock,
    unread.flatMap(({ roomId, channel = 0, thread = 0 }) => [
      ...(channel > 0
        ? [{ roomId, source: "channel", unreadCount: channel }]
        : []),
      ...(thread > 0
        ? [{ roomId, source: "thread", unreadCount: thread }]
        : []),
    ]),
  );
  notificationGroupByMock.mockResolvedValue(
    Object.entries(mentions).map(([referenceId, count]) => ({
      referenceId,
      _count: { _all: count },
    })),
  );
  membershipFindManyMock.mockResolvedValue([]);
  readStateFindManyMock.mockImplementation(
    async ({ select }: { select: Record<string, unknown> }) =>
      "markedUnreadAt" in select
        ? markedUnread.map((roomId) => ({
            roomId,
            markedUnreadAt: new Date("2026-01-03T00:00:00.000Z"),
          }))
        : [],
  );
  organizationFindManyMock.mockResolvedValue([
    { id: OTHER_ORG, name: "Other Org" },
  ]);
}

function createApp(authContext: AuthenticationContext) {
  const app = new OpenAPIHonoWithAuth();
  app.use("*", async (c, next) => {
    c.set("isAuthenticated", true);
    c.set("authContext", authContext);
    return await next();
  });
  mountGetElsewhereChatRooms(app);
  app.onError(errorHandler);
  return app;
}

const reader: AuthenticationContext = {
  actor: "user",
  userId: USER_ID,
  organizationId: ACTIVE_ORG,
  role: "user",
  authenticationMethod: "session",
};

async function listElsewhere(authContext = reader) {
  const response = await createApp(authContext).request("/elsewhere");
  expect(response.status).toBe(200);
  const body = (await response.json()) as {
    data: Array<{
      id: string;
      organizationName: string | null;
      organizationId: string | null;
      unreadCount: number;
      threadUnreadCount?: number;
      unreadMentionCount: number;
    }>;
  };
  return body.data;
}

describe("GET /chats/rooms/elsewhere", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    nextRoomNumber = 0;
    prismaTransactionMock.mockImplementation(() => {
      throw new Error("The read takes no interactive transaction");
    });
  });

  it("lists an unread room of another workspace with its Organization's name", async () => {
    const room = roomRow();
    arrange({ rooms: [room], unread: [{ roomId: room.id, channel: 2 }] });

    const rooms = await listElsewhere();

    expect(rooms.map((row) => row.id)).toEqual([room.id]);
    expect(rooms[0]).toMatchObject({
      organizationId: OTHER_ORG,
      organizationName: "Other Org",
      unreadCount: 2,
    });
  });

  it("answers nothing, without loading rosters, while everything is read", async () => {
    arrange({ rooms: [roomRow()] });

    expect(await listElsewhere()).toEqual([]);
    expect(roomFindManyMock).toHaveBeenCalledTimes(1);
  });

  it("puts rooms naming the reader first, then the newest, with no cap", async () => {
    const rows = Array.from({ length: 7 }, (_, index) =>
      roomRow({ updatedAt: new Date(2026, 0, index + 1) }),
    );
    const [oldest, , second, , , , newest] = rows;
    arrange({
      rooms: rows,
      unread: rows.map((row) => ({ roomId: row.id, channel: 1 })),
      mentions: { [oldest.id]: 1, [second.id]: 2 },
    });

    const rooms = await listElsewhere();

    expect(rooms).toHaveLength(7);
    expect(rooms.slice(0, 3).map((row) => row.id)).toEqual([
      second.id,
      oldest.id,
      newest.id,
    ]);
  });

  it("gives a muted room no row", async () => {
    const muted = roomRow();
    muted.userMembers[0].mutedAt = new Date("2026-01-03T00:00:00.000Z");
    arrange({ rooms: [muted], unread: [{ roomId: muted.id, channel: 1 }] });

    expect(await listElsewhere()).toEqual([]);
  });

  it("gives an archived room no row", async () => {
    const archived = roomRow({
      archivedAt: new Date("2026-01-03T00:00:00.000Z"),
    });
    arrange({
      rooms: [archived],
      unread: [{ roomId: archived.id, channel: 1 }],
    });

    expect(await listElsewhere()).toEqual([]);
  });

  it("gives a room of an Organization the reader left no row", async () => {
    const left = roomRow({ organizationId: FORMER_ORG });
    arrange({ rooms: [left], unread: [{ roomId: left.id, channel: 1 }] });

    expect(await listElsewhere()).toEqual([]);
  });

  // Postgres answers `NOT (discoverability = 'external')` over a null column
  // with null, not true, and the room would silently never get a row.
  it("gives a row to a channel with no discoverability", async () => {
    const channel = roomRow({ discoverability: null });
    arrange({ rooms: [channel], unread: [{ roomId: channel.id, channel: 1 }] });

    expect((await listElsewhere()).map((row) => row.id)).toEqual([channel.id]);
  });

  it("gives no row to what the active workspace already lists", async () => {
    const own = roomRow({ organizationId: ACTIVE_ORG });
    const external = roomRow({ discoverability: "external" });
    const matched = roomRow({
      organizationId: null,
      discoverability: "matched",
    });
    const personalDirect = roomRow({
      organizationId: null,
      kind: "direct",
      discoverability: null,
    });
    const rooms = [own, external, matched, personalDirect];
    arrange({
      rooms,
      unread: rooms.map((row) => ({ roomId: row.id, channel: 1 })),
    });

    expect(await listElsewhere()).toEqual([]);
  });

  it("gives a row to a coworker or Soko Bot Direct of the personal workspace, from an Organization", async () => {
    const coworkerDirect = roomRow({
      organizationId: null,
      kind: "direct",
      discoverability: null,
      coworkerMembers: [COWORKER_MEMBER],
    });
    const sokoBotDirect = roomRow({
      organizationId: null,
      kind: "direct",
      discoverability: null,
      sokoBotMembers: [SOKO_BOT_MEMBER],
    });
    const rooms = [coworkerDirect, sokoBotDirect];
    arrange({
      rooms,
      unread: rooms.map((row) => ({ roomId: row.id, channel: 1 })),
    });

    const listed = await listElsewhere();

    expect(listed.map((row) => row.id).sort()).toEqual(
      rooms.map((row) => row.id).sort(),
    );
    expect(listed[0].organizationName).toBeNull();
  });

  it("gives a row to an Organization's coworker Direct", async () => {
    const coworkerDirect = roomRow({
      kind: "direct",
      discoverability: null,
      coworkerMembers: [COWORKER_MEMBER],
    });
    arrange({
      rooms: [coworkerDirect],
      unread: [{ roomId: coworkerDirect.id, channel: 1 }],
    });

    expect((await listElsewhere()).map((row) => row.id)).toEqual([
      coworkerDirect.id,
    ]);
  });

  it("from the personal workspace, lists Organization rooms and keeps its own Directs out", async () => {
    const orgRoom = roomRow();
    const ownCoworkerDirect = roomRow({
      organizationId: null,
      kind: "direct",
      discoverability: null,
      coworkerMembers: [COWORKER_MEMBER],
    });
    arrange({
      rooms: [orgRoom, ownCoworkerDirect],
      unread: [orgRoom, ownCoworkerDirect].map((row) => ({
        roomId: row.id,
        channel: 1,
      })),
    });

    const rooms = await listElsewhere({
      actor: "user",
      userId: USER_ID,
      organizationId: null,
      role: "user",
      authenticationMethod: "session",
    });

    expect(rooms.map((row) => row.id)).toEqual([orgRoom.id]);
  });

  it("gives a row to a room whose only unread is a Thread reply, with its number", async () => {
    const room = roomRow();
    arrange({ rooms: [room], unread: [{ roomId: room.id, thread: 3 }] });

    const rooms = await listElsewhere();

    expect(rooms[0]).toMatchObject({
      id: room.id,
      unreadCount: 3,
      threadUnreadCount: 3,
    });
  });

  it("keeps a room the reader marked unread", async () => {
    const room = roomRow();
    arrange({ rooms: [room], markedUnread: [room.id] });

    expect((await listElsewhere()).map((row) => row.id)).toEqual([room.id]);
  });

  it("keeps a room whose only unread is a mention", async () => {
    const room = roomRow();
    arrange({ rooms: [room], mentions: { [room.id]: 1 } });

    expect((await listElsewhere())[0]).toMatchObject({
      id: room.id,
      unreadMentionCount: 1,
    });
  });

  it.each<[string, AuthenticationContext]>([
    [
      "coworker",
      {
        actor: "coworker",
        coworkerId: "coworker_1",
        vendorId: "01960001-0001-7001-8001-000000000001",
        context: { userId: USER_ID, organizationId: ACTIVE_ORG },
      },
    ],
    [
      "Soko Bot",
      {
        actor: "sokoBot",
        sokoBotId: "bot_1",
        workspaceId: "workspace_1",
        scope: "personal",
        userId: USER_ID,
        organizationId: ACTIVE_ORG,
      },
    ],
    ["API key", { ...reader, authenticationMethod: "api_key" }],
    ["OAuth", { ...reader, authenticationMethod: "oauth" }],
  ])("refuses %s credentials", async (_name, authContext) => {
    arrange({ rooms: [roomRow()] });

    const response = await createApp(authContext).request("/elsewhere");

    expect(response.status).toBe(403);
    expect(roomFindManyMock).not.toHaveBeenCalled();
  });
});
