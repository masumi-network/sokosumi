import { OpenAPIHono } from "@hono/zod-openapi";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { OpenAPIHonoWithAuth } from "@/lib/hono";
import { defaultValidationHook } from "@/lib/hono";
import type { AuthVariables } from "@/middleware/auth";

import mountLeaveChatRoom from "./delete";

const {
  roomFindFirstMock,
  userMemberCountMock,
  userMemberDeleteManyMock,
  readStateDeleteManyMock,
  queryRawMock,
  organizationFindUniqueMock,
  memberFindUniqueMock,
  prismaTransactionMock,
} = vi.hoisted(() => ({
  roomFindFirstMock: vi.fn(),
  userMemberCountMock: vi.fn(),
  userMemberDeleteManyMock: vi.fn(),
  readStateDeleteManyMock: vi.fn(),
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

const tx = {
  chatRoom: { findFirst: roomFindFirstMock },
  chatRoomUserMember: {
    count: userMemberCountMock,
    deleteMany: userMemberDeleteManyMock,
  },
  chatRoomReadState: { deleteMany: readStateDeleteManyMock },
  organization: { findUnique: organizationFindUniqueMock },
  member: { findUnique: memberFindUniqueMock },
  $queryRaw: queryRawMock,
};

function createApp() {
  const app = new OpenAPIHono<{ Variables: AuthVariables }>({
    defaultHook: defaultValidationHook,
  });
  app.use("*", async (c, next) => {
    c.set("isAuthenticated", true);
    c.set("authContext", {
      actor: "user",
      userId: SELF_ID,
      organizationId: "org_1",
      role: "user",
    });
    return await next();
  });
  mountLeaveChatRoom(app as unknown as OpenAPIHonoWithAuth);
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

function room(overrides: { kind?: string; memberIds?: string[] } = {}) {
  return {
    id: ROOM_ID,
    organizationId: "org_1",
    name: "general",
    slug: "general",
    kind: overrides.kind ?? "channel",
    directKey: null,
    topic: null,
    createdByUserId: OTHER_ID,
    createdAt: new Date("2026-01-01T00:00:00.000Z"),
    updatedAt: new Date("2026-01-01T00:00:00.000Z"),
    archivedAt: null,
    userMembers: (overrides.memberIds ?? [SELF_ID, OTHER_ID]).map(member),
    coworkerMembers: [],
  };
}

function leave() {
  return createApp().request(`/${ROOM_ID}/members/me`, { method: "DELETE" });
}

beforeEach(() => {
  vi.clearAllMocks();
  prismaTransactionMock.mockImplementation(async (cb) => cb(tx));
  organizationFindUniqueMock.mockResolvedValue({ id: "org_1" });
  memberFindUniqueMock.mockResolvedValue({ role: "member" });
  queryRawMock.mockResolvedValue([{ id: ROOM_ID }]);
  userMemberCountMock.mockResolvedValue(1);
  userMemberDeleteManyMock.mockResolvedValue({ count: 1 });
  readStateDeleteManyMock.mockResolvedValue({ count: 1 });
});

describe("DELETE /chats/rooms/{id}/members/me", () => {
  it("removes only the caller's membership and read marker", async () => {
    roomFindFirstMock.mockResolvedValue(room());
    userMemberCountMock.mockResolvedValue(1);

    const response = await leave();

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.data).toEqual({
      id: ROOM_ID,
      remainingUserMemberCount: 1,
    });

    expect(queryRawMock).toHaveBeenCalled();
    expect(userMemberCountMock).toHaveBeenCalledWith({
      where: { roomId: ROOM_ID, userId: { not: SELF_ID } },
    });
    expect(userMemberDeleteManyMock).toHaveBeenCalledWith({
      where: { roomId: ROOM_ID, userId: SELF_ID },
    });
    expect(readStateDeleteManyMock).toHaveBeenCalledWith({
      where: { roomId: ROOM_ID, userId: SELF_ID },
    });
  });

  it("lets a plain member leave without any elevated role", async () => {
    roomFindFirstMock.mockResolvedValue(
      room({ memberIds: [SELF_ID, OTHER_ID, "user_third"] }),
    );
    memberFindUniqueMock.mockResolvedValue({ role: "member" });
    userMemberCountMock.mockResolvedValue(2);

    const response = await leave();

    expect(response.status).toBe(200);
    expect((await response.json()).data.remainingUserMemberCount).toBe(2);
  });

  it("refuses to let the last member leave", async () => {
    roomFindFirstMock.mockResolvedValue(room({ memberIds: [SELF_ID] }));
    userMemberCountMock.mockResolvedValue(0);

    expect((await leave()).status).toBe(400);
    expect(userMemberDeleteManyMock).not.toHaveBeenCalled();
    expect(readStateDeleteManyMock).not.toHaveBeenCalled();
  });

  it("refuses to leave a direct room", async () => {
    roomFindFirstMock.mockResolvedValue(room({ kind: "direct" }));

    expect((await leave()).status).toBe(400);
    expect(queryRawMock).not.toHaveBeenCalled();
    expect(userMemberDeleteManyMock).not.toHaveBeenCalled();
  });

  it("404s when the caller is not a member", async () => {
    roomFindFirstMock.mockResolvedValue(null);

    expect((await leave()).status).toBe(404);
    expect(userMemberDeleteManyMock).not.toHaveBeenCalled();
  });
});
