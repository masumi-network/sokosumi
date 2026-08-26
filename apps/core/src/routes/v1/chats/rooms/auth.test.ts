import { OpenAPIHono } from "@hono/zod-openapi";
import type { RequestIdVariables } from "hono/request-id";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { errorHandler } from "@/helpers/error-handler";
import { defaultValidationHook, type OpenAPIHonoWithAuth } from "@/lib/hono";
import type { AuthVariables } from "@/middleware/auth";

const {
  prismaTransactionMock,
  prismaDefaultMock,
  roomFindFirstMock,
  organizationFindUniqueMock,
  memberFindUniqueMock,
  messageFindManyMock,
  messageCountMock,
  queryRawUnsafeMock,
} = vi.hoisted(() => {
  const prismaTransactionMock = vi.fn();
  const roomFindFirstMock = vi.fn();
  const organizationFindUniqueMock = vi.fn();
  const memberFindUniqueMock = vi.fn();
  const messageFindManyMock = vi.fn();
  const messageCountMock = vi.fn();
  const queryRawUnsafeMock = vi.fn();
  return {
    prismaTransactionMock,
    roomFindFirstMock,
    organizationFindUniqueMock,
    memberFindUniqueMock,
    messageFindManyMock,
    messageCountMock,
    queryRawUnsafeMock,
    prismaDefaultMock: {
      $transaction: prismaTransactionMock,
      $queryRawUnsafe: queryRawUnsafeMock,
      chatRoom: {
        findFirst: roomFindFirstMock,
      },
      organization: {
        findUnique: organizationFindUniqueMock,
      },
      member: {
        findUnique: memberFindUniqueMock,
      },
      chatRoomMessage: {
        findMany: messageFindManyMock,
        count: messageCountMock,
      },
      chatRoomUserMember: {
        findMany: vi.fn().mockResolvedValue([]),
      },
      chatRoomReadState: {
        findMany: vi.fn().mockResolvedValue([]),
      },
      chatRoomMention: {
        findMany: vi.fn().mockResolvedValue([]),
      },
      notification: {
        groupBy: vi.fn().mockResolvedValue([]),
      },
    },
  };
});

vi.mock("@/lib/db/prisma", () => ({
  default: prismaDefaultMock,
}));

vi.mock("@vercel/functions", () => ({
  waitUntil: vi.fn(),
}));

vi.mock("@/services/chat-room-coworker-dispatch.service", () => ({
  dispatchChatRoomMention: vi.fn(),
  listStaleSentChatRoomMentionIds: vi.fn().mockResolvedValue([]),
}));

// Stream routes: auth/membership only — keep heavy stream deps inert.
vi.mock("ai", () => ({
  convertToModelMessages: vi.fn(),
  generateId: vi.fn(() => "generated-id-test"),
  streamText: vi.fn(),
  validateUIMessages: vi.fn(
    async ({ messages }: { messages: unknown[] }) => messages,
  ),
  UI_MESSAGE_STREAM_HEADERS: {},
}));

vi.mock("@/lib/sokosumi-ai-provider", () => ({
  getSokosumiProvider: vi.fn(),
}));

vi.mock("@/helpers/access-control", () => ({
  requireCoworkerChatCapability: vi.fn(),
  requireCoworkerChatCapabilityInWorkspace: vi.fn(),
}));

vi.mock("@/helpers/active-ui-stream-room-metadata", () => ({
  setActiveUiStreamIdForRoom: vi.fn(),
  clearActiveUiStreamIdForRoom: vi.fn(),
  readActiveUiStreamIdForRoom: vi.fn(),
}));

vi.mock("@/helpers/coworker-stream-lock", () => ({
  acquireStreamLock: vi.fn(),
  releaseStreamLock: vi.fn(),
  startStreamLockHeartbeat: vi.fn(() => () => {}),
}));

vi.mock("@/helpers/persist-assistant-to-chat-room", () => ({
  persistAssistantToChatRoom: vi.fn(),
  persistUserMessageToChatRoom: vi.fn(),
}));

