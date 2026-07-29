import { OpenAPIHono } from "@hono/zod-openapi";
import { MemberRole } from "@sokosumi/database";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { OpenAPIHonoWithAuth } from "@/lib/hono";
import { defaultValidationHook } from "@/lib/hono";
import type { AuthVariables } from "@/middleware/auth";

import mountRestoreChatRoom from "./post";

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
const SELF_ID = "user_self";
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

function createApp(userId = SELF_ID) {
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
  mountRestoreChatRoom(app as unknown as OpenAPIHonoWithAuth);
  return app;
}

function archivedRoom(
  overrides: {
    kind?: string;
    organizationId?: string | null;
    createdByUserId?: string;
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
    createdByUserId: overrides.createdByUserId ?? SELF_ID,
    createdAt: new Date("2026-01-01T00:00:00.000Z"),
    updatedAt: new Date("2026-01-01T00:00:00.000Z"),
    archivedAt: new Date("2026-02-01T00:00:00.000Z"),
    userMembers: (overrides.memberIds ?? [SELF_ID, OTHER_ID]).map(member),
    coworkerMembers: [],
  };
}

function restore() {
  return createApp().request(`/${ROOM_ID}/restore`, { method: "POST" });
}

beforeEach(() => {
  vi.clearAllMocks();
  prismaTransactionMock.mockImplementation(async (cb) => cb(tx));
  organizationFindUniqueMock.mockResolvedValue({ id: "org_1" });
  memberFindUniqueMock.mockResolvedValue({ role: "member" });
  queryRawMock.mockResolvedValue([{ id: ROOM_ID }]);
  roomUpdateManyMock.mockResolvedValue({ count: 1 });
});

describe("POST /chats/rooms/{id}/restore", () => {
  it("clears archivedAt and returns the live room for the creator", async () => {
    const archived = archivedRoom();
    const live = { ...archived, archivedAt: null };
    roomFindFirstMock
      .mockResolvedValueOnce(archived)
      .mockResolvedValueOnce(live);

    const response = await restore();

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.data.id).toBe(ROOM_ID);
    expect(body.data.name).toBe("general");
    expect(body.data.slug).toBe("general");

    const sqlParts = queryRawMock.mock.calls[0]?.[0] as TemplateStringsArray;
    expect(sqlParts.join(" ")).toContain("FOR UPDATE");
    expect(roomUpdateManyMock).toHaveBeenCalledWith({
      where: { id: ROOM_ID, archivedAt: { not: null } },
      data: { archivedAt: null },
    });
  });

  it.each([
    ["admin", MemberRole.ADMIN],
    ["owner", MemberRole.OWNER],
  ])(
    "lets an organization %s restore a room they did not create",
    async (_label, role) => {
      const archived = archivedRoom({ createdByUserId: OTHER_ID });
      roomFindFirstMock
        .mockResolvedValueOnce(archived)
        .mockResolvedValueOnce({ ...archived, archivedAt: null });
      memberFindUniqueMock.mockResolvedValue({ role });

      expect((await restore()).status).toBe(200);
    },
  );

  it("rejects a plain member who is not the creator", async () => {
    roomFindFirstMock.mockResolvedValue(
      archivedRoom({ createdByUserId: OTHER_ID, memberIds: [SELF_ID] }),
    );
    memberFindUniqueMock.mockResolvedValue({ role: "member" });

    expect((await restore()).status).toBe(403);
    expect(roomUpdateManyMock).not.toHaveBeenCalled();
  });

  it("refuses to restore a direct room", async () => {
    roomFindFirstMock.mockResolvedValue(archivedRoom({ kind: "direct" }));

    expect((await restore()).status).toBe(400);
    expect(roomUpdateManyMock).not.toHaveBeenCalled();
  });

  it("refuses to restore a room that has no organization", async () => {
    roomFindFirstMock.mockResolvedValue(archivedRoom({ organizationId: null }));

    expect((await restore()).status).toBe(400);
    expect(roomUpdateManyMock).not.toHaveBeenCalled();
  });

  it("404s when the room is not archived or not visible", async () => {
    roomFindFirstMock.mockResolvedValue(null);

    expect((await restore()).status).toBe(404);
    expect(roomUpdateManyMock).not.toHaveBeenCalled();
  });

  it("400s when a concurrent restore already cleared archivedAt", async () => {
    roomFindFirstMock.mockResolvedValue(archivedRoom());
    roomUpdateManyMock.mockResolvedValue({ count: 0 });

    expect((await restore()).status).toBe(400);
  });
});
