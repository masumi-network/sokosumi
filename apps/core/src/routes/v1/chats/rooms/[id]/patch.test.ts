import { OpenAPIHono } from "@hono/zod-openapi";
import type { RequestIdVariables } from "hono/request-id";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { errorHandler } from "@/helpers/error-handler";
import type { OpenAPIHonoWithAuth } from "@/lib/hono";
import { defaultValidationHook } from "@/lib/hono";
import type { AuthVariables } from "@/middleware/auth";

import mountPatchChatRoom from "./patch";

const {
  roomFindFirstMock,
  roomFindManyMock,
  roomUpdateMock,
  organizationFindUniqueMock,
  memberFindUniqueMock,
  memberFindManyMock,
  coworkerFindManyMock,
  userMemberDeleteManyMock,
  userMemberCreateManyMock,
  readStateDeleteManyMock,
  readStateCreateManyMock,
  coworkerMemberDeleteManyMock,
  coworkerMemberCreateManyMock,
  mentionUpdateManyMock,
  membershipFindManyMock,
  readStateFindManyMock,
  prismaTransactionMock,
} = vi.hoisted(() => ({
  roomFindFirstMock: vi.fn(),
  roomFindManyMock: vi.fn(),
  roomUpdateMock: vi.fn(),
  organizationFindUniqueMock: vi.fn(),
  memberFindUniqueMock: vi.fn(),
  memberFindManyMock: vi.fn(),
  coworkerFindManyMock: vi.fn(),
  userMemberDeleteManyMock: vi.fn(),
  userMemberCreateManyMock: vi.fn(),
  readStateDeleteManyMock: vi.fn(),
  readStateCreateManyMock: vi.fn(),
  coworkerMemberDeleteManyMock: vi.fn(),
  coworkerMemberCreateManyMock: vi.fn(),
  mentionUpdateManyMock: vi.fn(),
  membershipFindManyMock: vi.fn(),
  readStateFindManyMock: vi.fn(),
  prismaTransactionMock: vi.fn(),
}));

vi.mock("@/lib/db/prisma", () => ({
  default: {
    $transaction: prismaTransactionMock,
    chatRoomUserMember: {
      findMany: membershipFindManyMock,
    },
    chatRoomReadState: {
      findMany: readStateFindManyMock,
    },
  },
}));

const ROOM_ID = "550e8400-e29b-41d4-a716-446655440000";
const USER_ID = "user_123";
const OTHER_USER_ID = "user_456";
const ORG_ID = "org_1";

const tx = {
  chatRoom: {
    findFirst: roomFindFirstMock,
    findMany: roomFindManyMock,
    update: roomUpdateMock,
  },
  organization: {
    findUnique: organizationFindUniqueMock,
  },
  member: {
    findUnique: memberFindUniqueMock,
    findMany: memberFindManyMock,
  },
  coworker: {
    findMany: coworkerFindManyMock,
  },
  chatRoomUserMember: {
    deleteMany: userMemberDeleteManyMock,
    createMany: userMemberCreateManyMock,
  },
  chatRoomReadState: {
    deleteMany: readStateDeleteManyMock,
    createMany: readStateCreateManyMock,
  },
  chatRoomCoworkerMember: {
    deleteMany: coworkerMemberDeleteManyMock,
    createMany: coworkerMemberCreateManyMock,
  },
  chatRoomMention: {
    updateMany: mentionUpdateManyMock,
  },
};

function createApp(authContext: AuthVariables["authContext"]) {
  const app = new OpenAPIHono<{
    Variables: AuthVariables & RequestIdVariables;
  }>({
    defaultHook: defaultValidationHook,
  });

  app.use("*", async (c, next) => {
    c.set("requestId", "req_patch_chat_room");
    c.set("isAuthenticated", true);
    c.set("authContext", authContext);
    return await next();
  });

  app.onError(errorHandler);
  mountPatchChatRoom(app as unknown as OpenAPIHonoWithAuth);
  return app;
}

const userAuthContext: AuthVariables["authContext"] = {
  actor: "user",
  userId: USER_ID,
  organizationId: ORG_ID,
  role: "user",
};

function channelRoom(overrides: Record<string, unknown> = {}) {
  return {
    id: ROOM_ID,
    organizationId: ORG_ID,
    name: "Launch Room",
    slug: "launch-room",
    kind: "channel",
    directKey: null,
    topic: null,
    discoverability: "private",
    createdByUserId: USER_ID,
    createdAt: new Date("2025-01-01T00:00:00.000Z"),
    updatedAt: new Date("2025-01-01T00:00:00.000Z"),
    archivedAt: null,
    userMembers: [
      {
        user: {
          id: USER_ID,
          name: "Ada",
          email: "ada@example.com",
          image: null,
          sessions: [],
        },
      },
    ],
    coworkerMembers: [],
    ...overrides,
  };
}