vi.mock("@/lib/resumable-ui-stream-context", () => ({
  isUiStreamResumptionConfigured: vi.fn(() => false),
  getResumableUiStreamContext: vi.fn(),
}));

const { default: mountGetChatRooms } = await import("./get");
const { default: mountPostChatRoom } = await import("./post");
const { default: mountGetChatRoom } = await import("./[id]/get");
const { default: mountPatchChatRoom } = await import("./[id]/patch");
const { default: mountPostChatRoomRead } = await import("./[id]/read/post");
const { default: mountGetChatRoomMessages } = await import(
  "./[id]/messages/get"
);
const { default: mountPostChatRoomMessage } = await import(
  "./[id]/messages/post"
);
const { default: mountDeleteChatRoomMessage } = await import(
  "./[id]/messages/[messageId]/delete"
);
const { default: mountPostChatRoomMessageReaction } = await import(
  "./[id]/messages/[messageId]/reactions/post"
);
const { default: mountRetryChatRoomMention } = await import(
  "./[id]/messages/[messageId]/mentions/[mentionId]/retry/post"
);
const { default: mountRemoveChatRoomMessageUnfurl } = await import(
  "./[id]/messages/[messageId]/unfurls/remove/post"
);
const { default: mountRoomStream } = await import("./[id]/stream/index");

const ROOM_ID = "550e8400-e29b-41d4-a716-446655440000";
const MESSAGE_ID = "550e8400-e29b-41d4-a716-446655440001";
const USER_ID = "user_123";
const ORG_ID = "org_1";
const COWORKER_ID = "cow_123";

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

const orchestratorAuthContext: AuthVariables["authContext"] = {
  actor: "orchestrator",
  context: { userId: USER_ID, organizationId: ORG_ID },
};

function createApp(authContext: AuthVariables["authContext"]) {
  const app = new OpenAPIHono<{
    Variables: AuthVariables & RequestIdVariables;
  }>({
    defaultHook: defaultValidationHook,
  });

  app.use("*", async (c, next) => {
    c.set("requestId", "req_chat_rooms_auth");
    c.set("isAuthenticated", true);
    c.set("authContext", authContext);
    await next();
  });

  app.onError(errorHandler);
  const typed = app as unknown as OpenAPIHonoWithAuth;
  mountGetChatRooms(typed);
  mountPostChatRoom(typed);
  mountGetChatRoom(typed);
  mountPatchChatRoom(typed);
  mountPostChatRoomRead(typed);
  mountGetChatRoomMessages(typed);
  mountPostChatRoomMessage(typed);
  mountDeleteChatRoomMessage(typed);
  mountPostChatRoomMessageReaction(typed);
  mountRemoveChatRoomMessageUnfurl(typed);
  mountRetryChatRoomMention(typed);
  mountRoomStream(typed);
  return app;
}

beforeEach(() => {
  vi.clearAllMocks();
  prismaDefaultMock.chatRoomMention.findMany.mockResolvedValue([]);
  roomFindFirstMock.mockReset();
  organizationFindUniqueMock.mockReset();
  memberFindUniqueMock.mockReset();
  messageFindManyMock.mockReset();
  messageCountMock.mockReset();
  queryRawUnsafeMock.mockReset();
});

const forbiddenActors = [
  ["coworker", coworkerAuthContext],
  ["orchestrator", orchestratorAuthContext],
] as const;

interface AuthRequestCase {
  label: string;
  request: () => {
    method: string;
    path: string;
    headers?: Record<string, string>;
    body?: string;
  };
}

