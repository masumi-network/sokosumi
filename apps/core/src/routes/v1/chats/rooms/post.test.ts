import { OpenAPIHono } from "@hono/zod-openapi";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { OpenAPIHonoWithAuth } from "@/lib/hono";
import { defaultValidationHook } from "@/lib/hono";
import type { AuthVariables } from "@/middleware/auth";

import mountPostChatRooms from "./post";

const {
  roomFindFirstMock,
  roomFindManyMock,
  roomCreateMock,
  organizationFindUniqueMock,
  memberFindUniqueMock,
  memberFindManyMock,
  userFindManyMock,
  coworkerFindManyMock,
  prismaTransactionMock,
} = vi.hoisted(() => ({
  roomFindFirstMock: vi.fn(),
  roomFindManyMock: vi.fn(),
  roomCreateMock: vi.fn(),
  organizationFindUniqueMock: vi.fn(),
  memberFindUniqueMock: vi.fn(),
  memberFindManyMock: vi.fn(),
  userFindManyMock: vi.fn(),
  coworkerFindManyMock: vi.fn(),
  prismaTransactionMock: vi.fn(),
}));

vi.mock("@/lib/db/prisma", () => ({
  default: {
    $transaction: prismaTransactionMock,
    chatRoom: {
      findFirst: roomFindFirstMock,
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
    create: roomCreateMock,
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

const userAuthContext: AuthVariables["authContext"] = {
  actor: "user",
  userId: USER_ID,
  organizationId: ORG_ID,
  role: "user",
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
    slug: "bob",
    kind: "direct",
    directKey: DIRECT_KEY,
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
  userFindManyMock.mockResolvedValue([
    { id: OTHER_USER_ID, name: "Bob", email: "bob@example.com" },
  ]);
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
      }),
    });

    expect(response.status).toBe(201);
    const body = await response.json();
    expect(body.data.kind).toBe("channel");
    expect(body.data.name).toBe("Launch Room");
    expect(body.data.slug).toBe("launch-room");
    expect(roomCreateMock).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          organizationId: ORG_ID,
          name: "Launch Room",
          slug: "launch-room",
        }),
      }),
    );
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
      slug: "elena",
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
    coworkerFindManyMock.mockResolvedValue([{ id: coworkerId }]);

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
      slug: "elena",
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
    coworkerFindManyMock.mockResolvedValue([{ id: coworkerId }]);

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

  it("rejects human direct without an active organization with 400", async () => {
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
      "Switch to an organization to message a teammate.",
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

  it("rejects group direct targets with 400", async () => {
    const app = createApp(userAuthContext);
    const response = await app.request("/", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        kind: "direct",
        memberUserIds: [OTHER_USER_ID, "user_789"],
      }),
    });

    expect(response.status).toBe(400);
    expect(await response.text()).toBe(
      "Direct messages are 1:1. Pick one member or one coworker.",
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
      "Direct messages are 1:1. Pick one member or one coworker.",
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
    expect(roomFindFirstMock).toHaveBeenCalledTimes(2);
    expect(roomFindFirstMock).toHaveBeenLastCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          organizationId: ORG_ID,
          directKey: DIRECT_KEY,
          archivedAt: null,
        }),
      }),
    );
  });

  it("retries when a slug unique race wins, then creates with 201", async () => {
    const created = directRoom();
    roomFindFirstMock.mockResolvedValue(null);
    roomCreateMock
      .mockRejectedValueOnce({
        code: "P2002",
        meta: { target: ["organizationId", "slug"] },
      })
      .mockResolvedValueOnce(created);

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
    expect(body.data.id).toBe(ROOM_ID);
    expect(roomCreateMock).toHaveBeenCalledTimes(2);
  });

  it("returns 409 Room already exists after slug unique retries exhaust", async () => {
    roomFindFirstMock.mockResolvedValue(null);
    roomCreateMock.mockRejectedValue({
      code: "P2002",
      meta: { target: ["organizationId", "slug"] },
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

    expect(response.status).toBe(409);
    expect(await response.text()).toBe("Room already exists");
    expect(roomCreateMock).toHaveBeenCalledTimes(3);
  });
});
