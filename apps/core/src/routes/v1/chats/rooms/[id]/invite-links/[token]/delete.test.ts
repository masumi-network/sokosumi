import { beforeEach, describe, expect, it, vi } from "vitest";

import { errorHandler } from "@/helpers/error-handler";
import { OpenAPIHonoWithAuth } from "@/lib/hono";
import type { AuthVariables } from "@/middleware/auth";

import mountDeleteChatRoomGuestInviteLink from "./delete";

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
  getInviteLinkByTokenMock,
  revokeInviteLinkMock,
} = vi.hoisted(() => ({
  roomFindFirstMock: vi.fn(),
  organizationFindUniqueMock: vi.fn(),
  memberFindUniqueMock: vi.fn(),
  getInviteLinkByTokenMock: vi.fn(),
  revokeInviteLinkMock: vi.fn(),
}));

vi.mock("@/lib/db/prisma", () => ({
  default: {
    chatRoom: { findFirst: roomFindFirstMock },
    organization: { findUnique: organizationFindUniqueMock },
    member: { findUnique: memberFindUniqueMock },
  },
}));

vi.mock("@sokosumi/database/repositories", () => ({
  chatRoomGuestInviteLinkRepository: {
    getInviteLinkByToken: (...args: unknown[]) =>
      getInviteLinkByTokenMock(...args),
    revokeInviteLink: (...args: unknown[]) => revokeInviteLinkMock(...args),
  },
}));

const ROOM_ID = "550e8400-e29b-41d4-a716-446655440000";
const OTHER_ROOM_ID = "550e8400-e29b-41d4-a716-446655440001";
const MEMBER_ID = "user_member";
const ORG_ID = "org_1";
const TOKEN = "tok_abc123";
const LINK_ID = "550e8400-e29b-41d4-a716-446655440099";

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
    c.set("requestId", "req_revoke_invite_link");
    c.set("isAuthenticated", true);
    c.set("authContext", authContext);
    return await next();
  });

  app.onError(errorHandler);
  mountDeleteChatRoomGuestInviteLink(app);
  return app;
}

function externalRoom() {
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
    userMembers: [{ userId: MEMBER_ID, access: "member" }],
    coworkerMembers: [],
    organization: { id: ORG_ID, name: "Acme" },
  };
}

describe("DELETE /chats/rooms/{id}/invite-links/{token}", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    roomFindFirstMock.mockResolvedValue(externalRoom());
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
    revokeInviteLinkMock.mockResolvedValue({});
  });

  it("revokes a live invite link for the room", async () => {
    getInviteLinkByTokenMock.mockResolvedValue({
      id: LINK_ID,
      token: TOKEN,
      roomId: ROOM_ID,
      revokedAt: null,
    });

    const app = createApp();
    const response = await app.request(`/${ROOM_ID}/invite-links/${TOKEN}`, {
      method: "DELETE",
    });
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.data.ok).toBe(true);
    expect(revokeInviteLinkMock).toHaveBeenCalledWith(
      LINK_ID,
      expect.any(Date),
      expect.anything(),
    );
  });

  it("returns 404 when the token belongs to another room", async () => {
    getInviteLinkByTokenMock.mockResolvedValue({
      id: LINK_ID,
      token: TOKEN,
      roomId: OTHER_ROOM_ID,
      revokedAt: null,
    });

    const app = createApp();
    const response = await app.request(`/${ROOM_ID}/invite-links/${TOKEN}`, {
      method: "DELETE",
    });

    expect(response.status).toBe(404);
    expect(revokeInviteLinkMock).not.toHaveBeenCalled();
  });

  it("is idempotent when the link is already revoked", async () => {
    getInviteLinkByTokenMock.mockResolvedValue({
      id: LINK_ID,
      token: TOKEN,
      roomId: ROOM_ID,
      revokedAt: new Date("2026-08-01T00:00:00.000Z"),
    });

    const app = createApp();
    const response = await app.request(`/${ROOM_ID}/invite-links/${TOKEN}`, {
      method: "DELETE",
    });

    expect(response.status).toBe(200);
    expect(revokeInviteLinkMock).not.toHaveBeenCalled();
  });
});