const userOnlyCases: AuthRequestCase[] = [
  {
    label: "GET /",
    request: () => ({ method: "GET", path: "/" }),
  },
  {
    label: "POST /",
    request: () => ({
      method: "POST",
      path: "/",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        kind: "channel",
        name: "general",
      }),
    }),
  },
  {
    label: "GET /{id}",
    request: () => ({ method: "GET", path: `/${ROOM_ID}` }),
  },
  {
    label: "PATCH /{id}",
    request: () => ({
      method: "PATCH",
      path: `/${ROOM_ID}`,
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "Renamed" }),
    }),
  },
  {
    label: "POST /{id}/read",
    request: () => ({ method: "POST", path: `/${ROOM_ID}/read` }),
  },
  {
    label: "GET /{id}/messages",
    request: () => ({ method: "GET", path: `/${ROOM_ID}/messages` }),
  },
  {
    label: "POST /{id}/messages/{messageId}/reactions",
    request: () => ({
      method: "POST",
      path: `/${ROOM_ID}/messages/${MESSAGE_ID}/reactions`,
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ emoji: "👍" }),
    }),
  },
  {
    label: "POST /{id}/messages/{messageId}/unfurls/remove",
    request: () => ({
      method: "POST",
      path: `/${ROOM_ID}/messages/${MESSAGE_ID}/unfurls/remove`,
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ url: "https://example.com" }),
    }),
  },
  {
    label: "POST /{id}/messages/{messageId}/mentions/{mentionId}/retry",
    request: () => ({
      method: "POST",
      path: `/${ROOM_ID}/messages/${MESSAGE_ID}/mentions/${MESSAGE_ID}/retry`,
    }),
  },
  {
    label: "POST /{id}/stream",
    request: () => ({
      method: "POST",
      path: `/${ROOM_ID}/stream`,
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        messages: [{ role: "user", parts: [{ type: "text", text: "Hi" }] }],
      }),
    }),
  },
  {
    label: "GET /{id}/stream/messages",
    request: () => ({ method: "GET", path: `/${ROOM_ID}/stream/messages` }),
  },
  {
    label: "GET /{id}/stream/active",
    request: () => ({ method: "GET", path: `/${ROOM_ID}/stream/active` }),
  },
];

describe("chat room user auth guards", () => {
  describe.each(userOnlyCases)("$label", ({ request }) => {
    it.each(forbiddenActors)(
      "rejects %s actor with 403",
      async (_label, auth) => {
        const { method, path, headers, body } = request();
        const response = await createApp(auth).request(path, {
          method,
          headers,
          body,
        });

        expect(response.status).toBe(403);
        expect(prismaTransactionMock).not.toHaveBeenCalled();
      },
    );
  });

  it("rejects orchestrator actor on POST /{id}/messages with 403", async () => {
    const response = await createApp(orchestratorAuthContext).request(
      `/${ROOM_ID}/messages`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ content: "hello" }),
      },
    );

    expect(response.status).toBe(403);
    expect(prismaTransactionMock).not.toHaveBeenCalled();
  });

  it("allows coworker past the auth gate on POST /{id}/messages", async () => {
    prismaTransactionMock.mockImplementation(
      async (callback: (tx: unknown) => Promise<unknown>) =>
        callback({
          chatRoom: {
            findFirst: vi.fn().mockResolvedValue({
              id: ROOM_ID,
              name: "general",
              kind: "channel",
              organizationId: ORG_ID,
              userMembers: [],
            }),
            update: vi.fn(),
          },
          chatRoomMessage: {
            findFirst: vi.fn(),
            create: vi.fn().mockResolvedValue({
              id: MESSAGE_ID,
              roomId: ROOM_ID,
              parentMessageId: null,
              content: "hello from coworker",
              metadata: null,
              createdAt: new Date("2025-01-01T00:00:00.000Z"),
              editedAt: null,
              updatedAt: new Date("2025-01-01T00:00:00.000Z"),
              senderUserId: null,
              senderCoworkerId: COWORKER_ID,
              senderUser: null,
              senderCoworker: {
                id: COWORKER_ID,
                name: "Hannah",
                slug: "hannah",
                caption: null,
                image: null,
              },
              mentionsAsSource: [],
              reactions: [],
              replies: [],
              _count: { replies: 0 },
            }),
          },
        }),
    );

    const response = await createApp(coworkerAuthContext).request(
      `/${ROOM_ID}/messages`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ content: "hello from coworker" }),
      },
    );

    expect(response.status).toBe(201);
    expect(prismaTransactionMock).toHaveBeenCalled();
  });

  it("allows user actor past the auth gate on GET /{id}", async () => {
    roomFindFirstMock.mockResolvedValue({
      id: ROOM_ID,
      organizationId: ORG_ID,
      name: "general",
      slug: "general",
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
    });
    organizationFindUniqueMock.mockResolvedValue({ id: ORG_ID });
    memberFindUniqueMock.mockResolvedValue({ role: "member" });
    queryRawUnsafeMock.mockResolvedValue([]);

    const response = await createApp(userAuthContext).request(`/${ROOM_ID}`);

    expect(response.status).toBe(200);
    expect(prismaTransactionMock).not.toHaveBeenCalled();
    expect(roomFindFirstMock).toHaveBeenCalled();
  });
});

