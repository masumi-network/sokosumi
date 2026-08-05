import { OpenAPIHono } from "@hono/zod-openapi";
import { MemberRole } from "@sokosumi/database";
import type { RequestIdVariables } from "hono/request-id";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { errorHandler } from "@/helpers/error-handler";
import type { OpenAPIHonoWithAuth } from "@/lib/hono";
import { defaultValidationHook } from "@/lib/hono";
import type { AuthVariables } from "@/middleware/auth";

import mountPostChatRoomInvitation from "./post";

const {
  roomFindFirstMock,
  organizationFindUniqueMock,
  memberFindUniqueMock,
  memberFindFirstMock,
  invitationFindFirstMock,
  invitationCreateMock,
  prismaTransactionMock,
} = vi.hoisted(() => ({
  roomFindFirstMock: vi.fn(),
  organizationFindUniqueMock: vi.fn(),
  memberFindUniqueMock: vi.fn(),
  memberFindFirstMock: vi.fn(),
  invitationFindFirstMock: vi.fn(),
  invitationCreateMock: vi.fn(),
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
  member: {
    findUnique: memberFindUniqueMock,
    findFirst: memberFindFirstMock,
  },
  chatRoomGuestInvitation: {
    findFirst: invitationFindFirstMock,
    create: invitationCreateMock,
  },
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
    c.set("requestId", "req_room_invite");
    c.set("isAuthenticated", true);
    c.set("authContext", authContext);
    return await next();
  });

  app.onError(errorHandler);
  mountPostChatRoomInvitation(app as unknown as OpenAPIHonoWithAuth);
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

function externalRoom(
  members: ReturnType<typeof memberUser>[],
  overrides: Record<string, unknown> = {},
) {
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
    ...overrides,
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
  memberFindFirstMock.mockResolvedValue(null);
  invitationFindFirstMock.mockResolvedValue(null);
  invitationCreateMock.mockResolvedValue({
    id: INVITE_ID,
    roomId: ROOM_ID,
    email: "guest@example.com",
    inviterId: MEMBER_ID,
    status: "pending",
    expiresAt: new Date("2026-08-12T12:00:00.000Z"),
    acceptedAt: null,
    acceptedByUserId: null,
    createdAt: new Date("2026-08-05T12:00:00.000Z"),
    updatedAt: new Date("2026-08-05T12:00:00.000Z"),
    inviter: { id: MEMBER_ID, name: "Ada Lovelace" },
  });
});

describe("POST /chats/rooms/{id}/invitations", () => {
  it("creates pending invitation for external room", async () => {
    const response = await createApp().request(`/${ROOM_ID}/invitations`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: "  Guest@Example.com " }),
    });

    expect(response.status).toBe(201);
    const body = await response.json();
    expect(body.data).toMatchObject({
      id: INVITE_ID,
      roomId: ROOM_ID,
      roomName: "Client Room",
      organizationId: ORG_ID,
      organizationName: "Acme Corp",
      email: "guest@example.com",
      status: "pending",
      inviter: { id: MEMBER_ID, name: "Ada Lovelace" },
    });

    expect(invitationCreateMock).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          roomId: ROOM_ID,
          email: "guest@example.com",
          inviterId: MEMBER_ID,
          status: "pending",
          expiresAt: expect.any(Date),
        }),
      }),
    );
  });

  it("rejects invite when email is already host org member", async () => {
    memberFindFirstMock.mockResolvedValue({ id: "mem_host" });

    const response = await createApp().request(`/${ROOM_ID}/invitations`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: "member@acme.com" }),
    });

    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.message).toMatch(/organization member/i);
    expect(invitationCreateMock).not.toHaveBeenCalled();
  });

  it("rejects invite from guest", async () => {
    roomFindFirstMock.mockResolvedValue(
      externalRoom([memberUser(GUEST_ID, "guest")]),
    );

    const response = await createApp({
      actor: "user",
      userId: GUEST_ID,
      organizationId: "other_org",
      role: "user",
    }).request(`/${ROOM_ID}/invitations`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: "new@example.com" }),
    });

    expect(response.status).toBe(403);
    expect(invitationCreateMock).not.toHaveBeenCalled();
  });

  it("rejects invite on private room", async () => {
    roomFindFirstMock.mockResolvedValue(
      externalRoom([memberUser(MEMBER_ID, "member")], {
        discoverability: "private",
      }),
    );

    const response = await createApp().request(`/${ROOM_ID}/invitations`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: "guest@example.com" }),
    });

    expect(response.status).toBe(404);
    expect(invitationCreateMock).not.toHaveBeenCalled();
  });

  it("rejects duplicate pending invitation", async () => {
    invitationFindFirstMock.mockResolvedValue({ id: INVITE_ID });

    const response = await createApp().request(`/${ROOM_ID}/invitations`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: "guest@example.com" }),
    });

    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.message).toMatch(/pending invitation already exists/i);
    expect(invitationCreateMock).not.toHaveBeenCalled();
  });
});