function directRoom() {
  return channelRoom({
    name: "Bob",
    slug: "bob",
    kind: "direct",
    directKey: `${USER_ID}:${OTHER_USER_ID}`,
    discoverability: null,
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  prismaTransactionMock.mockImplementation(async (callback) => callback(tx));
  organizationFindUniqueMock.mockResolvedValue({ id: ORG_ID });
  memberFindUniqueMock.mockResolvedValue({ role: "member" });
  roomFindManyMock.mockResolvedValue([]);
  memberFindManyMock.mockImplementation(
    async ({ where }: { where: { userId: { in: string[] } } }) =>
      where.userId.in.map((userId) => ({ userId })),
  );
  coworkerFindManyMock.mockResolvedValue([]);
  membershipFindManyMock.mockResolvedValue([]);
  readStateFindManyMock.mockResolvedValue([]);
});

describe("PATCH /chats/rooms/{id}", () => {
  it("allows a non-creator member to PATCH roster-only", async () => {
    const existing = channelRoom({ createdByUserId: OTHER_USER_ID });
    const updated = channelRoom({ createdByUserId: OTHER_USER_ID });
    roomFindFirstMock.mockResolvedValueOnce(existing);
    memberFindUniqueMock.mockResolvedValue({ role: "member" });
    roomUpdateMock.mockResolvedValueOnce(updated);
    userMemberDeleteManyMock.mockResolvedValue({ count: 1 });
    userMemberCreateManyMock.mockResolvedValue({ count: 2 });
    readStateDeleteManyMock.mockResolvedValue({ count: 0 });
    readStateCreateManyMock.mockResolvedValue({ count: 0 });

    const app = createApp(userAuthContext);
    const response = await app.request(`/${ROOM_ID}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        memberUserIds: [USER_ID, OTHER_USER_ID],
      }),
    });

    expect(response.status).toBe(200);
    expect(userMemberCreateManyMock).toHaveBeenCalled();
    expect(roomUpdateMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: ROOM_ID },
        data: {},
      }),
    );
  });

  it("rejects a non-creator member PATCH that touches settings", async () => {
    roomFindFirstMock.mockResolvedValueOnce(
      channelRoom({ createdByUserId: OTHER_USER_ID }),
    );
    memberFindUniqueMock.mockResolvedValue({ role: "member" });

    const app = createApp(userAuthContext);
    const response = await app.request(`/${ROOM_ID}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "Nope" }),
    });

    expect(response.status).toBe(403);
    const text = await response.text();
    expect(text).toMatch(/organization owner or admin/i);
    expect(text).not.toMatch(/creator/i);
    expect(roomUpdateMock).not.toHaveBeenCalled();
    expect(userMemberDeleteManyMock).not.toHaveBeenCalled();
  });

  it("rejects a creator who is only a plain member from PATCH settings", async () => {
    roomFindFirstMock.mockResolvedValueOnce(channelRoom());
    memberFindUniqueMock.mockResolvedValue({ role: "member" });

    const app = createApp(userAuthContext);
    const response = await app.request(`/${ROOM_ID}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        name: "Ship Room",
        topic: "Go live checklist",
      }),
    });

    expect(response.status).toBe(403);
    expect(roomUpdateMock).not.toHaveBeenCalled();
  });

  it("updates channel settings when the caller is an organization admin", async () => {
    const existing = channelRoom({
      createdByUserId: OTHER_USER_ID,
      discoverability: "private",
    });
    const updated = channelRoom({
      createdByUserId: OTHER_USER_ID,
      name: "Ship Room",
      slug: "ship-room",
      topic: "Go live checklist",
      discoverability: "public",
    });
    roomFindFirstMock.mockResolvedValueOnce(existing);
    memberFindUniqueMock.mockResolvedValue({ role: "admin" });
    roomUpdateMock.mockResolvedValueOnce(updated);

    const app = createApp(userAuthContext);
    const response = await app.request(`/${ROOM_ID}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        name: "Ship Room",
        topic: "Go live checklist",
        discoverability: "public",
      }),
    });

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.data.name).toBe("Ship Room");
    expect(body.data.discoverability).toBe("public");
    expect(roomUpdateMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: ROOM_ID },
        data: {
          name: "Ship Room",
          slug: "ship-room",
          topic: "Go live checklist",
          discoverability: "public",
        },
      }),
    );
  });

  it("rejects direct room edits with 400", async () => {
    roomFindFirstMock.mockResolvedValueOnce(directRoom());

    const app = createApp(userAuthContext);
    const response = await app.request(`/${ROOM_ID}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "Nope" }),
    });

    expect(response.status).toBe(400);
    expect(await response.text()).toContain("Direct rooms cannot be edited.");
    expect(roomUpdateMock).not.toHaveBeenCalled();
  });

  it("rejects unknown rooms with 404", async () => {
    roomFindFirstMock.mockResolvedValueOnce(null);

    const app = createApp(userAuthContext);
    const response = await app.request(`/${ROOM_ID}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "Nope" }),
    });

    expect(response.status).toBe(404);
    expect(await response.text()).toContain("Room not found");
    expect(roomUpdateMock).not.toHaveBeenCalled();
  });

  it("fails open mentions when coworkers are removed from the roster", async () => {
    const existing = channelRoom();
    const keptCoworkerId = "cow_keep";
    const updated = channelRoom({
      coworkerMembers: [
        {
          coworker: {
            id: keptCoworkerId,
            name: "Kept",
            slug: "kept",
            image: null,
          },
        },
      ],
    });
    roomFindFirstMock.mockResolvedValueOnce(existing);
    coworkerFindManyMock.mockResolvedValue([{ id: keptCoworkerId }]);
    roomUpdateMock.mockResolvedValueOnce(updated);
    mentionUpdateManyMock.mockResolvedValue({ count: 1 });
    coworkerMemberDeleteManyMock.mockResolvedValue({ count: 1 });
    coworkerMemberCreateManyMock.mockResolvedValue({ count: 1 });

    const app = createApp(userAuthContext);
    const response = await app.request(`/${ROOM_ID}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ coworkerIds: [keptCoworkerId] }),
    });

    expect(response.status).toBe(200);
    expect(mentionUpdateManyMock).toHaveBeenCalledWith({
      where: {
        status: { in: ["pending", "sent"] },
        coworkerId: { notIn: [keptCoworkerId] },
        message: { roomId: ROOM_ID },
      },
      data: {
        status: "failed",
        error: "Coworker is no longer a member of this room",
      },
    });
    expect(coworkerMemberDeleteManyMock).toHaveBeenCalledWith({
      where: { roomId: ROOM_ID },
    });
  });
});
