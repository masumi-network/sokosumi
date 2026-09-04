import { MemberRole } from "@sokosumi/database";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { OpenAPIHonoWithAuth } from "@/lib/hono";

import mountDeleteChatRoom from "./delete";

vi.mock("@/middleware/auth", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/middleware/auth")>();
  const { stubAuthMiddleware } = await import(
    "@/test-fixtures/auth-middleware"
  );
  return { ...actual, authMiddleware: stubAuthMiddleware };
});

const {
  roomFindFirstMock,
  roomDeleteManyMock,
  queryRawMock,
  organizationFindUniqueMock,
  memberFindUniqueMock,
  prismaTransactionMock,
} = vi.hoisted(() => ({
  roomFindFirstMock: vi.fn(),
  roomDeleteManyMock: vi.fn(),
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
  chatRoom: { findFirst: roomFindFirstMock, deleteMany: roomDeleteManyMock },
  organization: { findUnique: organizationFindUniqueMock },
  member: { findUnique: memberFindUniqueMock },
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
  mountDeleteChatRoom(app);
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
    sokoBotMembers: [],
  };
}

function permanentlyDelete(userId = SELF_ID) {
  return createApp(userId).request(`/${ROOM_ID}`, { method: "DELETE" });
}

beforeEach(() => {
  vi.clearAllMocks();
  prismaTransactionMock.mockImplementation(async (cb) => cb(tx));
  organizationFindUniqueMock.mockResolvedValue({ id: "org_1" });
  memberFindUniqueMock.mockResolvedValue({ role: MemberRole.OWNER });
  queryRawMock.mockResolvedValue([{ id: ROOM_ID }]);
  roomDeleteManyMock.mockResolvedValue({ count: 1 });
});

describe("DELETE /chats/rooms/{id}", () => {
  it.each([
    ["admin", MemberRole.ADMIN],
    ["owner", MemberRole.OWNER],
  ])(
    "lets an organization %s permanently delete an archived room",
    async (_label, role) => {
      roomFindFirstMock.mockResolvedValue(archivedRoom());
      memberFindUniqueMock.mockResolvedValue({ role });

      const response = await permanentlyDelete();

      expect(response.status).toBe(204);
      const sqlParts = queryRawMock.mock.calls[0]?.[0] as TemplateStringsArray;
      expect(sqlParts.join(" ")).toContain("FOR UPDATE");
      expect(roomDeleteManyMock).toHaveBeenCalledWith({
        where: { id: ROOM_ID, archivedAt: { not: null } },
      });
    },
  );

  it("rejects a creator who is only a plain member", async () => {
    roomFindFirstMock.mockResolvedValue(
      archivedRoom({ createdByUserId: SELF_ID, memberIds: [SELF_ID] }),
    );
    memberFindUniqueMock.mockResolvedValue({ role: MemberRole.MEMBER });

    expect((await permanentlyDelete()).status).toBe(403);
    expect(roomDeleteManyMock).not.toHaveBeenCalled();
  });

  it("rejects a plain member who is not the creator", async () => {
    roomFindFirstMock.mockResolvedValue(
      archivedRoom({ createdByUserId: OTHER_ID, memberIds: [SELF_ID] }),
    );
    memberFindUniqueMock.mockResolvedValue({ role: MemberRole.MEMBER });

    expect((await permanentlyDelete()).status).toBe(403);
    expect(roomDeleteManyMock).not.toHaveBeenCalled();
  });

  it("404s when the room is not archived or not visible", async () => {
    roomFindFirstMock.mockResolvedValue(null);

    expect((await permanentlyDelete()).status).toBe(404);
    expect(roomDeleteManyMock).not.toHaveBeenCalled();
  });

  it("refuses to delete a direct room", async () => {
    roomFindFirstMock.mockResolvedValue(archivedRoom({ kind: "direct" }));

    expect((await permanentlyDelete()).status).toBe(400);
    expect(roomDeleteManyMock).not.toHaveBeenCalled();
  });

  it("404s when a concurrent restore cleared archivedAt under the lock", async () => {
    roomFindFirstMock.mockResolvedValue(archivedRoom());
    roomDeleteManyMock.mockResolvedValue({ count: 0 });

    expect((await permanentlyDelete()).status).toBe(404);
  });

  it("rejects a guest who is not a host-org member with 403", async () => {
    const guestId = "user_guest";
    roomFindFirstMock.mockResolvedValue({
      ...archivedRoom({ memberIds: [OTHER_ID, guestId] }),
      userMembers: [member(OTHER_ID, "member"), member(guestId, "guest")],
    });

    const response = await permanentlyDelete(guestId);

    expect(response.status).toBe(403);
    expect(await response.text()).toMatch(/guests cannot permanently delete/i);
    expect(roomDeleteManyMock).not.toHaveBeenCalled();
    expect(memberFindUniqueMock).not.toHaveBeenCalled();
  });
});
