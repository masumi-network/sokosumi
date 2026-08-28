import { beforeEach, describe, expect, it, vi } from "vitest";

import { OpenAPIHonoWithAuth } from "@/lib/hono";

import mountAcceptInviteLink from "./post";

const {
  authContextState,
  getInviteLinkByTokenMock,
  tryConsumeInviteLinkMock,
  userFindUniqueMock,
  roomFindUniqueMock,
  memberFindUniqueMock,
  roomUserMemberFindUniqueMock,
  roomUserMemberCreateMock,
  readStateCreateManyMock,
  queryRawMock,
  prismaTransactionMock,
  recordChannelMembershipStatusMock,
  publishChatRoomMessageRealtimeMock,
} = vi.hoisted(() => ({
  authContextState: {
    current: {
      actor: "user",
      userId: "user_outsider",
      organizationId: null,
      role: "user",
    } as
      | {
          actor: "user";
          userId: string;
          organizationId: string | null;
          role: string;
        }
      | {
          actor: "coworker";
          coworkerId: string;
          vendorId?: string;
          context?: { userId: string; organizationId: string | null };
        }
      | null,
  },
  getInviteLinkByTokenMock: vi.fn(),
  tryConsumeInviteLinkMock: vi.fn(),
  userFindUniqueMock: vi.fn(),
  roomFindUniqueMock: vi.fn(),
  memberFindUniqueMock: vi.fn(),
  roomUserMemberFindUniqueMock: vi.fn(),
  roomUserMemberCreateMock: vi.fn(),
  readStateCreateManyMock: vi.fn(),
  queryRawMock: vi.fn(),
  prismaTransactionMock: vi.fn(),
  recordChannelMembershipStatusMock: vi.fn(),
  publishChatRoomMessageRealtimeMock: vi.fn(),
}));

