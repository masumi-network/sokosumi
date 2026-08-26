import { OpenAPIHono } from "@hono/zod-openapi";
import { CHANNEL_SLUG_MAX_LENGTH, CORE_API_ERROR_KINDS } from "@sokosumi/utils";
import type { RequestIdVariables } from "hono/request-id";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { errorHandler } from "@/helpers/error-handler";
import type { OpenAPIHonoWithAuth } from "@/lib/hono";
import { defaultValidationHook } from "@/lib/hono";
import type { AuthVariables } from "@/middleware/auth";

import mountPostChatRooms from "./post";

const {
  roomFindFirstMock,
  roomFindManyMock,
  roomCreateMock,
  roomUpdateMock,
  organizationFindUniqueMock,
  memberFindUniqueMock,
  memberFindManyMock,
  userFindManyMock,
  coworkerFindManyMock,
  workspaceFindUniqueMock,
  membershipFindManyMock,
  readStateFindManyMock,
  prismaTransactionMock,
} = vi.hoisted(() => ({
  roomFindFirstMock: vi.fn(),
  roomFindManyMock: vi.fn(),
  roomCreateMock: vi.fn(),
  roomUpdateMock: vi.fn(),
  organizationFindUniqueMock: vi.fn(),
  memberFindUniqueMock: vi.fn(),
  memberFindManyMock: vi.fn(),
  userFindManyMock: vi.fn(),
  coworkerFindManyMock: vi.fn(),
  workspaceFindUniqueMock: vi.fn(),
  membershipFindManyMock: vi.fn(),
  readStateFindManyMock: vi.fn(),
  prismaTransactionMock: vi.fn(),
}));

vi.mock("@/lib/db/prisma", () => ({
  default: {
    $transaction: prismaTransactionMock,
    chatRoom: {
      findFirst: roomFindFirstMock,
      update: roomUpdateMock,
    },
    chatRoomUserMember: {
      findMany: membershipFindManyMock,
    },
    chatRoomReadState: {
      findMany: readStateFindManyMock,
    },
    chatRoomPinnedMessage: {
      groupBy: vi.fn().mockResolvedValue([]),
    },
    member: {
      findMany: memberFindManyMock,
    },
  },
}));

const ROOM_ID = "550e8400-e29b-41d4-a716-446655440000";
const USER_ID = "user_123";
const OTHER_USER_ID = "user_456";
const THIRD_USER_ID = "user_789";
const ORG_ID = "org_1";
const GROUP_DIRECT_KEY = "direct:v2:user:user_123:user:user_456:user:user_789";

const ORG_WORKSPACE_ID = "ws_org_1";
const PERSONAL_WORKSPACE_ID = "ws_user_123";

const tx = {
  chatRoom: {
    findFirst: roomFindFirstMock,
    findMany: roomFindManyMock,
    create: roomCreateMock,
    update: roomUpdateMock,
  },
  organization: {
    findUnique: organizationFindUniqueMock,
  },
  member: {
    findUnique: memberFindUniqueMock,
    findMany: memberFindManyMock,
  },
  user: {
    findMany: userFindManyMock,
  },
  coworker: {
    findMany: coworkerFindManyMock,
  },
  workspace: {
    findUnique: workspaceFindUniqueMock,
  },
};

function createApp(authContext: AuthVariables["authContext"]) {
  const app = new OpenAPIHono<{ Variables: AuthVariables }>({
    defaultHook: defaultValidationHook,
  });

  app.use("*", async (c, next) => {
    c.set("isAuthenticated", true);
    c.set("authContext", authContext);
    return await next();
  });

  mountPostChatRooms(app as unknown as OpenAPIHonoWithAuth);
  return app;
}

function createAppWithErrorHandler(authContext: AuthVariables["authContext"]) {
  const app = new OpenAPIHono<{
    Variables: AuthVariables & RequestIdVariables;
  }>({
    defaultHook: defaultValidationHook,
  });

  app.use("*", async (c, next) => {
    c.set("requestId", "req_post_chat_room");
    c.set("isAuthenticated", true);
    c.set("authContext", authContext);
    return await next();
  });
  app.onError(errorHandler);
  mountPostChatRooms(app as unknown as OpenAPIHonoWithAuth);
  return app;
}

const COWORKER_ID = "cow_123";
const COWORKER_DIRECT_KEY = `coworker:${OTHER_USER_ID}:${COWORKER_ID}`;

const userAuthContext: AuthVariables["authContext"] = {
  actor: "user",
  userId: USER_ID,
  organizationId: ORG_ID,
  role: "user",
};

const coworkerAuthContext: AuthVariables["authContext"] = {
  actor: "coworker",
  coworkerId: COWORKER_ID,
  vendorId: "01960001-0001-7001-8001-000000000001",
  context: { userId: USER_ID, organizationId: ORG_ID },
};

const DIRECT_KEY = `${USER_ID}:${OTHER_USER_ID}`;

