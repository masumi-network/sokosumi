import { OpenAPIHono } from "@hono/zod-openapi";
import { MemberRole } from "@sokosumi/database";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { OpenAPIHonoWithAuth } from "@/lib/hono";
import { defaultValidationHook } from "@/lib/hono";
import type { AuthVariables } from "@/middleware/auth";

import mountArchiveChatRoom from "./post";

const {
  roomFindFirstMock,
  roomUpdateManyMock,
  queryRawMock,
  organizationFindUniqueMock,
  memberFindUniqueMock,
  prismaTransactionMock,
} = vi.hoisted(() => ({
  roomFindFirstMock: vi.fn(),
  roomUpdateManyMock: vi.fn(),
  queryRawMock: vi.fn(),
  organizationFindUniqueMock: vi.fn(),
  memberFindUniqueMock: vi.fn(),
  prismaTransactionMock: vi.fn(),
}));

vi.mock("@/lib/db/prisma", () => ({
  default: { $transaction: prismaTransactionMock },
}));

const ROOM_ID = "550e8400-e29b-41d4-a716-446655440000";
const CREATOR_ID = "user_creator";
const OTHER_ID = "user_other";

const tx = {
  chatRoom: { findFirst: roomFindFirstMock, updateMany: roomUpdateManyMock },
  organization: { findUnique: organizationFindUniqueMock },
  member: { findUnique: memberFindUniqueMock },
  $queryRaw: queryRawMock,
};

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

function createApp(userId: string) {
  const app = new OpenAPIHono<{ Variables: AuthVariables }>({
    defaultHook: defaultValidationHook,
  });
  app.use("*", async (c, next) => {
    c.set("isAuthenticated", true);
    c.set("authContext", {
      actor: "user",
      userId,
      organizationId: "org_1",
      role: "user",
    });
    return await next();
  });
  mountArchiveChatRoom(app as unknown as OpenAPIHonoWithAuth);
  return app;
}

function room(
  overrides: {
    kind?: string;
    createdByUserId?: string;
    organizationId?: string | null;
    memberIds?: string[];
  } = {},
) {
  return {
    id: ROOM_ID,
    organizationId:
      overrides.organizationId === undefined
        ? "org_1"
        : overrides.organizationId,
    name: "general",
    slug: "general",
    kind: overrides.kind ?? "channel",
    directKey: null,
    topic: null,
    createdByUserId: overrides.createdByUserId ?? CREATOR_ID,
    createdAt: new Date("2026-01-01T00:00:00.000Z"),
    updatedAt: new Date("2026-01-01T00:00:00.000Z"),
    archivedAt: null,
    userMembers: (overrides.memberIds ?? [CREATOR_ID, OTHER_ID]).map(member),
    coworkerMembers: [],
  };
}

function archive() {
  return createApp(CREATOR_ID).request(`/${ROOM_ID}/archive`, {
    method: "POST",
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  prismaTransactionMock.mockImplementation(async (cb) => cb(tx));
  organizationFindUniqueMock.mockResolvedValue({ id: "org_1" });
  memberFindUniqueMock.mockResolvedValue({ role: "member" });
  queryRawMock.mockResolvedValue([{ id: ROOM_ID }]);
  roomUpdateManyMock.mockResolvedValue({ count: 1 });
});

describe("POST /chats/rooms/{id}/archive", () => {
  it("rejects a creator who is only a plain member", async () => {
    roomFindFirstMock.mockResolvedValue(room());
    memberFindUniqueMock.mockResolvedValue({ role: "member" });

    const response = await archive();

    expect(response.status).toBe(403);
    const text = await response.text();
    expect(text).toMatch(/organization owner or admin/i);
    expect(text).not.toMatch(/creator/i);
    expect(roomUpdateManyMock).not.toHaveBeenCalled();
  });

  it.each([
    ["admin", MemberRole.ADMIN],
    ["owner", MemberRole.OWNER],
  ])(
    "lets an organization %s archive a room and returns the timestamp",
    async (_label, role) => {
      roomFindFirstMock.mockResolvedValue(room({ createdByUserId: OTHER_ID }));
      memberFindUniqueMock.mockResolvedValue({ role });

      const response = await archive();

      expect(response.status).toBe(200);
      const body = await response.json();
      expect(body.data.id).toBe(ROOM_ID);
      expect(typeof body.data.archivedAt).toBe("string");

      const sqlParts = queryRawMock.mock.calls[0]?.[0] as TemplateStringsArray;
      expect(sqlParts.join(" ")).toContain("FOR UPDATE");
      expect(roomUpdateManyMock).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: ROOM_ID, archivedAt: null },
          data: { archivedAt: expect.any(Date) },
        }),
      );
    },
  );

  it("rejects a plain member who is not elevated", async () => {
    roomFindFirstMock.mockResolvedValue(
      room({
        createdByUserId: OTHER_ID,
        memberIds: [CREATOR_ID, OTHER_ID, "user_third"],
      }),
    );
    memberFindUniqueMock.mockResolvedValue({ role: "member" });

    expect((await archive()).status).toBe(403);
    expect(roomUpdateManyMock).not.toHaveBeenCalled();
  });

  it("refuses to archive a direct room", async () => {
    roomFindFirstMock.mockResolvedValue(room({ kind: "direct" }));

    expect((await archive()).status).toBe(400);
    expect(queryRawMock).not.toHaveBeenCalled();
    expect(roomUpdateManyMock).not.toHaveBeenCalled();
  });

  it("refuses to archive a room that has no organization", async () => {
    roomFindFirstMock.mockResolvedValue(room({ organizationId: null }));

    expect((await archive()).status).toBe(400);
    expect(queryRawMock).not.toHaveBeenCalled();
    expect(roomUpdateManyMock).not.toHaveBeenCalled();
  });

  it("404s when the room is not visible to the caller", async () => {
    roomFindFirstMock.mockResolvedValue(null);

    expect((await archive()).status).toBe(404);
    expect(roomUpdateManyMock).not.toHaveBeenCalled();
  });

  it("404s when a concurrent archive already set archivedAt under the lock", async () => {
    roomFindFirstMock.mockResolvedValue(room());
    memberFindUniqueMock.mockResolvedValue({ role: MemberRole.OWNER });
    roomUpdateManyMock.mockResolvedValue({ count: 0 });

    expect((await archive()).status).toBe(404);
  });
});
