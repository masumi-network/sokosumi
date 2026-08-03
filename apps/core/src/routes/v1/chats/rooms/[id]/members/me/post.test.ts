import { OpenAPIHono } from "@hono/zod-openapi";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { OpenAPIHonoWithAuth } from "@/lib/hono";
import { defaultValidationHook } from "@/lib/hono";
import type { AuthVariables } from "@/middleware/auth";

import mountJoinChatRoom from "./post";

const {
  roomFindFirstMock,
  roomFindFirstOrThrowMock,
  userMemberFindUniqueMock,
  userMemberCreateMock,
  readStateCreateManyMock,
  queryRawMock,
  organizationFindUniqueMock,
  memberFindUniqueMock,
  prismaTransactionMock,
} = vi.hoisted(() => ({
  roomFindFirstMock: vi.fn(),
  roomFindFirstOrThrowMock: vi.fn(),
  userMemberFindUniqueMock: vi.fn(),
  userMemberCreateMock: vi.fn(),
  readStateCreateManyMock: vi.fn(),
  queryRawMock: vi.fn(),
  organizationFindUniqueMock: vi.fn(),
  memberFindUniqueMock: vi.fn(),
  prismaTransactionMock: vi.fn(),
}));

vi.mock("@/lib/db/prisma", () => ({
  default: { $transaction: prismaTransactionMock },
}));

const ROOM_ID = "550e8400-e29b-41d4-a716-446655440000";
const SELF_ID = "user_self";
const OTHER_ID = "user_other";
const ORG_ID = "org_1";

const tx = {
  chatRoom: {
    findFirst: roomFindFirstMock,
    findFirstOrThrow: roomFindFirstOrThrowMock,
  },
  chatRoomUserMember: {
    findUnique: userMemberFindUniqueMock,
    create: userMemberCreateMock,
  },
  chatRoomReadState: {
    createMany: readStateCreateManyMock,
  },
  organization: { findUnique: organizationFindUniqueMock },
  member: { findUnique: memberFindUniqueMock },
  $queryRaw: queryRawMock,
};

function createApp(
  authContext: AuthVariables["authContext"] = {
    actor: "user",
    userId: SELF_ID,
    organizationId: ORG_ID,
    role: "user",
  },
) {
  const app = new OpenAPIHono<{ Variables: AuthVariables }>({
    defaultHook: defaultValidationHook,
  });
  app.use("*", async (c, next) => {
    c.set("isAuthenticated", true);
    c.set("authContext", authContext);
    return await next();
  });
  mountJoinChatRoom(app as unknown as OpenAPIHonoWithAuth);
  return app;
}

function member(id: string) {
  return {
    user: {
      id,
      name: id,
      email: `${id}@example.com`,
      image: null,
      sessions: [],
    },
  };
}

function publicChannel(overrides: Record<string, unknown> = {}) {
  return {
    id: ROOM_ID,
    organizationId: ORG_ID,
    name: "general",
    slug: "general",
    kind: "channel",
    directKey: null,
    topic: null,
    discoverability: "public",
    createdByUserId: OTHER_ID,
    createdAt: new Date("2026-01-01T00:00:00.000Z"),
    updatedAt: new Date("2026-01-01T00:00:00.000Z"),
    archivedAt: null,
    userMembers: [member(OTHER_ID)],
    coworkerMembers: [],
    ...overrides,
  };
}

function join() {
  return createApp().request(`/${ROOM_ID}/members/me`, { method: "POST" });
}

beforeEach(() => {
  vi.clearAllMocks();
  prismaTransactionMock.mockImplementation(async (cb) => cb(tx));
  organizationFindUniqueMock.mockResolvedValue({ id: ORG_ID });
  memberFindUniqueMock.mockResolvedValue({ role: "member" });
  queryRawMock.mockResolvedValue([
    {
      id: ROOM_ID,
      kind: "channel",
      discoverability: "public",
      archivedAt: null,
      organizationId: ORG_ID,
    },
  ]);
  userMemberFindUniqueMock.mockResolvedValue(null);
  userMemberCreateMock.mockResolvedValue({ id: "mem_1" });
  readStateCreateManyMock.mockResolvedValue({ count: 1 });
  const joined = publicChannel({
    userMembers: [member(OTHER_ID), member(SELF_ID)],
  });
  roomFindFirstMock.mockResolvedValue(publicChannel());
  roomFindFirstOrThrowMock.mockResolvedValue(joined);
});

describe("POST /chats/rooms/{id}/members/me", () => {
  it("adds membership and read state for a public channel", async () => {
    const response = await join();

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.data.id).toBe(ROOM_ID);
    expect(body.data.discoverability).toBe("public");
    expect(body.data.userMembers.map((m: { id: string }) => m.id)).toEqual([
      OTHER_ID,
      SELF_ID,
    ]);

    const sqlParts = queryRawMock.mock.calls[0]?.[0] as TemplateStringsArray;
    const sql = sqlParts.join(" ");
    expect(sql).toContain("FOR UPDATE");
    expect(userMemberCreateMock).toHaveBeenCalledWith({
      data: { roomId: ROOM_ID, userId: SELF_ID },
    });
    expect(readStateCreateManyMock).toHaveBeenCalledWith({
      data: [{ roomId: ROOM_ID, userId: SELF_ID }],
      skipDuplicates: true,
    });
  });

  it("is idempotent when already a member", async () => {
    userMemberFindUniqueMock.mockResolvedValue({ id: "mem_existing" });
    roomFindFirstOrThrowMock.mockResolvedValue(
      publicChannel({
        userMembers: [member(OTHER_ID), member(SELF_ID)],
      }),
    );

    const response = await join();

    expect(response.status).toBe(200);
    expect(userMemberCreateMock).not.toHaveBeenCalled();
    expect(readStateCreateManyMock).not.toHaveBeenCalled();
  });

  it("returns 404 for a private channel", async () => {
    roomFindFirstMock.mockResolvedValue(null);

    const response = await join();

    expect(response.status).toBe(404);
    expect(userMemberCreateMock).not.toHaveBeenCalled();
  });

  it("returns 404 when the locked row is no longer public", async () => {
    queryRawMock.mockResolvedValue([
      {
        id: ROOM_ID,
        kind: "channel",
        discoverability: "private",
        archivedAt: null,
        organizationId: ORG_ID,
      },
    ]);

    const response = await join();

    expect(response.status).toBe(404);
    expect(userMemberCreateMock).not.toHaveBeenCalled();
  });

  it("rejects when there is no active organization", async () => {
    const response = await createApp({
      actor: "user",
      userId: SELF_ID,
      organizationId: null,
      role: "user",
    }).request(`/${ROOM_ID}/members/me`, { method: "POST" });

    expect(response.status).toBe(400);
    expect(prismaTransactionMock).not.toHaveBeenCalled();
  });
});
