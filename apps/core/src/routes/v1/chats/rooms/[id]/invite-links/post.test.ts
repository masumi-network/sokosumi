import { OpenAPIHono } from "@hono/zod-openapi";
import type { RequestIdVariables } from "hono/request-id";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { errorHandler } from "@/helpers/error-handler";
import type { OpenAPIHonoWithAuth } from "@/lib/hono";
import { defaultValidationHook } from "@/lib/hono";
import type { AuthVariables } from "@/middleware/auth";

import mountPostChatRoomGuestInviteLink from "./post";

const {
  roomFindFirstMock,
  organizationFindUniqueMock,
  memberFindUniqueMock,
  queryRawMock,
  prismaTransactionMock,
  createInviteLinkMock,
  countLiveInviteLinksByRoomIdMock,
  countRecentCreatesByUserMock,
  getWebAppBaseUrlMock,
} = vi.hoisted(() => ({
  roomFindFirstMock: vi.fn(),
  organizationFindUniqueMock: vi.fn(),
  memberFindUniqueMock: vi.fn(),
  queryRawMock: vi.fn(),
  prismaTransactionMock: vi.fn(),
  createInviteLinkMock: vi.fn(),
  countLiveInviteLinksByRoomIdMock: vi.fn(),
  countRecentCreatesByUserMock: vi.fn(),
  getWebAppBaseUrlMock: vi.fn(),
}));

vi.mock("@/lib/db/prisma", () => ({
  default: {
    $transaction: prismaTransactionMock,
  },
}));

vi.mock("@sokosumi/database/repositories", () => ({
  chatRoomGuestInviteLinkRepository: {
    createInviteLink: (...args: unknown[]) => createInviteLinkMock(...args),
    countLiveInviteLinksByRoomId: (...args: unknown[]) =>
      countLiveInviteLinksByRoomIdMock(...args),
    countRecentCreatesByUser: (...args: unknown[]) =>
      countRecentCreatesByUserMock(...args),
  },
}));

vi.mock("@/config/env", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/config/env")>();
  return {
    ...actual,
    getWebAppBaseUrl: getWebAppBaseUrlMock,
  };
});

const ROOM_ID = "550e8400-e29b-41d4-a716-446655440000";
const MEMBER_ID = "user_member";
const GUEST_ID = "user_guest";
const ORG_ID = "org_1";
const LINK_ID = "550e8400-e29b-41d4-a716-446655440099";

const tx = {
  chatRoom: { findFirst: roomFindFirstMock },
  organization: { findUnique: organizationFindUniqueMock },
  member: { findUnique: memberFindUniqueMock },
  $queryRaw: queryRawMock,
};

function createApp(
  authContext: AuthVariables["authContext"] = {
    actor: "user",
    userId: MEMBER_ID,
    organizationId: ORG_ID,
    role: "user",
  },
) {
  const app = new OpenAPIHono<{
    Variables: AuthVariables & RequestIdVariables;
  }>({
    defaultHook: defaultValidationHook,
  });

  app.use("*", async (c, next) => {
    c.set("requestId", "req_room_invite_link");
    c.set("isAuthenticated", true);
    c.set("authContext", authContext);
    return await next();
  });

  app.onError(errorHandler);
  mountPostChatRoomGuestInviteLink(app as unknown as OpenAPIHonoWithAuth);
  return app;
}

function externalRoom(
  overrides: { userMembers?: Array<{ userId: string; access: string }> } = {},
) {
  return {
    id: ROOM_ID,
    organizationId: ORG_ID,
    name: "External",
    slug: "external",
    kind: "channel",
    directKey: null,
    topic: null,
    discoverability: "external",
    createdByUserId: MEMBER_ID,
    createdAt: new Date("2026-01-01T00:00:00.000Z"),
    updatedAt: new Date("2026-01-01T00:00:00.000Z"),
    archivedAt: null,
    userMembers: overrides.userMembers ?? [
      { userId: MEMBER_ID, access: "member" },
    ],
    coworkerMembers: [],
    organization: { id: ORG_ID, name: "Acme" },
  };
}

