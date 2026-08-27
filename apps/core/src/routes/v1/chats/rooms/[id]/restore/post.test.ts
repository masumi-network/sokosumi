import { MemberRole } from "@sokosumi/database";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { OpenAPIHonoWithAuth } from "@/lib/hono";

import mountRestoreChatRoom from "./post";

vi.mock("@/middleware/auth", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/middleware/auth")>();
  const { stubAuthMiddleware } = await import(
    "@/test-fixtures/auth-middleware"
  );
  return { ...actual, authMiddleware: stubAuthMiddleware };
});

const {
  roomFindFirstMock,
  roomUpdateManyMock,
  queryRawMock,
  organizationFindUniqueMock,
  memberFindUniqueMock,
  membershipFindManyMock,
  readStateFindManyMock,
  prismaTransactionMock,
} = vi.hoisted(() => ({
  roomFindFirstMock: vi.fn(),
  roomUpdateManyMock: vi.fn(),
  queryRawMock: vi.fn(),
  organizationFindUniqueMock: vi.fn(),
  memberFindUniqueMock: vi.fn(),
  membershipFindManyMock: vi.fn(),
  readStateFindManyMock: vi.fn(),
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
  chatRoomUserMember: { findMany: membershipFindManyMock },
  chatRoomReadState: { findMany: readStateFindManyMock },
  chatRoomPinnedMessage: { groupBy: vi.fn().mockResolvedValue([]) },
  $queryRaw: queryRawMock,
};

function member(id: string, access: "member" | "guest" = "member") {
  return {
    userId: id,
    access,
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
  const app = new OpenAPIHonoWithAuth();
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
  mountRestoreChatRoom(app);
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
    userMembers: (overrides.memberIds ?? [SELF_ID, OTHER_ID]).map((id) =>
      member(id),
    ),
    coworkerMembers: [],
  };
}

function restore(userId = SELF_ID) {
  return createApp(userId).request(`/${ROOM_ID}/restore`, { method: "POST" });
}

beforeEach(() => {
  vi.clearAllMocks();
  prismaTransactionMock.mockImplementation(async (cb) => cb(tx));
  organizationFindUniqueMock.mockResolvedValue({ id: "org_1" });
  memberFindUniqueMock.mockResolvedValue({ role: "member" });
  queryRawMock.mockResolvedValue([{ id: ROOM_ID }]);
  roomUpdateManyMock.mockResolvedValue({ count: 1 });
  membershipFindManyMock.mockResolvedValue([]);
  readStateFindManyMock.mockResolvedValue([]);
});

describe("POST /chats/rooms/{id}/restore", () => {
  it("rejects a creator who is only a plain member", async () => {
    roomFindFirstMock.mockResolvedValue(archivedRoom());
    memberFindUniqueMock.mockResolvedValue({ role: "member" });

    const response = await restore();

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
    "lets an organization %s restore a room and returns the live room",
    async (_label, role) => {
      const archived = archivedRoom({ createdByUserId: OTHER_ID });
      roomFindFirstMock
        .mockResolvedValueOnce(archived)
        .mockResolvedValueOnce({ ...archived, archivedAt: null });
      memberFindUniqueMock.mockResolvedValue({ role });

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
    },
  );

  it("rejects a plain member who is not elevated", async () => {
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

  it("rejects a guest who is not a host-org member with 403", async () => {
    const guestId = "user_guest";
    roomFindFirstMock.mockResolvedValue({
      ...archivedRoom({ memberIds: [OTHER_ID, guestId] }),
      userMembers: [member(OTHER_ID, "member"), member(guestId, "guest")],
    });

    const response = await restore(guestId);

    expect(response.status).toBe(403);
    expect(await response.text()).toMatch(/guests cannot restore/i);
    expect(roomUpdateManyMock).not.toHaveBeenCalled();
    expect(memberFindUniqueMock).not.toHaveBeenCalled();
  });

  it("400s when a concurrent restore already cleared archivedAt", async () => {
    roomFindFirstMock.mockResolvedValue(archivedRoom());
    memberFindUniqueMock.mockResolvedValue({ role: MemberRole.OWNER });
    roomUpdateManyMock.mockResolvedValue({ count: 0 });

    expect((await restore()).status).toBe(400);
  });
});
