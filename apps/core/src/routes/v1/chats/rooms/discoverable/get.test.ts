import { OpenAPIHono } from "@hono/zod-openapi";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { OpenAPIHonoWithAuth } from "@/lib/hono";
import { defaultValidationHook } from "@/lib/hono";
import type { AuthVariables } from "@/middleware/auth";

import mountBrowseChatRooms from "./get";

const {
  roomFindManyMock,
  roomCountMock,
  organizationFindUniqueMock,
  memberFindUniqueMock,
} = vi.hoisted(() => ({
  roomFindManyMock: vi.fn(),
  roomCountMock: vi.fn(),
  organizationFindUniqueMock: vi.fn(),
  memberFindUniqueMock: vi.fn(),
}));

vi.mock("@/lib/db/prisma", () => ({
  default: {
    chatRoom: {
      findMany: roomFindManyMock,
      count: roomCountMock,
    },
    organization: {
      findUnique: organizationFindUniqueMock,
    },
    member: {
      findUnique: memberFindUniqueMock,
    },
  },
}));

const ROOM_ID = "550e8400-e29b-41d4-a716-446655440000";
const USER_ID = "user_123";
const ORG_ID = "org_1";

function createApp(authContext: AuthVariables["authContext"]) {
  const app = new OpenAPIHono<{ Variables: AuthVariables }>({
    defaultHook: defaultValidationHook,
  });
  app.use("*", async (c, next) => {
    c.set("isAuthenticated", true);
    c.set("authContext", authContext);
    return await next();
  });
  mountBrowseChatRooms(app as unknown as OpenAPIHonoWithAuth);
  return app;
}

const userAuthContext: AuthVariables["authContext"] = {
  actor: "user",
  userId: USER_ID,
  organizationId: ORG_ID,
  role: "user",
};

function discoverableRow(overrides: Record<string, unknown> = {}) {
  return {
    id: ROOM_ID,
    name: "Launch Room",
    slug: "launch-room",
    topic: "Weekly launch planning",
    discoverability: "public",
    createdByUserId: "user_creator",
    createdAt: new Date("2026-01-01T00:00:00.000Z"),
    updatedAt: new Date("2026-01-02T00:00:00.000Z"),
    _count: { userMembers: 4 },
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  organizationFindUniqueMock.mockResolvedValue({ id: ORG_ID });
  memberFindUniqueMock.mockResolvedValue({ role: "member" });
  roomFindManyMock.mockResolvedValue([discoverableRow()]);
  roomCountMock.mockResolvedValue(1);
});

describe("GET /chats/rooms/discoverable", () => {
  it("lists public non-member active channels for the active org", async () => {
    const response = await createApp(userAuthContext).request("/discoverable");

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.data).toEqual([
      {
        id: ROOM_ID,
        name: "Launch Room",
        slug: "launch-room",
        topic: "Weekly launch planning",
        discoverability: "public",
        memberCount: 4,
        createdByUserId: "user_creator",
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-02T00:00:00.000Z",
      },
    ]);
    expect(roomFindManyMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          organizationId: ORG_ID,
          kind: "channel",
          discoverability: { in: ["public", "external"] },
          archivedAt: null,
          userMembers: { none: { userId: USER_ID } },
        }),
        orderBy: [{ name: "asc" }, { id: "asc" }],
      }),
    );
  });

  it("lists external channels in discoverable", async () => {
    roomFindManyMock.mockResolvedValue([
      discoverableRow({
        name: "Client External",
        slug: "client-external",
        topic: null,
        discoverability: "external",
        _count: { userMembers: 2 },
      }),
    ]);
    roomCountMock.mockResolvedValue(1);

    const response = await createApp(userAuthContext).request("/discoverable");

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.data).toEqual([
      {
        id: ROOM_ID,
        name: "Client External",
        slug: "client-external",
        topic: null,
        discoverability: "external",
        memberCount: 2,
        createdByUserId: "user_creator",
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-02T00:00:00.000Z",
      },
    ]);
    expect(roomFindManyMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          discoverability: { in: ["public", "external"] },
        }),
      }),
    );
  });

  it("applies optional q filter on name and slug", async () => {
    const response = await createApp(userAuthContext).request(
      "/discoverable?q=launch",
    );

    expect(response.status).toBe(200);
    expect(roomFindManyMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          OR: [
            { name: { contains: "launch", mode: "insensitive" } },
            { slug: { contains: "launch", mode: "insensitive" } },
          ],
        }),
      }),
    );
  });

  it("rejects when there is no active organization", async () => {
    const response = await createApp({
      actor: "user",
      userId: USER_ID,
      organizationId: null,
      role: "user",
    }).request("/discoverable");

    expect(response.status).toBe(400);
    expect(roomFindManyMock).not.toHaveBeenCalled();
  });

  it("lists private channels for organization owners", async () => {
    memberFindUniqueMock.mockResolvedValue({ role: "owner" });
    roomFindManyMock.mockResolvedValue([
      discoverableRow({
        name: "Secret",
        slug: "secret",
        discoverability: "private",
      }),
    ]);

    const response = await createApp(userAuthContext).request("/discoverable");
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.data[0].discoverability).toBe("private");
    expect(roomFindManyMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          discoverability: { in: ["public", "private", "external"] },
        }),
      }),
    );
  });
});
