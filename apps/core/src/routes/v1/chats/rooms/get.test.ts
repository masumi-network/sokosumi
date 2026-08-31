import { MemberRole } from "@sokosumi/database";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { OpenAPIHonoWithAuth } from "@/lib/hono";

import mountGetChatRooms from "./get";

vi.mock("@/middleware/auth", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/middleware/auth")>();
  const { stubAuthMiddleware } = await import(
    "@/test-fixtures/auth-middleware"
  );
  return { ...actual, authMiddleware: stubAuthMiddleware };
});

const {
  roomFindManyMock,
  roomCountMock,
  organizationFindUniqueMock,
  organizationFindManyMock,
  memberFindUniqueMock,
  memberFindManyMock,
  messageGroupByMock,
  pinGroupByMock,
  notificationGroupByMock,
  membershipFindManyMock,
  readStateFindManyMock,
  queryRawUnsafeMock,
  prismaTransactionMock,
} = vi.hoisted(() => ({
  roomFindManyMock: vi.fn(),
  roomCountMock: vi.fn(),
  organizationFindUniqueMock: vi.fn(),
  organizationFindManyMock: vi.fn(),
  memberFindUniqueMock: vi.fn(),
  memberFindManyMock: vi.fn(),
  messageGroupByMock: vi.fn(),
  pinGroupByMock: vi.fn(),
  notificationGroupByMock: vi.fn(),
  membershipFindManyMock: vi.fn(),
  readStateFindManyMock: vi.fn(),
  queryRawUnsafeMock: vi.fn(),
  prismaTransactionMock: vi.fn(),
}));

vi.mock("@/lib/db/prisma", () => ({
  default: {
    chatRoom: {
      findMany: roomFindManyMock,
      count: roomCountMock,
    },
    organization: {
      findUnique: organizationFindUniqueMock,
      findMany: organizationFindManyMock,
    },
    member: {
      findUnique: memberFindUniqueMock,
      findMany: memberFindManyMock,
    },
    chatRoomMessage: {
      groupBy: messageGroupByMock,
    },
    chatRoomPinnedMessage: {
      groupBy: pinGroupByMock,
    },
    notification: {
      groupBy: notificationGroupByMock,
    },
    chatRoomUserMember: {
      findMany: membershipFindManyMock,
    },
    chatRoomReadState: {
      findMany: readStateFindManyMock,
    },
    $queryRawUnsafe: queryRawUnsafeMock,
    $transaction: prismaTransactionMock,
  },
}));

const USER_ID = "user_123";
const PEER_USER_ID = "user_456";
const ORG_ID = "org_1";
const HOST_ORG_ID = "org_host";
const GUEST_ROOM_ID = "550e8400-e29b-41d4-a716-446655440099";
const PERSONAL_DIRECT_ID = "550e8400-e29b-41d4-a716-446655440088";

function createApp(organizationId: string | null) {
  const app = new OpenAPIHonoWithAuth();
  app.use("*", async (c, next) => {
    c.set("isAuthenticated", true);
    c.set("authContext", {
      actor: "user",
      userId: USER_ID,
      organizationId,
      role: "user",
    });
    return await next();
  });
  mountGetChatRooms(app);
  return app;
}

function guestRoomRow() {
  return {
    id: GUEST_ROOM_ID,
    organizationId: HOST_ORG_ID,
    name: "External Client",
    slug: "external-client",
    kind: "channel",
    directKey: null,
    topic: null,
    discoverability: "external",
    createdByUserId: "user_host",
    createdAt: new Date("2026-01-01T00:00:00.000Z"),
    updatedAt: new Date("2026-01-02T00:00:00.000Z"),
    archivedAt: null,
    providerConversationId: null,
    userMembers: [
      {
        id: "cum_guest",
        roomId: GUEST_ROOM_ID,
        userId: USER_ID,
        access: "guest",
        starredAt: null,
        mutedAt: null,
        createdAt: new Date("2026-01-01T00:00:00.000Z"),
        user: {
          id: USER_ID,
          name: "Ada",
          email: "ada@example.com",
          image: null,
          sessions: [],
        },
      },
    ],
    coworkerMembers: [],
  };
}