const membershipScopedCases: AuthRequestCase[] = [
  {
    label: "GET /{id}",
    request: () => ({ method: "GET", path: `/${ROOM_ID}` }),
  },
  {
    label: "PATCH /{id}",
    request: () => ({
      method: "PATCH",
      path: `/${ROOM_ID}`,
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "Renamed" }),
    }),
  },
  {
    label: "POST /{id}/read",
    request: () => ({ method: "POST", path: `/${ROOM_ID}/read` }),
  },
  {
    label: "GET /{id}/messages",
    request: () => ({ method: "GET", path: `/${ROOM_ID}/messages` }),
  },
  {
    label: "POST /{id}/messages",
    request: () => ({
      method: "POST",
      path: `/${ROOM_ID}/messages`,
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ content: "hello" }),
    }),
  },
  {
    label: "POST /{id}/messages/{messageId}/reactions",
    request: () => ({
      method: "POST",
      path: `/${ROOM_ID}/messages/${MESSAGE_ID}/reactions`,
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ emoji: "👍" }),
    }),
  },
  {
    label: "POST /{id}/messages/{messageId}/unfurls/remove",
    request: () => ({
      method: "POST",
      path: `/${ROOM_ID}/messages/${MESSAGE_ID}/unfurls/remove`,
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ url: "https://example.com" }),
    }),
  },
  {
    label: "POST /{id}/messages/{messageId}/mentions/{mentionId}/retry",
    request: () => ({
      method: "POST",
      path: `/${ROOM_ID}/messages/${MESSAGE_ID}/mentions/${MESSAGE_ID}/retry`,
    }),
  },
  {
    label: "POST /{id}/stream",
    request: () => ({
      method: "POST",
      path: `/${ROOM_ID}/stream`,
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        messages: [{ role: "user", parts: [{ type: "text", text: "Hi" }] }],
      }),
    }),
  },
  {
    label: "GET /{id}/stream/messages",
    request: () => ({ method: "GET", path: `/${ROOM_ID}/stream/messages` }),
  },
  {
    label: "GET /{id}/stream/active",
    request: () => ({ method: "GET", path: `/${ROOM_ID}/stream/active` }),
  },
];

// Room-scoped membership GETs that must not open interactive txs.
// List GET / is not room-scoped (no single-room 404 path) — covered in get.test.ts.
const membershipCasesWithoutInteractiveTx = new Set([
  "GET /{id}",
  "GET /{id}/messages",
]);

describe("chat room membership isolation", () => {
  it.each(membershipScopedCases)(
    "$label returns 404 when caller is not a room member",
    async ({ label, request }) => {
      // Read GETs no longer open interactive txs — membership miss is on the
      // default client. Write / stream paths still go through $transaction.
      roomFindFirstMock.mockResolvedValue(null);
      prismaTransactionMock.mockImplementation(
        async (callback: (tx: unknown) => Promise<unknown>) =>
          callback({
            chatRoom: {
              findFirst: vi.fn().mockResolvedValue(null),
            },
          }),
      );

      const { method, path, headers, body } = request();
      const response = await createApp(userAuthContext).request(path, {
        method,
        headers,
        body,
      });

      expect(response.status).toBe(404);
      if (membershipCasesWithoutInteractiveTx.has(label)) {
        expect(prismaTransactionMock).not.toHaveBeenCalled();
        expect(roomFindFirstMock).toHaveBeenCalled();
      } else {
        expect(prismaTransactionMock).toHaveBeenCalled();
      }
    },
  );
});
