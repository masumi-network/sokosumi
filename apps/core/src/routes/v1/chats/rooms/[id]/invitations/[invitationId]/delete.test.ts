import { MemberRole } from "@sokosumi/database";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { errorHandler } from "@/helpers/error-handler";
import { OpenAPIHonoWithAuth } from "@/lib/hono";
import type { AuthVariables } from "@/middleware/auth";

import mountDeleteChatRoomInvitation from "./delete";

vi.mock("@/middleware/auth", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/middleware/auth")>();
  const { stubAuthMiddleware } = await import(
    "@/test-fixtures/auth-middleware"
  );
  return { ...actual, authMiddleware: stubAuthMiddleware };
});

const {
  roomFindFirstMock,
  organizationFindUniqueMock,
  memberFindUniqueMock,
  invitationUpdateManyMock,
  prismaTransactionMock,
} = vi.hoisted(() => ({
  roomFindFirstMock: vi.fn(),
  organizationFindUniqueMock: vi.fn(),
  memberFindUniqueMock: vi.fn(),
  invitationUpdateManyMock: vi.fn(),
  prismaTransactionMock: vi.fn(),
}));

vi.mock("@/lib/db/prisma", () => ({
  default: {
    $transaction: prismaTransactionMock,
  },
}));

const ROOM_ID = "550e8400-e29b-41d4-a716-446655440000";
const INVITE_ID = "550e8400-e29b-41d4-a716-446655440010";
const MEMBER_ID = "user_member";
const GUEST_ID = "user_guest";
const ORG_ID = "org_1";

const tx = {
  chatRoom: { findFirst: roomFindFirstMock },
  organization: { findUnique: organizationFindUniqueMock },
  member: { findUnique: memberFindUniqueMock },
  chatRoomGuestInvitation: { updateMany: invitationUpdateManyMock },
};

function createApp(
  authContext: AuthVariables["authContext"] = {
    actor: "user",
    userId: MEMBER_ID,
    organizationId: ORG_ID,
    role: "user",
  },
) {
  const app = new OpenAPIHonoWithAuth();

  app.use("*", async (c, next) => {
    c.set("requestId", "req_revoke_invite");
    c.set("isAuthenticated", true);
    c.set("authContext", authContext);
    return await next();
  });

  app.onError(errorHandler);
  mountDeleteChatRoomInvitation(app);
  return app;
}

function memberUser(id: string, access: "member" | "guest" = "member") {
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

function externalRoom(members: ReturnType<typeof memberUser>[]) {
  return {
    id: ROOM_ID,
    organizationId: ORG_ID,
    name: "Client Room",
    slug: "client-room",
    kind: "channel",
    directKey: null,
    topic: null,
    discoverability: "external",
    createdByUserId: MEMBER_ID,
    createdAt: new Date("2026-01-01T00:00:00.000Z"),
    updatedAt: new Date("2026-01-01T00:00:00.000Z"),
    archivedAt: null,
    userMembers: members,
    coworkerMembers: [],
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  prismaTransactionMock.mockImplementation(async (cb) => cb(tx));
  roomFindFirstMock.mockResolvedValue(
    externalRoom([memberUser(MEMBER_ID, "member")]),
  );
  organizationFindUniqueMock.mockResolvedValue({
    id: ORG_ID,
    name: "Acme Corp",
  });
  memberFindUniqueMock.mockResolvedValue({
    id: "mem_1",
    role: MemberRole.MEMBER,
    userId: MEMBER_ID,
    organizationId: ORG_ID,
  });
  invitationUpdateManyMock.mockResolvedValue({ count: 1 });
});

describe("DELETE /chats/rooms/{id}/invitations/{invitationId}", () => {
  it("revokes a pending invitation", async () => {
    const response = await createApp().request(
      `/${ROOM_ID}/invitations/${INVITE_ID}`,
      { method: "DELETE" },
    );

    expect(response.status).toBe(204);
    expect(invitationUpdateManyMock).toHaveBeenCalledWith({
      where: {
        id: INVITE_ID,
        roomId: ROOM_ID,
        status: "pending",
      },
      data: { status: "revoked" },
    });
  });

  it("404s when invitation is missing or not pending", async () => {
    invitationUpdateManyMock.mockResolvedValue({ count: 0 });

    const response = await createApp().request(
      `/${ROOM_ID}/invitations/${INVITE_ID}`,
      { method: "DELETE" },
    );

    expect(response.status).toBe(404);
  });

  it("rejects guest callers", async () => {
    roomFindFirstMock.mockResolvedValue(
      externalRoom([memberUser(GUEST_ID, "guest")]),
    );

    const response = await createApp({
      actor: "user",
      userId: GUEST_ID,
      organizationId: "other_org",
      role: "user",
    }).request(`/${ROOM_ID}/invitations/${INVITE_ID}`, {
      method: "DELETE",
    });

    expect(response.status).toBe(403);
    expect(invitationUpdateManyMock).not.toHaveBeenCalled();
  });
});
