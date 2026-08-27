import { createMiddleware } from "hono/factory";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { OpenAPIHonoWithAuth } from "@/lib/hono";
import type { AuthenticationContext } from "@/middleware/auth";
import { requireAdminAuthContext } from "@/middleware/auth";
import { TEST_VENDOR_ID } from "@/test-fixtures/vendor.js";

import mountAddAdminExternalChannelGuest from "./post";

const {
  getAdminOrganizationBySlugMock,
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
  getAdminOrganizationBySlugMock: vi.fn(),
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

const authContextState: { current: AuthenticationContext | null } = {
  current: null,
};

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

vi.mock("@/helpers/admin-organization-overview.js", () => ({
  getAdminOrganizationBySlug: (...args: unknown[]) =>
    getAdminOrganizationBySlugMock(...args),
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

vi.mock("@/helpers/chat-room-message-realtime.js", () => ({
  publishChatRoomMessageRealtime: (...args: unknown[]) =>
    publishChatRoomMessageRealtimeMock(...args),
}));

const ROOM_ID = "550e8400-e29b-41d4-a716-446655440000";
const ORG = { id: "org_1", slug: "acme" };

function externalRoom() {
  return {
    id: ROOM_ID,
    name: "External Channel",
    slug: "external-channel",
    kind: "channel",
    discoverability: "external",
    archivedAt: null,
    organizationId: ORG.id,
  };
}

function adminUserContext(
  role = "admin",
): Extract<AuthenticationContext, { actor: "user" }> {
  return {
    actor: "user",
    userId: "user_admin",
    organizationId: null,
    role,
  };
}

function createApp() {
  const app = new OpenAPIHonoWithAuth();
  app.use(
    "*",
    createMiddleware(async (c, next) => {
      requireAdminAuthContext(c.var.authContext);
      await next();
    }),
  );
  mountAddAdminExternalChannelGuest(app);
  return app;
}

async function post(body: { userId: string } = { userId: "user_guest" }) {
  const app = createApp();
  return app.request(
    `http://localhost/acme/external-channels/${ROOM_ID}/guests`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    },
  );
}

describe("POST /admin/organizations/{slug}/external-channels/{roomId}/guests", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    authContextState.current = adminUserContext();
    prismaTransactionMock.mockImplementation(
      async (cb: (client: typeof tx) => unknown) => cb(tx),
    );
    queryRawMock.mockResolvedValue([{ id: ROOM_ID }]);
    getAdminOrganizationBySlugMock.mockResolvedValue(ORG);
    userFindUniqueMock.mockResolvedValue({
      id: "user_guest",
      name: "Guest User",
    });
    roomFindUniqueMock.mockResolvedValue(externalRoom());
    memberFindUniqueMock.mockResolvedValue(null);
    roomUserMemberFindUniqueMock.mockResolvedValue(null);
    roomUserMemberCreateMock.mockResolvedValue({});
    readStateCreateManyMock.mockResolvedValue({ count: 1 });
    recordChannelMembershipStatusMock.mockResolvedValue([{ id: "msg_joined" }]);
    publishChatRoomMessageRealtimeMock.mockResolvedValue(undefined);
  });

  it("adds an existing non-member as access=guest without org membership", async () => {
    const response = await post();
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.data).toEqual({
      userId: "user_guest",
      roomId: ROOM_ID,
      access: "guest",
      outcome: "joined",
    });
    expect(queryRawMock).toHaveBeenCalled();
    expect(roomUserMemberCreateMock).toHaveBeenCalledWith({
      data: {
        roomId: ROOM_ID,
        userId: "user_guest",
        access: "guest",
      },
    });
    expect(recordChannelMembershipStatusMock).toHaveBeenCalledWith(
      expect.anything(),
      {
        roomId: ROOM_ID,
        roomKind: "channel",
        changes: [
          {
            action: "joined",
            subject: {
              type: "user",
              id: "user_guest",
              name: "Guest User",
            },
          },
        ],
      },
    );
    expect(publishChatRoomMessageRealtimeMock).toHaveBeenCalledWith(
      { id: "msg_joined" },
      "create",
    );
  });

  it("is idempotent for an existing guest without a second joined status", async () => {
    roomUserMemberFindUniqueMock.mockResolvedValue({ access: "guest" });

    const response = await post();
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.data).toEqual({
      userId: "user_guest",
      roomId: ROOM_ID,
      access: "guest",
      outcome: "already_guest",
    });
    expect(roomUserMemberCreateMock).not.toHaveBeenCalled();
    expect(recordChannelMembershipStatusMock).not.toHaveBeenCalled();
    expect(publishChatRoomMessageRealtimeMock).not.toHaveBeenCalled();
  });

  it("treats a unique-race guest row as already a guest", async () => {
    roomUserMemberCreateMock.mockRejectedValue({ code: "P2002" });
    roomUserMemberFindUniqueMock
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ access: "guest" });

    const response = await post();
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.data).toMatchObject({
      access: "guest",
      outcome: "already_guest",
    });
    expect(recordChannelMembershipStatusMock).not.toHaveBeenCalled();
  });

  it("rejects host-org members so they self-join as members", async () => {
    memberFindUniqueMock.mockResolvedValue({ id: "mem_1" });

    const response = await post();
    expect(response.status).toBe(400);
    expect(await response.text()).toMatch(/organization member/i);
    expect(roomUserMemberCreateMock).not.toHaveBeenCalled();
  });

  it("rejects an existing non-guest room membership", async () => {
    roomUserMemberFindUniqueMock.mockResolvedValue({ access: "member" });

    const response = await post();
    expect(response.status).toBe(400);
    expect(await response.text()).toMatch(/already a member/i);
    expect(roomUserMemberCreateMock).not.toHaveBeenCalled();
  });

  it("returns 404 when the user does not exist", async () => {
    userFindUniqueMock.mockResolvedValue(null);

    const response = await post();
    expect(response.status).toBe(404);
    expect(await response.text()).toMatch(/user not found/i);
    expect(roomUserMemberCreateMock).not.toHaveBeenCalled();
  });

  it("returns 404 when the organization does not exist", async () => {
    getAdminOrganizationBySlugMock.mockResolvedValue(null);

    const response = await post();
    expect(response.status).toBe(404);
    expect(prismaTransactionMock).not.toHaveBeenCalled();
  });

  it("returns 404 when the room is missing or belongs to another org", async () => {
    roomFindUniqueMock.mockResolvedValue(null);
    expect((await post()).status).toBe(404);

    roomFindUniqueMock.mockResolvedValue({
      ...externalRoom(),
      organizationId: "org_other",
    });
    expect((await post()).status).toBe(404);
    expect(roomUserMemberCreateMock).not.toHaveBeenCalled();
  });

  it("rejects rooms that are not live external channels", async () => {
    roomFindUniqueMock.mockResolvedValue({
      ...externalRoom(),
      discoverability: "public",
    });
    expect((await post()).status).toBe(400);

    roomFindUniqueMock.mockResolvedValue({
      ...externalRoom(),
      archivedAt: new Date("2026-01-01T00:00:00.000Z"),
    });
    expect((await post()).status).toBe(400);

    roomFindUniqueMock.mockResolvedValue({
      ...externalRoom(),
      kind: "direct",
      discoverability: null,
    });
    const response = await post();
    expect(response.status).toBe(400);
    expect(await response.text()).toMatch(/not available for guests/i);
    expect(roomUserMemberCreateMock).not.toHaveBeenCalled();
  });

  it("rejects non-admin users", async () => {
    authContextState.current = adminUserContext("user");
    const response = await post();
    expect(response.status).toBe(403);
    expect(prismaTransactionMock).not.toHaveBeenCalled();
  });

  it("rejects a coworker actor so it cannot enroll an arbitrary user", async () => {
    authContextState.current = {
      actor: "coworker",
      coworkerId: "cow_123",
      vendorId: TEST_VENDOR_ID,
    };
    const response = await post();
    expect(response.status).toBe(403);
    expect(roomUserMemberCreateMock).not.toHaveBeenCalled();
  });

  it("rejects an orchestrator actor so it cannot enroll an arbitrary user", async () => {
    authContextState.current = {
      actor: "orchestrator",
      orchestratorId: "orch_1",
      context: { userId: "user_guest", organizationId: null },
    };
    const response = await post();
    expect(response.status).toBe(403);
    expect(roomUserMemberCreateMock).not.toHaveBeenCalled();
  });
});