describe("POST /chats/rooms/{id}/invite-links", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    prismaTransactionMock.mockImplementation(
      async (cb: (client: typeof tx) => unknown) => cb(tx),
    );
    queryRawMock.mockResolvedValue([{ id: ROOM_ID }]);
    organizationFindUniqueMock.mockResolvedValue({
      id: ORG_ID,
      name: "Acme Corp",
    });
    memberFindUniqueMock.mockResolvedValue({
      id: "mem_1",
      role: "member",
      userId: MEMBER_ID,
      organizationId: ORG_ID,
    });
    countLiveInviteLinksByRoomIdMock.mockResolvedValue(0);
    countRecentCreatesByUserMock.mockResolvedValue(0);
    getWebAppBaseUrlMock.mockReturnValue("https://app.example.com");
    createInviteLinkMock.mockImplementation(
      async (data: {
        token: string;
        roomId: string;
        createdByUserId: string;
        expiresAt: Date;
        maxUses: number | null;
      }) => ({
        id: LINK_ID,
        token: data.token,
        roomId: data.roomId,
        createdByUserId: data.createdByUserId,
        createdAt: new Date("2026-08-01T00:00:00.000Z"),
        expiresAt: data.expiresAt,
        revokedAt: null,
        maxUses: data.maxUses,
        useCount: 0,
      }),
    );
  });

  it("creates a shareable invite link for a host-org room member", async () => {
    roomFindFirstMock.mockResolvedValue(externalRoom());

    const app = createApp();
    const response = await app.request(`/${ROOM_ID}/invite-links`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ expiresInDays: 7, maxUses: 5 }),
    });
    const body = await response.json();

    expect(response.status).toBe(201);
    expect(body.data.url).toMatch(/^https:\/\/app\.example\.com\/chat\/join\//);
    expect(body.data.maxUses).toBe(5);
    expect(body.data.useCount).toBe(0);
    expect(createInviteLinkMock).toHaveBeenCalledWith(
      expect.objectContaining({
        roomId: ROOM_ID,
        createdByUserId: MEMBER_ID,
        maxUses: 5,
      }),
      tx,
    );
  });

  it("forbids guests from minting invite links", async () => {
    roomFindFirstMock.mockResolvedValue(
      externalRoom({
        userMembers: [{ userId: GUEST_ID, access: "guest" }],
      }),
    );

    const app = createApp({
      actor: "user",
      userId: GUEST_ID,
      organizationId: ORG_ID,
      role: "user",
    });
    const response = await app.request(`/${ROOM_ID}/invite-links`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({}),
    });

    expect(response.status).toBe(403);
    expect(createInviteLinkMock).not.toHaveBeenCalled();
  });

  it("rejects when the active link cap is reached", async () => {
    roomFindFirstMock.mockResolvedValue(externalRoom());
    countLiveInviteLinksByRoomIdMock.mockResolvedValue(10);

    const app = createApp();
    const response = await app.request(`/${ROOM_ID}/invite-links`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({}),
    });

    expect(response.status).toBe(429);
    expect(await response.text()).toMatch(/active invite links/i);
    expect(createInviteLinkMock).not.toHaveBeenCalled();
  });

  it("rejects when the hourly create cap is reached", async () => {
    roomFindFirstMock.mockResolvedValue(externalRoom());
    countRecentCreatesByUserMock.mockResolvedValue(10);

    const app = createApp();
    const response = await app.request(`/${ROOM_ID}/invite-links`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({}),
    });

    expect(response.status).toBe(429);
    expect(await response.text()).toMatch(/per hour/i);
    expect(createInviteLinkMock).not.toHaveBeenCalled();
  });

  it("creates a never-expiring link when expiresInDays is null", async () => {
    roomFindFirstMock.mockResolvedValue(externalRoom());

    const app = createApp();
    const response = await app.request(`/${ROOM_ID}/invite-links`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ expiresInDays: null, maxUses: 10 }),
    });
    const body = await response.json();

    expect(response.status).toBe(201);
    expect(body.data.maxUses).toBe(10);
    expect(createInviteLinkMock).toHaveBeenCalledWith(
      expect.objectContaining({
        roomId: ROOM_ID,
        expiresAt: null,
        maxUses: 10,
      }),
      tx,
    );
  });
});