function personalDirectRow() {
  return {
    id: PERSONAL_DIRECT_ID,
    organizationId: null,
    name: "Bob",
    slug: "bob",
    kind: "direct",
    directKey: `${USER_ID}:${PEER_USER_ID}`,
    topic: null,
    discoverability: null,
    createdByUserId: USER_ID,
    createdAt: new Date("2026-01-01T00:00:00.000Z"),
    updatedAt: new Date("2026-01-02T00:00:00.000Z"),
    archivedAt: null,
    providerConversationId: null,
    userMembers: [
      {
        id: "cum_self",
        roomId: PERSONAL_DIRECT_ID,
        userId: USER_ID,
        access: "member",
        starredAt: null,
        mutedAt: null,
        createdAt: new Date("2026-01-01T00:00:00.000Z"),
        user: {
          id: USER_ID,
          name: "Ada",
          email: "ada@example.com",
          image: null,
          sessions: [],
        },
      },
      {
        id: "cum_peer",
        roomId: PERSONAL_DIRECT_ID,
        userId: PEER_USER_ID,
        access: "member",
        starredAt: null,
        mutedAt: null,
        createdAt: new Date("2026-01-01T00:00:00.000Z"),
        user: {
          id: PEER_USER_ID,
          name: "Bob",
          email: "bob@example.com",
          image: null,
          sessions: [],
        },
      },
    ],
    coworkerMembers: [],
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  organizationFindUniqueMock.mockResolvedValue({ id: ORG_ID });
  organizationFindManyMock.mockResolvedValue([]);
  memberFindUniqueMock.mockResolvedValue({ role: MemberRole.MEMBER });
  memberFindManyMock.mockResolvedValue([]);
  roomFindManyMock.mockResolvedValue([]);
  roomCountMock.mockResolvedValue(0);
  messageGroupByMock.mockResolvedValue([]);
  pinGroupByMock.mockResolvedValue([]);
  notificationGroupByMock.mockResolvedValue([]);
  membershipFindManyMock.mockResolvedValue([]);
  readStateFindManyMock.mockResolvedValue([]);
  queryRawUnsafeMock.mockResolvedValue([]);
});