function channelRoom(overrides: Record<string, unknown> = {}) {
  return {
    id: ROOM_ID,
    organizationId: ORG_ID,
    name: "Launch Room",
    slug: "launch-room",
    kind: "channel",
    directKey: null,
    topic: null,
    discoverability: "public",
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

function directRoom(overrides: Record<string, unknown> = {}) {
  return channelRoom({
    name: "Bob",
    slug: null,
    kind: "direct",
    directKey: DIRECT_KEY,
    discoverability: null,
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
      {
        user: {
          id: OTHER_USER_ID,
          name: "Bob",
          email: "bob@example.com",
          image: null,
          sessions: [],
        },
      },
    ],
    ...overrides,
  });
}

function coworkerDirectRoom(overrides: Record<string, unknown> = {}) {
  return directRoom({
    name: "Elena",
    slug: null,
    directKey: COWORKER_DIRECT_KEY,
    createdByUserId: OTHER_USER_ID,
    userMembers: [
      {
        user: {
          id: OTHER_USER_ID,
          name: "Bob",
          email: "bob@example.com",
          image: null,
          sessions: [],
        },
      },
    ],
    coworkerMembers: [
      {
        coworker: {
          id: COWORKER_ID,
          name: "Elena",
          slug: "elena",
          caption: null,
          image: null,
        },
      },
    ],
    ...overrides,
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  roomFindFirstMock.mockReset();
  roomCreateMock.mockReset();
  prismaTransactionMock.mockImplementation(async (callback) => callback(tx));
  organizationFindUniqueMock.mockResolvedValue({ id: ORG_ID });
  memberFindUniqueMock.mockResolvedValue({ role: "member" });
  roomFindManyMock.mockResolvedValue([]);
  memberFindManyMock.mockImplementation(
    async ({ where }: { where: { userId: { in: string[] } } }) =>
      where.userId.in.map((userId) => ({ userId })),
  );
  coworkerFindManyMock.mockResolvedValue([]);
  workspaceFindUniqueMock.mockImplementation(
    async ({
      where,
    }: {
      where: { organizationId?: string; userId?: string };
    }) => {
      if (where.organizationId) {
        return { id: ORG_WORKSPACE_ID };
      }
      if (where.userId) {
        return { id: PERSONAL_WORKSPACE_ID };
      }
      return null;
    },
  );
  userFindManyMock.mockResolvedValue([
    { id: OTHER_USER_ID, name: "Bob", email: "bob@example.com" },
  ]);
  membershipFindManyMock.mockResolvedValue([]);
  readStateFindManyMock.mockResolvedValue([]);
});

describe("POST /chats/rooms", () => {
  it("creates a channel room with 201", async () => {
    roomCreateMock.mockResolvedValue(channelRoom());

    const app = createApp(userAuthContext);
    const response = await app.request("/", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        kind: "channel",
        name: "Launch Room",
        slug: "launch-room",
      }),
    });

    expect(response.status).toBe(201);
    const body = await response.json();
    expect(body.data.kind).toBe("channel");
    expect(body.data.name).toBe("Launch Room");
    expect(body.data.slug).toBe("launch-room");
    expect(body.data.discoverability).toBe("public");
    expect(roomCreateMock).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          organizationId: ORG_ID,
          name: "Launch Room",
          slug: "launch-room",
          discoverability: "public",
        }),
      }),
    );
  });

  it("stores the submitted Channel slug instead of deriving one from the name", async () => {
    roomCreateMock.mockResolvedValue(
      channelRoom({ name: "Team Soko", slug: "soko" }),
    );

    const app = createApp(userAuthContext);
    const response = await app.request("/", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        kind: "channel",
        name: "Team Soko",
        slug: "soko",
      }),
    });

    expect(response.status).toBe(201);
    const body = await response.json();
    expect(body.data.slug).toBe("soko");
    expect(roomCreateMock).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          name: "Team Soko",
          slug: "soko",
        }),
      }),
    );
  });

  it("sanitizes a submitted Channel slug with kebab rules", async () => {
    roomCreateMock.mockResolvedValue(
      channelRoom({ name: "Engineering", slug: "team-soko" }),
    );

    const app = createApp(userAuthContext);
    const response = await app.request("/", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        kind: "channel",
        name: "Engineering",
        slug: " Team Soko ",
      }),
    });

    expect(response.status).toBe(201);
    expect(roomCreateMock).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          slug: "team-soko",
        }),
      }),
    );
  });

  it("derives the Channel name from the slug when name is omitted", async () => {
    roomCreateMock.mockResolvedValue(
      channelRoom({ name: "Team Soko", slug: "team-soko" }),
    );

    const app = createApp(userAuthContext);
    const response = await app.request("/", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        kind: "channel",
        slug: "team-soko",
      }),
    });

    expect(response.status).toBe(201);
    expect(roomCreateMock).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          name: "Team Soko",
          slug: "team-soko",
        }),
      }),
    );
  });

  it("derives the Channel name from the slug when name is blank", async () => {
    roomCreateMock.mockResolvedValue(
      channelRoom({ name: "Welcome", slug: "welcome" }),
    );

    const app = createApp(userAuthContext);
    const response = await app.request("/", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        kind: "channel",
        name: "   ",
        slug: "welcome",
      }),
    });

    expect(response.status).toBe(201);
    expect(roomCreateMock).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          name: "Welcome",
          slug: "welcome",
        }),
      }),
    );
  });

  it("rejects channel create without a slug", async () => {
    const app = createApp(userAuthContext);
    const response = await app.request("/", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        kind: "channel",
        name: "Team Soko",
      }),
    });

    expect(response.status).toBe(400);
    expect(await response.text()).toBe("Channel slug is required");
    expect(roomCreateMock).not.toHaveBeenCalled();
  });

  it("rejects a Channel slug longer than 80 after sanitize", async () => {
    const app = createApp(userAuthContext);
    const response = await app.request("/", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        kind: "channel",
        name: "Team Soko",
        slug: "a".repeat(CHANNEL_SLUG_MAX_LENGTH + 1),
      }),
    });

    expect(response.status).toBe(400);
    expect(await response.text()).toBe("Channel slug is invalid");
    expect(roomCreateMock).not.toHaveBeenCalled();
  });

  it("accepts a Channel slug of exactly 80 characters", async () => {
    const slug = "a".repeat(CHANNEL_SLUG_MAX_LENGTH);
    roomCreateMock.mockResolvedValue(channelRoom({ slug }));

    const app = createApp(userAuthContext);
    const response = await app.request("/", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        kind: "channel",
        name: "Team Soko",
        slug,
      }),
    });

    expect(response.status).toBe(201);
    expect(roomCreateMock).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ slug }),
      }),
    );
  });

  it("rejects a Channel slug that is empty after sanitize", async () => {
    const app = createApp(userAuthContext);
    const response = await app.request("/", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        kind: "channel",
        name: "Team Soko",
        slug: "---",
      }),
    });

    expect(response.status).toBe(400);
    expect(await response.text()).toBe("Channel slug is invalid");
    expect(roomCreateMock).not.toHaveBeenCalled();
  });

  it("returns 409 Channel slug taken when the unique index is occupied", async () => {
    roomCreateMock.mockRejectedValue({
      code: "P2002",
      meta: { target: ["organizationId", "slug"] },
    });

    const app = createAppWithErrorHandler(userAuthContext);
    const response = await app.request("/", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        kind: "channel",
        name: "Team Soko",
        slug: "team-soko",
      }),
    });

    expect(response.status).toBe(409);
    const body = await response.json();
    expect(body.kind).toBe(CORE_API_ERROR_KINDS.CHANNEL_SLUG_TAKEN);
    expect(body.message).toBe("This Channel slug is taken.");
    expect(roomCreateMock).toHaveBeenCalledTimes(1);
  });

  it("does not suffix a Channel slug when another Channel already holds the base", async () => {
    roomCreateMock.mockRejectedValue({
      code: "P2002",
      meta: { target: ["organizationId", "slug"] },
    });

    const app = createAppWithErrorHandler(userAuthContext);
    const response = await app.request("/", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        kind: "channel",
        name: "Team Soko",
        slug: "team-soko",
      }),
    });

    expect(response.status).toBe(409);
    const body = await response.json();
    expect(body.kind).toBe(CORE_API_ERROR_KINDS.CHANNEL_SLUG_TAKEN);
    expect(body.message).toBe("This Channel slug is taken.");
    expect(roomCreateMock).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          slug: "team-soko",
        }),
      }),
    );
  });

  it("persists explicit private discoverability on channel create", async () => {
    roomCreateMock.mockResolvedValue(
      channelRoom({ discoverability: "private" }),
    );

    const app = createApp(userAuthContext);
    const response = await app.request("/", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        kind: "channel",
        name: "Launch Room",
        slug: "launch-room",
        discoverability: "private",
      }),
    });

    expect(response.status).toBe(201);
    const body = await response.json();
    expect(body.data.discoverability).toBe("private");
    expect(roomCreateMock).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          discoverability: "private",
        }),
      }),
    );
  });

  it("creates external channel for owner", async () => {
    memberFindUniqueMock.mockResolvedValue({ role: "owner" });
    roomCreateMock.mockResolvedValue(
      channelRoom({ discoverability: "external", name: "Client" }),
    );

    const app = createApp(userAuthContext);
    const response = await app.request("/", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        kind: "channel",
        name: "Client",
        slug: "client",
        discoverability: "external",
      }),
    });

    expect(response.status).toBe(201);
    const body = await response.json();
    expect(body.data.discoverability).toBe("external");
    expect(roomCreateMock).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          discoverability: "external",
          userMembers: {
            create: [{ userId: USER_ID, access: "member" }],
          },
        }),
      }),
    );
  });

  it("creates external channel for admin", async () => {
    memberFindUniqueMock.mockResolvedValue({ role: "admin" });
    roomCreateMock.mockResolvedValue(
      channelRoom({ discoverability: "external", name: "Client" }),
    );

    const app = createApp(userAuthContext);
    const response = await app.request("/", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        kind: "channel",
        name: "Client",
        slug: "client",
        discoverability: "external",
      }),
    });

    expect(response.status).toBe(201);
    const body = await response.json();
    expect(body.data.discoverability).toBe("external");
  });

  it("rejects external channel create for plain member", async () => {
    memberFindUniqueMock.mockResolvedValue({ role: "member" });

    const app = createApp(userAuthContext);
    const response = await app.request("/", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        kind: "channel",
        name: "Client",
        slug: "client",
        discoverability: "external",
      }),
    });

    expect(response.status).toBe(403);
    expect(await response.text()).toBe(
      "Only an organization owner or admin can create external channels.",
    );
    expect(roomCreateMock).not.toHaveBeenCalled();
  });

  it("seeds channel members with access member on public create", async () => {
    roomCreateMock.mockResolvedValue(channelRoom());

    const app = createApp(userAuthContext);
    const response = await app.request("/", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        kind: "channel",
        name: "Launch Room",
        slug: "launch-room",
      }),
    });

    expect(response.status).toBe(201);
    expect(roomCreateMock).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          userMembers: {
            create: [{ userId: USER_ID, access: "member" }],
          },
        }),
      }),
    );
  });

  it("rejects a slug on direct create", async () => {
    const app = createApp(userAuthContext);
    const response = await app.request("/", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        kind: "direct",
        memberUserIds: [OTHER_USER_ID],
        slug: "elena",
      }),
    });

    expect(response.status).toBe(422);
    expect(roomCreateMock).not.toHaveBeenCalled();
  });

  it("rejects discoverability on direct create", async () => {
    const app = createApp(userAuthContext);
    const response = await app.request("/", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        kind: "direct",
        memberUserIds: [OTHER_USER_ID],
        discoverability: "public",
      }),
    });

    expect(response.status).toBe(422);
    expect(roomCreateMock).not.toHaveBeenCalled();
  });

  it("creates a direct room with 201, then returns existing with 200", async () => {
    const created = directRoom();
    roomFindFirstMock.mockResolvedValueOnce(null);
    roomCreateMock.mockResolvedValueOnce(created);

    const app = createApp(userAuthContext);
    const createResponse = await app.request("/", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        kind: "direct",
        memberUserIds: [OTHER_USER_ID],
      }),
    });

    expect(createResponse.status).toBe(201);
    const createdBody = await createResponse.json();
    expect(createdBody.data.kind).toBe("direct");
    expect(createdBody.data.id).toBe(ROOM_ID);
    expect(createdBody.data.organizationId).toBe(ORG_ID);
    expect(roomCreateMock).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          organizationId: ORG_ID,
          kind: "direct",
          slug: null,
        }),
      }),
    );

    roomFindFirstMock.mockResolvedValueOnce(created);

    const getResponse = await app.request("/", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        kind: "direct",
        memberUserIds: [OTHER_USER_ID],
      }),
    });

    expect(getResponse.status).toBe(200);
    const getBody = await getResponse.json();
    expect(getBody.data.id).toBe(ROOM_ID);
    expect(roomCreateMock).toHaveBeenCalledTimes(1);
  });

  it("creates a personal coworker direct without an active organization", async () => {
    const coworkerId = "cow_123";
    const created = directRoom({
      organizationId: null,
      name: "Elena",
      slug: null,
      directKey: `coworker:${USER_ID}:${coworkerId}`,
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
      coworkerMembers: [
        {
          coworker: {
            id: coworkerId,
            name: "Elena",
            slug: "elena",
            caption: null,
            image: null,
          },
        },
      ],
    });
    roomFindFirstMock.mockResolvedValueOnce(null);
    roomCreateMock.mockResolvedValueOnce(created);
    coworkerFindManyMock.mockResolvedValue([
      { id: coworkerId, baseURL: "https://chat.example.com" },
    ]);

    const app = createApp({
      ...userAuthContext,
      organizationId: null,
    });
    const response = await app.request("/", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        kind: "direct",
        coworkerIds: [coworkerId],
      }),
    });

    expect(response.status).toBe(201);
    const body = await response.json();
    expect(body.data.organizationId).toBeNull();
    expect(body.data.kind).toBe("direct");
    expect(roomCreateMock).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          organizationId: null,
          kind: "direct",
        }),
      }),
    );
  });

  it("scopes coworker direct to the active organization when set", async () => {
    const coworkerId = "cow_123";
    const created = directRoom({
      organizationId: ORG_ID,
      name: "Elena",
      slug: null,
      directKey: `coworker:${USER_ID}:${coworkerId}`,
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
      coworkerMembers: [
        {
          coworker: {
            id: coworkerId,
            name: "Elena",
            slug: "elena",
            caption: null,
            image: null,
          },
        },
      ],
    });
    organizationFindUniqueMock.mockResolvedValue({ id: ORG_ID });
    memberFindUniqueMock.mockResolvedValue({ role: "member" });
    roomFindFirstMock.mockResolvedValueOnce(null);
    roomCreateMock.mockResolvedValueOnce(created);
    coworkerFindManyMock.mockResolvedValue([
      { id: coworkerId, baseURL: "https://chat.example.com" },
    ]);

    const app = createApp(userAuthContext);
    const response = await app.request("/", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        kind: "direct",
        coworkerIds: [coworkerId],
      }),
    });

    expect(response.status).toBe(201);
    const body = await response.json();
    expect(body.data.organizationId).toBe(ORG_ID);
    expect(roomCreateMock).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          organizationId: ORG_ID,
          kind: "direct",
        }),
      }),
    );
  });

  it("rejects human direct without an active organization or shared external channel with 400", async () => {
    roomFindFirstMock.mockResolvedValue(null);
    const app = createApp({
      ...userAuthContext,
      organizationId: null,
    });
    const response = await app.request("/", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        kind: "direct",
        memberUserIds: [OTHER_USER_ID],
      }),
    });

    expect(response.status).toBe(400);
    expect(await response.text()).toBe(
      "You can only message people you share an external channel with.",
    );
    expect(roomCreateMock).not.toHaveBeenCalled();
  });

  it("creates a personal 1:1 direct when callers share an external channel and have no org", async () => {
    const created = directRoom({
      organizationId: null,
    });
    roomFindFirstMock.mockImplementation(
      async ({
        where,
      }: {
        where?: { discoverability?: string; organizationId?: string | null };
      }) => {
        if (where?.discoverability === "external") {
          return { id: "ext-room" };
        }
        return null;
      },
    );
    roomCreateMock.mockResolvedValueOnce(created);

    const app = createApp({
      ...userAuthContext,
      organizationId: null,
    });
    const response = await app.request("/", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        kind: "direct",
        memberUserIds: [OTHER_USER_ID],
      }),
    });

    expect(response.status).toBe(201);
    const body = await response.json();
    expect(body.data.organizationId).toBeNull();
    expect(body.data.kind).toBe("direct");
    expect(roomCreateMock).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          organizationId: null,
          kind: "direct",
          directKey: DIRECT_KEY,
        }),
      }),
    );
    expect(roomFindFirstMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          kind: "channel",
          discoverability: "external",
          archivedAt: null,
          AND: [
            { userMembers: { some: { userId: USER_ID } } },
            { userMembers: { some: { userId: OTHER_USER_ID } } },
          ],
        },
        select: { id: true },
      }),
    );
    expect(workspaceFindUniqueMock).not.toHaveBeenCalled();
  });

  it("creates a personal 1:1 when the target is not an org member but shares an external channel", async () => {
    const created = directRoom({
      organizationId: null,
    });
    memberFindManyMock.mockResolvedValue([]);
    roomFindFirstMock.mockImplementation(
      async ({
        where,
      }: {
        where?: { discoverability?: string; organizationId?: string | null };
      }) => {
        if (where?.discoverability === "external") {
          return { id: "ext-room" };
        }
        return null;
      },
    );
    roomCreateMock.mockResolvedValueOnce(created);

    const app = createApp(userAuthContext);
    const response = await app.request("/", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        kind: "direct",
        memberUserIds: [OTHER_USER_ID],
      }),
    });

    expect(response.status).toBe(201);
    const body = await response.json();
    expect(body.data.organizationId).toBeNull();
    expect(roomCreateMock).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          organizationId: null,
          kind: "direct",
        }),
      }),
    );
  });

  it("returns an existing personal 1:1 after the pair no longer share an external channel", async () => {
    const existingPersonal = directRoom({
      organizationId: null,
    });
    roomFindFirstMock.mockImplementation(
      async ({
        where,
      }: {
        where?: { discoverability?: string; organizationId?: string | null };
      }) => {
        if (where?.organizationId === null) {
          return existingPersonal;
        }
        return null;
      },
    );

    const app = createApp({
      ...userAuthContext,
      organizationId: null,
    });
    const response = await app.request("/", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        kind: "direct",
        memberUserIds: [OTHER_USER_ID],
      }),
    });

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.data.id).toBe(ROOM_ID);
    expect(body.data.organizationId).toBeNull();
    expect(roomCreateMock).not.toHaveBeenCalled();
  });

  it("returns an existing personal 1:1 when org teammates message each other", async () => {
    const existingPersonal = directRoom({
      organizationId: null,
    });
    roomFindFirstMock.mockImplementation(
      async ({ where }: { where?: { organizationId?: string | null } }) => {
        if (where?.organizationId === null) {
          return existingPersonal;
        }
        return null;
      },
    );

    const app = createApp(userAuthContext);
    const response = await app.request("/", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        kind: "direct",
        memberUserIds: [OTHER_USER_ID],
      }),
    });

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.data.id).toBe(ROOM_ID);
    expect(body.data.organizationId).toBeNull();
    expect(roomCreateMock).not.toHaveBeenCalled();
  });

  it("rejects a non-teammate 1:1 without a shared external channel with 400", async () => {
    memberFindManyMock.mockResolvedValue([]);
    roomFindFirstMock.mockResolvedValue(null);

    const app = createApp(userAuthContext);
    const response = await app.request("/", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        kind: "direct",
        memberUserIds: [OTHER_USER_ID],
      }),
    });

    expect(response.status).toBe(400);
    expect(await response.text()).toBe(
      "You can only message people you share an external channel with.",
    );
    expect(roomCreateMock).not.toHaveBeenCalled();
  });

  it("rejects empty direct targets with 400", async () => {
    const app = createApp(userAuthContext);
    const response = await app.request("/", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        kind: "direct",
        memberUserIds: [],
        coworkerIds: [],
      }),
    });

    expect(response.status).toBe(400);
    expect(await response.text()).toBe("Choose a direct message target");
    expect(roomCreateMock).not.toHaveBeenCalled();
  });

  it("creates a multi-human group direct with 201 and direct:v2 key", async () => {
    const created = directRoom({
      name: "Bob, Carol",
      directKey: GROUP_DIRECT_KEY,
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
        {
          user: {
            id: OTHER_USER_ID,
            name: "Bob",
            email: "bob@example.com",
            image: null,
            sessions: [],
          },
        },
        {
          user: {
            id: THIRD_USER_ID,
            name: "Carol",
            email: "carol@example.com",
            image: null,
            sessions: [],
          },
        },
      ],
    });
    roomFindFirstMock.mockResolvedValueOnce(null);
    roomCreateMock.mockResolvedValueOnce(created);
    userFindManyMock.mockResolvedValue([
      { id: OTHER_USER_ID, name: "Bob", email: "bob@example.com" },
      { id: THIRD_USER_ID, name: "Carol", email: "carol@example.com" },
    ]);

    const app = createApp(userAuthContext);
    const response = await app.request("/", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        kind: "direct",
        memberUserIds: [OTHER_USER_ID, THIRD_USER_ID],
        coworkerIds: [],
      }),
    });

    expect(response.status).toBe(201);
    const body = await response.json();
    expect(body.data.kind).toBe("direct");
    expect(body.data.directKey).toBe(GROUP_DIRECT_KEY);
    expect(body.data.directKey.startsWith("direct:v2:")).toBe(true);
    expect(
      body.data.userMembers.map((m: { id: string }) => m.id).sort(),
    ).toEqual([USER_ID, OTHER_USER_ID, THIRD_USER_ID].sort());
    expect(roomCreateMock).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          kind: "direct",
          slug: null,
          directKey: GROUP_DIRECT_KEY,
          userMembers: {
            create: expect.arrayContaining([
              { userId: USER_ID },
              { userId: OTHER_USER_ID },
              { userId: THIRD_USER_ID },
            ]),
          },
        }),
      }),
    );
  });

  it("returns the same group direct room for the same member set with 200", async () => {
    const existing = directRoom({
      name: "Bob, Carol",
      directKey: GROUP_DIRECT_KEY,
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
        {
          user: {
            id: OTHER_USER_ID,
            name: "Bob",
            email: "bob@example.com",
            image: null,
            sessions: [],
          },
        },
        {
          user: {
            id: THIRD_USER_ID,
            name: "Carol",
            email: "carol@example.com",
            image: null,
            sessions: [],
          },
        },
      ],
    });
    roomFindFirstMock.mockResolvedValueOnce(null);
    roomCreateMock.mockResolvedValueOnce(existing);

    userFindManyMock.mockResolvedValue([
      { id: OTHER_USER_ID, name: "Bob", email: "bob@example.com" },
      { id: THIRD_USER_ID, name: "Carol", email: "carol@example.com" },
    ]);

    const app = createApp(userAuthContext);
    const createResponse = await app.request("/", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        kind: "direct",
        memberUserIds: [OTHER_USER_ID, THIRD_USER_ID],
      }),
    });
    expect(createResponse.status).toBe(201);

    roomFindFirstMock.mockResolvedValueOnce(existing);

    const getResponse = await app.request("/", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        kind: "direct",
        memberUserIds: [THIRD_USER_ID, OTHER_USER_ID],
      }),
    });

    expect(getResponse.status).toBe(200);
    const getBody = await getResponse.json();
    expect(getBody.data.id).toBe(ROOM_ID);
    expect(getBody.data.directKey).toBe(GROUP_DIRECT_KEY);
    expect(roomCreateMock).toHaveBeenCalledTimes(1);
    expect(roomFindFirstMock).toHaveBeenLastCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          organizationId: null,
          directKey: GROUP_DIRECT_KEY,
        }),
      }),
    );
  });

  it("uses an order-independent directKey for multi-human group directs", async () => {
    const created = directRoom({
      name: "Bob, Carol",
      directKey: GROUP_DIRECT_KEY,
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
        {
          user: {
            id: OTHER_USER_ID,
            name: "Bob",
            email: "bob@example.com",
            image: null,
            sessions: [],
          },
        },
        {
          user: {
            id: THIRD_USER_ID,
            name: "Carol",
            email: "carol@example.com",
            image: null,
            sessions: [],
          },
        },
      ],
    });
    roomFindFirstMock.mockResolvedValueOnce(null);
    roomCreateMock.mockResolvedValueOnce(created);
    userFindManyMock.mockResolvedValue([
      { id: THIRD_USER_ID, name: "Carol", email: "carol@example.com" },
      { id: OTHER_USER_ID, name: "Bob", email: "bob@example.com" },
    ]);

    const app = createApp(userAuthContext);
    const response = await app.request("/", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        kind: "direct",
        memberUserIds: [THIRD_USER_ID, OTHER_USER_ID],
      }),
    });

    expect(response.status).toBe(201);
    expect(roomCreateMock).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          directKey: GROUP_DIRECT_KEY,
        }),
      }),
    );
  });

  it("rejects multi-human group direct without an active organization with 400", async () => {
    const app = createApp({
      ...userAuthContext,
      organizationId: null,
    });
    const response = await app.request("/", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        kind: "direct",
        memberUserIds: [OTHER_USER_ID, THIRD_USER_ID],
      }),
    });

    expect(response.status).toBe(400);
    expect(await response.text()).toBe(
      "Switch to an organization to message a teammate.",
    );
    expect(roomCreateMock).not.toHaveBeenCalled();
  });

  it("rejects human plus coworker direct targets with 400", async () => {
    const app = createApp(userAuthContext);
    const response = await app.request("/", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        kind: "direct",
        memberUserIds: [OTHER_USER_ID],
        coworkerIds: ["cow_123"],
      }),
    });

    expect(response.status).toBe(400);
    expect(await response.text()).toBe(
      "Group direct messages cannot include coworkers.",
    );
    expect(roomCreateMock).not.toHaveBeenCalled();
  });

  it("rejects multi-coworker direct targets with 400", async () => {
    const app = createApp(userAuthContext);
    const response = await app.request("/", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        kind: "direct",
        coworkerIds: ["cow_123", "cow_456"],
      }),
    });

    expect(response.status).toBe(400);
    expect(await response.text()).toBe(
      "Direct messages support one coworker only.",
    );
    expect(roomCreateMock).not.toHaveBeenCalled();
  });

  it("rejects listing the current user as a direct member with 400", async () => {
    const app = createApp(userAuthContext);
    const response = await app.request("/", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        kind: "direct",
        memberUserIds: [USER_ID],
      }),
    });

    expect(response.status).toBe(400);
    expect(await response.text()).toBe("Choose another organization member");
    expect(roomCreateMock).not.toHaveBeenCalled();
  });

  it("re-reads and returns 200 when a directKey unique race wins", async () => {
    const existing = directRoom();
    roomFindFirstMock
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(existing);
    roomCreateMock.mockRejectedValue({
      code: "P2002",
      meta: { target: ["organizationId", "directKey"] },
    });

    const app = createApp(userAuthContext);
    const response = await app.request("/", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        kind: "direct",
        memberUserIds: [OTHER_USER_ID],
      }),
    });

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.data.id).toBe(ROOM_ID);
    expect(roomFindFirstMock).toHaveBeenCalledTimes(4);
    expect(roomFindFirstMock).toHaveBeenLastCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          organizationId: ORG_ID,
          directKey: DIRECT_KEY,
        }),
      }),
    );
  });

  describe("coworker actor", () => {
    it("creates an org-scoped coworker 1:1 with the target as createdByUserId when context user differs", async () => {
      const created = coworkerDirectRoom();
      roomFindFirstMock.mockResolvedValueOnce(null);
      roomCreateMock.mockResolvedValueOnce(created);
      coworkerFindManyMock.mockResolvedValue([
        { id: COWORKER_ID, baseURL: "https://chat.example.com" },
      ]);
      userFindManyMock.mockResolvedValue([
        { id: OTHER_USER_ID, name: "Bob", email: "bob@example.com" },
      ]);

      const app = createApp(coworkerAuthContext);
      const response = await app.request("/", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          kind: "direct",
          memberUserIds: [OTHER_USER_ID],
        }),
      });

      expect(response.status).toBe(201);
      const body = await response.json();
      expect(body.data.kind).toBe("direct");
      expect(body.data.directKey).toBe(COWORKER_DIRECT_KEY);
      expect(body.data.createdByUserId).toBe(OTHER_USER_ID);
      expect(roomCreateMock).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            organizationId: ORG_ID,
            createdByUserId: OTHER_USER_ID,
            kind: "direct",
            directKey: COWORKER_DIRECT_KEY,
            userMembers: {
              create: [{ userId: OTHER_USER_ID }],
            },
            coworkerMembers: {
              create: [{ coworkerId: COWORKER_ID }],
            },
          }),
        }),
      );
    });

    it("does not return the target human's sidebar flags", async () => {
      const created = coworkerDirectRoom();
      roomFindFirstMock.mockResolvedValueOnce(null);
      roomCreateMock.mockResolvedValueOnce(created);
      coworkerFindManyMock.mockResolvedValue([
        { id: COWORKER_ID, baseURL: "https://chat.example.com" },
      ]);
      membershipFindManyMock.mockResolvedValue([
        {
          roomId: ROOM_ID,
          starredAt: new Date("2025-01-01T00:00:00.000Z"),
          mutedAt: new Date("2025-01-02T00:00:00.000Z"),
        },
      ]);

      const app = createApp(coworkerAuthContext);
      const response = await app.request("/", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          kind: "direct",
          memberUserIds: [OTHER_USER_ID],
        }),
      });

      expect(response.status).toBe(201);
      const body = await response.json();
      expect(body.data.starredAt).toBeNull();
      expect(body.data.mutedAt).toBeNull();
      expect(body.data.markedUnread).toBe(false);
    });

    it("returns the existing coworker 1:1 for the same pair", async () => {
      const existing = coworkerDirectRoom();
      roomFindFirstMock.mockResolvedValueOnce(existing);
      coworkerFindManyMock.mockResolvedValue([
        { id: COWORKER_ID, baseURL: "https://chat.example.com" },
      ]);

      const app = createApp(coworkerAuthContext);
      const response = await app.request("/", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          kind: "direct",
          memberUserIds: [OTHER_USER_ID],
        }),
      });

      expect(response.status).toBe(200);
      const body = await response.json();
      expect(body.data.id).toBe(ROOM_ID);
      expect(roomCreateMock).not.toHaveBeenCalled();
    });

    it("unarchives a stale coworker 1:1 with the same directKey", async () => {
      const archived = coworkerDirectRoom({
        archivedAt: new Date("2025-06-01T00:00:00.000Z"),
      });
      const restored = coworkerDirectRoom({ archivedAt: null });
      roomFindFirstMock.mockResolvedValueOnce(archived);
      roomUpdateMock.mockResolvedValueOnce(restored);
      coworkerFindManyMock.mockResolvedValue([
        { id: COWORKER_ID, baseURL: "https://chat.example.com" },
      ]);

      const app = createApp(coworkerAuthContext);
      const response = await app.request("/", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          kind: "direct",
          memberUserIds: [OTHER_USER_ID],
        }),
      });

      expect(response.status).toBe(200);
      expect(roomUpdateMock).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: ROOM_ID },
          data: { archivedAt: null },
        }),
      );
      expect(roomCreateMock).not.toHaveBeenCalled();
    });

    it("rejects channel create with 403", async () => {
      const app = createApp(coworkerAuthContext);
      const response = await app.request("/", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          kind: "channel",
          name: "Launch Room",
          slug: "launch-room",
        }),
      });

      expect(response.status).toBe(403);
      expect(await response.text()).toBe(
        "Coworker API keys cannot create channels",
      );
      expect(roomCreateMock).not.toHaveBeenCalled();
    });

    it("rejects personal originate when no organization context with 400", async () => {
      const app = createApp({
        ...coworkerAuthContext,
        context: { userId: USER_ID, organizationId: null },
      });
      const response = await app.request("/", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          kind: "direct",
          memberUserIds: [OTHER_USER_ID],
        }),
      });

      expect(response.status).toBe(400);
      expect(await response.text()).toBe(
        "Switch to an organization to message a teammate.",
      );
      expect(roomCreateMock).not.toHaveBeenCalled();
    });

    it("rejects coworkerIds in the body with 400", async () => {
      const app = createApp(coworkerAuthContext);
      const response = await app.request("/", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          kind: "direct",
          memberUserIds: [OTHER_USER_ID],
          coworkerIds: [COWORKER_ID],
        }),
      });

      expect(response.status).toBe(400);
      expect(await response.text()).toBe(
        "Coworker API keys cannot include coworkerIds",
      );
      expect(roomCreateMock).not.toHaveBeenCalled();
    });

    it("rejects omitted memberUserIds with 400", async () => {
      const app = createApp(coworkerAuthContext);
      const response = await app.request("/", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          kind: "direct",
        }),
      });

      expect(response.status).toBe(400);
      expect(await response.text()).toBe("Choose a direct message target");
      expect(roomCreateMock).not.toHaveBeenCalled();
    });

    it("rejects more than one memberUserId with 400", async () => {
      const app = createApp(coworkerAuthContext);
      const response = await app.request("/", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          kind: "direct",
          memberUserIds: [OTHER_USER_ID, THIRD_USER_ID],
        }),
      });

      expect(response.status).toBe(400);
      expect(await response.text()).toBe("Choose a direct message target");
      expect(roomCreateMock).not.toHaveBeenCalled();
    });

    it("unarchives on directKey unique-retry when the winner is archived", async () => {
      const archived = coworkerDirectRoom({
        archivedAt: new Date("2025-06-01T00:00:00.000Z"),
      });
      const restored = coworkerDirectRoom({ archivedAt: null });
      roomFindFirstMock
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce(archived);
      roomCreateMock.mockRejectedValue({
        code: "P2002",
        meta: { target: ["organizationId", "directKey"] },
      });
      roomUpdateMock.mockResolvedValueOnce(restored);
      coworkerFindManyMock.mockResolvedValue([
        { id: COWORKER_ID, baseURL: "https://chat.example.com" },
      ]);

      const app = createApp(coworkerAuthContext);
      const response = await app.request("/", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          kind: "direct",
          memberUserIds: [OTHER_USER_ID],
        }),
      });

      expect(response.status).toBe(200);
      expect(roomUpdateMock).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: ROOM_ID },
          data: { archivedAt: null },
        }),
      );
      expect(roomCreateMock).toHaveBeenCalled();
    });

    it("rejects a coworker that is not usable in the workspace with 400", async () => {
      coworkerFindManyMock.mockResolvedValue([]);

      const app = createApp(coworkerAuthContext);
      const response = await app.request("/", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          kind: "direct",
          memberUserIds: [OTHER_USER_ID],
        }),
      });

      expect(response.status).toBe(400);
      expect(await response.text()).toBe(
        "Room AI coworkers must be active chat coworkers",
      );
      expect(roomCreateMock).not.toHaveBeenCalled();
    });

    it("rejects a target who is not an organization member with 400", async () => {
      coworkerFindManyMock.mockResolvedValue([
        { id: COWORKER_ID, baseURL: "https://chat.example.com" },
      ]);
      memberFindUniqueMock.mockResolvedValue(null);
      memberFindManyMock.mockResolvedValue([]);

      const app = createApp(coworkerAuthContext);
      const response = await app.request("/", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          kind: "direct",
          memberUserIds: [OTHER_USER_ID],
        }),
      });

      expect(response.status).toBe(400);
      expect(await response.text()).toBe(
        "Room human members must belong to the organization",
      );
      expect(roomCreateMock).not.toHaveBeenCalled();
    });
  });
});