vi.mock("@/middleware/auth", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/middleware/auth")>();
  return {
    ...actual,
    authMiddleware: async (
      c: {
        json: (body: unknown, status: number) => unknown;
        req: { path: string; method: string };
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

vi.mock("@sokosumi/database/repositories", () => ({
  chatRoomGuestInviteLinkRepository: {
    getInviteLinkByToken: (...args: unknown[]) =>
      getInviteLinkByTokenMock(...args),
    tryConsumeInviteLink: (...args: unknown[]) =>
      tryConsumeInviteLinkMock(...args),
  },
}));

const tx = {
  user: { findUnique: userFindUniqueMock },
  chatRoom: { findUnique: roomFindUniqueMock },
  member: { findUnique: memberFindUniqueMock },
  chatRoomUserMember: {
    findUnique: roomUserMemberFindUniqueMock,
    create: roomUserMemberCreateMock,
  },
  chatRoomReadState: { createMany: readStateCreateManyMock },
  $queryRaw: queryRawMock,
};

vi.mock("@/lib/db/prisma", () => ({
  default: {
    $transaction: (...args: unknown[]) => prismaTransactionMock(...args),
  },
}));

vi.mock("@/routes/v1/chats/rooms/membership-status", () => ({
  recordChannelMembershipStatus: (...args: unknown[]) =>
    recordChannelMembershipStatusMock(...args),
}));

vi.mock("@/helpers/chat-room-message-realtime", () => ({
  publishChatRoomMessageRealtime: (...args: unknown[]) =>
    publishChatRoomMessageRealtimeMock(...args),
}));

const ROOM_ID = "550e8400-e29b-41d4-a716-446655440000";
const LINK_ID = "550e8400-e29b-41d4-a716-446655440099";
const ORG_ID = "org_1";
const NOW = Date.now();

function liveLink(overrides: Record<string, unknown> = {}) {
  return {
    id: LINK_ID,
    token: "tok_live",
    roomId: ROOM_ID,
    createdByUserId: "host_1",
    createdAt: new Date(NOW - 1000),
    expiresAt: new Date(NOW + 7 * 24 * 60 * 60 * 1000),
    revokedAt: null,
    maxUses: null,
    useCount: 0,
    ...overrides,
  };
}

function externalRoom() {
  return {
    id: ROOM_ID,
    name: "External Channel",
    kind: "channel",
    discoverability: "external",
    archivedAt: null,
    organizationId: ORG_ID,
  };
}

function createApp() {
  const app = new OpenAPIHonoWithAuth();
  mountAcceptInviteLink(app);
  return app;
}

async function post(token = "tok_live") {
  const app = createApp();
  return app.request(`http://localhost/${token}/accept`, { method: "POST" });
}

describe("POST /chat-room-invite-links/{token}/accept", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    authContextState.current = {
      actor: "user",
      userId: "user_outsider",
      organizationId: null,
      role: "user",
    };
    prismaTransactionMock.mockImplementation(
      async (cb: (client: typeof tx) => unknown) => cb(tx),
    );
    queryRawMock.mockResolvedValue([{ id: ROOM_ID }]);
    userFindUniqueMock.mockResolvedValue({
      id: "user_outsider",
      name: "Outsider",
    });
    roomFindUniqueMock.mockResolvedValue(externalRoom());
    memberFindUniqueMock.mockResolvedValue(null);
    roomUserMemberFindUniqueMock.mockResolvedValue(null);
    tryConsumeInviteLinkMock.mockResolvedValue(true);
    roomUserMemberCreateMock.mockResolvedValue({});
    readStateCreateManyMock.mockResolvedValue({ count: 1 });
    recordChannelMembershipStatusMock.mockResolvedValue([]);
    publishChatRoomMessageRealtimeMock.mockResolvedValue(undefined);
  });

  it("rejects an unauthenticated caller with 401", async () => {
    authContextState.current = null;
    const response = await post();
    expect(response.status).toBe(401);
    expect(getInviteLinkByTokenMock).not.toHaveBeenCalled();
  });

  it("rejects a coworker actor so it cannot enroll arbitrary users", async () => {
    authContextState.current = {
      actor: "coworker",
      coworkerId: "cow_1",
      vendorId: "vendor_1",
      context: { userId: "victim_999", organizationId: null },
    };
    getInviteLinkByTokenMock.mockResolvedValue(liveLink());

    const response = await post();
    expect(response.status).toBe(403);
    expect(roomUserMemberCreateMock).not.toHaveBeenCalled();
  });

  it("joins a valid link as access=guest without org membership", async () => {
    getInviteLinkByTokenMock.mockResolvedValue(liveLink());

    const response = await post();
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.data).toEqual({
      status: "joined",
      roomId: ROOM_ID,
      roomName: "External Channel",
    });
    expect(tryConsumeInviteLinkMock).toHaveBeenCalled();
    expect(roomUserMemberCreateMock).toHaveBeenCalledWith({
      data: {
        roomId: ROOM_ID,
        userId: "user_outsider",
        access: "guest",
      },
    });
    expect(memberFindUniqueMock).toHaveBeenCalled();
  });

  it("is idempotent for an existing guest without consuming a use", async () => {
    getInviteLinkByTokenMock.mockResolvedValue(liveLink());
    roomUserMemberFindUniqueMock.mockResolvedValue({ access: "guest" });

    const response = await post();
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.data.status).toBe("already_guest");
    expect(tryConsumeInviteLinkMock).not.toHaveBeenCalled();
    expect(roomUserMemberCreateMock).not.toHaveBeenCalled();
  });

  it("rejects host-org members (they self-join as members)", async () => {
    getInviteLinkByTokenMock.mockResolvedValue(liveLink());
    memberFindUniqueMock.mockResolvedValue({ id: "mem_1" });

    const response = await post();
    expect(response.status).toBe(400);
    expect(await response.text()).toMatch(/organization member/i);
    expect(tryConsumeInviteLinkMock).not.toHaveBeenCalled();
  });

  it("rejects expired links with 400", async () => {
    getInviteLinkByTokenMock.mockResolvedValue(
      liveLink({
        expiresAt: new Date(NOW - 1000),
      }),
    );

    const response = await post();
    expect(response.status).toBe(400);
    expect(await response.text()).toMatch(/expired/i);
  });

  it("rejects revoked links with 400", async () => {
    getInviteLinkByTokenMock.mockResolvedValue(
      liveLink({
        revokedAt: new Date(NOW - 1000),
      }),
    );

    const response = await post();
    expect(response.status).toBe(400);
    expect(await response.text()).toMatch(/revoked/i);
  });

  it("rejects depleted links with 400", async () => {
    getInviteLinkByTokenMock.mockResolvedValue(
      liveLink({
        maxUses: 1,
        useCount: 1,
      }),
    );

    const response = await post();
    expect(response.status).toBe(400);
    expect(await response.text()).toMatch(/usage limit/i);
  });

  it("returns 404 for unknown tokens", async () => {
    getInviteLinkByTokenMock.mockResolvedValue(null);

    const response = await post("tok_missing");
    expect(response.status).toBe(404);
  });
});