describe("GET /chats/rooms", () => {
  it("lists rooms without opening an interactive transaction", async () => {
    const response = await createApp(ORG_ID).request("/");

    expect(response.status).toBe(200);
    expect(prismaTransactionMock).not.toHaveBeenCalled();
    expect(roomFindManyMock).toHaveBeenCalledOnce();
    expect(roomCountMock).toHaveBeenCalledOnce();
  });

  it("returns an empty archived list for a plain member (no creator filter)", async () => {
    const response = await createApp(ORG_ID).request("/?status=archived");

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.data).toEqual([]);
    expect(prismaTransactionMock).not.toHaveBeenCalled();
    expect(roomFindManyMock).not.toHaveBeenCalled();
    expect(roomCountMock).not.toHaveBeenCalled();
  });

  it.each([
    ["admin", MemberRole.ADMIN],
    ["owner", MemberRole.OWNER],
  ])(
    "lists all archived membership rooms for an organization %s",
    async (_label, role) => {
      memberFindUniqueMock.mockResolvedValue({ role });

      const response = await createApp(ORG_ID).request("/?status=archived");

      expect(response.status).toBe(200);
      expect(prismaTransactionMock).not.toHaveBeenCalled();
      const where = roomFindManyMock.mock.calls[0]?.[0]?.where as Record<
        string,
        unknown
      >;
      expect(where).toMatchObject({
        archivedAt: { not: null },
        organizationId: ORG_ID,
        userMembers: { some: { userId: USER_ID } },
      });
      expect(where).not.toHaveProperty("createdByUserId");
    },
  );

  it("returns an empty page for archived status with no active organization", async () => {
    const response = await createApp(null).request("/?status=archived");

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.data).toEqual([]);
    expect(prismaTransactionMock).not.toHaveBeenCalled();
    expect(roomFindManyMock).not.toHaveBeenCalled();
    expect(organizationFindUniqueMock).not.toHaveBeenCalled();
  });

  it("defaults to active rooms (archivedAt null) without creator filter", async () => {
    const response = await createApp(ORG_ID).request("/");

    expect(response.status).toBe(200);
    expect(prismaTransactionMock).not.toHaveBeenCalled();
    const where = roomFindManyMock.mock.calls[0]?.[0]?.where as Record<
      string,
      unknown
    >;
    expect(where).toMatchObject({
      archivedAt: null,
      userMembers: { some: { userId: USER_ID } },
      OR: [
        { organizationId: ORG_ID },
        { userMembers: { some: { userId: USER_ID, access: "guest" } } },
        {
          organizationId: null,
          kind: "direct",
          coworkerMembers: { none: {} },
        },
        {
          organizationId: null,
          kind: "channel",
          discoverability: "matched",
        },
      ],
    });
    expect(where).not.toHaveProperty("createdByUserId");
    expect(where).not.toHaveProperty("organizationId");
  });

  it("includes guest rooms when another org is active", async () => {
    roomFindManyMock.mockResolvedValue([guestRoomRow()]);
    roomCountMock.mockResolvedValue(1);
    organizationFindManyMock.mockResolvedValue([
      { id: HOST_ORG_ID, name: "Acme Host" },
    ]);

    const response = await createApp(ORG_ID).request("/");

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.data).toHaveLength(1);
    expect(body.data[0]).toMatchObject({
      id: GUEST_ROOM_ID,
      organizationId: HOST_ORG_ID,
      organizationName: "Acme Host",
      myAccess: "guest",
      discoverability: "external",
    });
    expect(organizationFindManyMock).toHaveBeenCalledWith({
      where: { id: { in: [HOST_ORG_ID] } },
      select: { id: true, name: true },
    });
  });

  it("lists personal directs and guest rooms with no active organization", async () => {
    const response = await createApp(null).request("/");

    expect(response.status).toBe(200);
    const where = roomFindManyMock.mock.calls[0]?.[0]?.where as Record<
      string,
      unknown
    >;
    expect(where).toMatchObject({
      archivedAt: null,
      userMembers: { some: { userId: USER_ID } },
      OR: [
        { organizationId: null, kind: "direct" },
        { userMembers: { some: { userId: USER_ID, access: "guest" } } },
        {
          organizationId: null,
          kind: "channel",
          discoverability: "matched",
        },
      ],
    });
  });

  it("sets peerInActiveOrganization true when the other human is an org Member", async () => {
    roomFindManyMock.mockResolvedValue([personalDirectRow()]);
    roomCountMock.mockResolvedValue(1);
    memberFindManyMock.mockResolvedValue([{ userId: PEER_USER_ID }]);

    const response = await createApp(ORG_ID).request("/");

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.data[0]).toMatchObject({
      id: PERSONAL_DIRECT_ID,
      organizationId: null,
      kind: "direct",
      peerInActiveOrganization: true,
    });
    expect(memberFindManyMock).toHaveBeenCalledWith({
      where: {
        organizationId: ORG_ID,
        userId: { in: [PEER_USER_ID] },
      },
      select: { userId: true },
    });
  });

  it("sets peerInActiveOrganization false when the other human is not an org Member", async () => {
    roomFindManyMock.mockResolvedValue([personalDirectRow()]);
    roomCountMock.mockResolvedValue(1);
    memberFindManyMock.mockResolvedValue([]);

    const response = await createApp(ORG_ID).request("/");

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.data[0]).toMatchObject({
      id: PERSONAL_DIRECT_ID,
      peerInActiveOrganization: false,
    });
  });

  it("lists guest channels with kind=channel and no active organization", async () => {
    const response = await createApp(null).request("/?kind=channel");

    expect(response.status).toBe(200);
    expect(roomFindManyMock).toHaveBeenCalledOnce();
    const where = roomFindManyMock.mock.calls[0]?.[0]?.where as Record<
      string,
      unknown
    >;
    expect(where).toMatchObject({
      archivedAt: null,
      kind: "channel",
      userMembers: { some: { userId: USER_ID } },
      OR: [
        { organizationId: null, kind: "direct" },
        { userMembers: { some: { userId: USER_ID, access: "guest" } } },
        {
          organizationId: null,
          kind: "channel",
          discoverability: "matched",
        },
      ],
    });
  });
});
