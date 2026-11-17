import type { DrainContext } from "evlog";
import { Hono } from "hono";
import { requestId } from "hono/request-id";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { errorHandler } from "@/helpers/error-handler";
import {
  bindCoreRequestContext,
  coreEvlogMiddleware,
  initCoreLogger,
} from "@/lib/evlog";
import { OpenAPIHonoWithAuth } from "@/lib/hono";
import type { AuthVariables } from "@/middleware/auth";
import {
  expectBackgroundProbe,
  probeBackgroundFailure,
} from "@/test/background-probe";
import {
  type CoreLogEntry,
  expectCoreLog,
  expectCoreLogWhys,
} from "@/test/core-log";
import mountPostRoomStream from "./post";

vi.mock("@/middleware/auth", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/middleware/auth")>();
  const { stubAuthMiddleware } = await import(
    "@/test-fixtures/auth-middleware"
  );
  return { ...actual, authMiddleware: stubAuthMiddleware };
});

const {
  roomFindFirstMock,
  chatRoomUpdateMock,
  chatRoomUpdateManyMock,
  chatRoomMessageCreateMock,
  chatRoomMessageFindFirstMock,
  userFindUniqueMock,
  organizationFindUniqueMock,
  memberFindUniqueMock,
  prismaTransactionMock,
  requireCoworkerChatCapabilityInWorkspaceMock,
  workspaceFindUniqueMock,
  createCoworkerConversationMock,
  streamTextMock,
  toUIMessageStreamResponseMock,
  convertToModelMessagesMock,
  validateUIMessagesMock,
  getSokosumiProviderMock,
  sokosumiProviderCallMock,
  persistUserMessageToChatRoomMock,
  persistAssistantToChatRoomMock,
  isUiStreamResumptionConfiguredMock,
  getResumableUiStreamContextMock,
  createNewResumableStreamMock,
  setActiveUiStreamIdForRoomMock,
  clearActiveUiStreamIdForRoomMock,
  acquireStreamLockMock,
  releaseStreamLockMock,
  startStreamLockHeartbeatMock,
  waitUntilMock,
  ensureThreadProviderConversationMock,
  buildRoomStreamThreadModelMessagesMock,
  getPendingResponseMirrorMock,
  setPendingResponseMirrorMock,
  clearPendingResponseMirrorMock,
  renewPendingResponseMirrorMock,
  pollCoworkerResponseStatusMock,
} = vi.hoisted(() => ({
  roomFindFirstMock: vi.fn(),
  chatRoomUpdateMock: vi.fn(),
  chatRoomUpdateManyMock: vi.fn(),
  chatRoomMessageCreateMock: vi.fn(),
  chatRoomMessageFindFirstMock: vi.fn(),
  userFindUniqueMock: vi.fn(),
  organizationFindUniqueMock: vi.fn(),
  memberFindUniqueMock: vi.fn(),
  prismaTransactionMock: vi.fn(),
  requireCoworkerChatCapabilityInWorkspaceMock: vi.fn(),
  workspaceFindUniqueMock: vi.fn(),
  createCoworkerConversationMock: vi.fn(),
  streamTextMock: vi.fn(),
  toUIMessageStreamResponseMock: vi.fn(),
  convertToModelMessagesMock: vi.fn(),
  validateUIMessagesMock: vi.fn(),
  getSokosumiProviderMock: vi.fn(),
  sokosumiProviderCallMock: vi.fn(),
  persistUserMessageToChatRoomMock: vi.fn(),
  persistAssistantToChatRoomMock: vi.fn(),
  isUiStreamResumptionConfiguredMock: vi.fn(),
  getResumableUiStreamContextMock: vi.fn(),
  createNewResumableStreamMock: vi.fn(),
  setActiveUiStreamIdForRoomMock: vi.fn(),
  clearActiveUiStreamIdForRoomMock: vi.fn(),
  acquireStreamLockMock: vi.fn(),
  releaseStreamLockMock: vi.fn(),
  startStreamLockHeartbeatMock: vi.fn(),
  waitUntilMock: vi.fn(),
  ensureThreadProviderConversationMock: vi.fn(),
  buildRoomStreamThreadModelMessagesMock: vi.fn(),
  getPendingResponseMirrorMock: vi.fn(),
  setPendingResponseMirrorMock: vi.fn(),
  clearPendingResponseMirrorMock: vi.fn(),
  renewPendingResponseMirrorMock: vi.fn(),
  pollCoworkerResponseStatusMock: vi.fn(),
}));

vi.mock("@vercel/functions", () => ({
  waitUntil: vi.fn((...args: unknown[]) => waitUntilMock(...args)),
}));

vi.mock("ai", () => ({
  convertToModelMessages: convertToModelMessagesMock,
  generateId: vi.fn(() => "generated-id-test"),
  streamText: streamTextMock,
  validateUIMessages: validateUIMessagesMock,
}));

vi.mock("@/lib/sokosumi-ai-provider", () => ({
  getSokosumiProvider: getSokosumiProviderMock,
}));

vi.mock("@/helpers/access-control", () => ({
  requireCoworkerChatCapabilityInWorkspace:
    requireCoworkerChatCapabilityInWorkspaceMock,
}));

vi.mock("@/helpers/active-ui-stream-room-metadata", () => ({
  setActiveUiStreamIdForRoom: setActiveUiStreamIdForRoomMock,
  clearActiveUiStreamIdForRoom: clearActiveUiStreamIdForRoomMock,
}));

vi.mock("@/helpers/coworker-stream-lock", () => ({
  acquireStreamLock: acquireStreamLockMock,
  releaseStreamLock: releaseStreamLockMock,
  startStreamLockHeartbeat: startStreamLockHeartbeatMock,
}));

vi.mock("@/helpers/coworker-pending-response-mirror", () => ({
  getPendingResponseMirror: (...args: unknown[]) =>
    getPendingResponseMirrorMock(...args),
  setPendingResponseMirror: (...args: unknown[]) =>
    setPendingResponseMirrorMock(...args),
  clearPendingResponseMirror: (...args: unknown[]) =>
    clearPendingResponseMirrorMock(...args),
  renewPendingResponseMirror: (...args: unknown[]) =>
    renewPendingResponseMirrorMock(...args),
}));

vi.mock("@/helpers/coworker-response-poll", () => ({
  pollCoworkerResponseStatus: (...args: unknown[]) =>
    pollCoworkerResponseStatusMock(...args),
}));

vi.mock("@/lib/resumable-ui-stream-context", () => ({
  isUiStreamResumptionConfigured: isUiStreamResumptionConfiguredMock,
  getResumableUiStreamContext: getResumableUiStreamContextMock,
}));

vi.mock("@/helpers/persist-assistant-to-chat-room", () => ({
  persistAssistantToChatRoom: persistAssistantToChatRoomMock,
  persistUserMessageToChatRoom: persistUserMessageToChatRoomMock,
}));

const deleteChatRoomMessageMetadataKeysMock = vi.hoisted(() =>
  vi.fn(async () => undefined),
);
vi.mock("@/helpers/chat-room-message-metadata-patch", () => ({
  deleteChatRoomMessageMetadataKeys: deleteChatRoomMessageMetadataKeysMock,
}));

vi.mock("@/helpers/room-stream-thread", () => ({
  THREAD_PROVIDER_CONVERSATION_ID_KEY: "thread_provider_conversation_id",
  ensureThreadProviderConversation: (...args: unknown[]) =>
    ensureThreadProviderConversationMock(...args),
  buildRoomStreamThreadModelMessages: (...args: unknown[]) =>
    buildRoomStreamThreadModelMessagesMock(...args),
}));

vi.mock(
  "@/routes/v1/chats/stream/coworker-conversation",
  async (importOriginal) => {
    const actual =
      await importOriginal<
        typeof import("@/routes/v1/chats/stream/coworker-conversation")
      >();
    return {
      ...actual,
      createCoworkerConversation: (...args: unknown[]) =>
        createCoworkerConversationMock(...args),
    };
  },
);

vi.mock("@/lib/db/prisma", () => ({
  default: {
    $transaction: prismaTransactionMock,
    chatRoom: {
      findFirst: roomFindFirstMock,
      update: chatRoomUpdateMock,
      updateMany: chatRoomUpdateManyMock,
    },
    chatRoomMessage: {
      create: chatRoomMessageCreateMock,
      findFirst: chatRoomMessageFindFirstMock,
    },
    user: {
      findUnique: userFindUniqueMock,
    },
    organization: {
      findUnique: organizationFindUniqueMock,
    },
    member: {
      findUnique: memberFindUniqueMock,
    },
    workspace: {
      findUnique: workspaceFindUniqueMock,
    },
  },
}));

const ROOM_ID = "550e8400-e29b-41d4-a716-446655440000";
const USER_ID = "user_123";
const COWORKER_ID = "coworker_1";
const PARENT_MESSAGE_ID = "550e8400-e29b-41d4-a716-446655440099";
const QUOTE_MESSAGE_ID = "550e8400-e29b-41d4-a716-446655440004";
const OWNED_ROOM_FILE_URL =
  "https://abc.public.blob.vercel-storage.com/users/user_123/chats/550e8400-e29b-41d4-a716-446655440000/a.png";
const OTHER_ROOM_FILE_URL =
  "https://abc.public.blob.vercel-storage.com/users/user_123/chats/aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa/a.png";

const quoteSnapshot = {
  messageId: QUOTE_MESSAGE_ID,
  authorName: "Alice",
  snippet: "Earlier point about launch risk",
  attachment: null,
  attachments: [],
};

const launchAttachment = {
  fileName: "launch.png",
  url: "https://blob.example/launch.png",
  mediaKind: "image" as const,
};
const imageQuoteContent =
  "see this [launch.png](https://blob.example/launch.png)";
const imageQuoteSnapshot = {
  messageId: QUOTE_MESSAGE_ID,
  authorName: "Alice",
  snippet: "see this",
  attachment: launchAttachment,
  attachments: [launchAttachment],
};

function quotedSourceMessage(overrides: Partial<{ content: string }> = {}) {
  return {
    id: QUOTE_MESSAGE_ID,
    content: overrides.content ?? "Earlier point about launch risk",
    senderUser: { name: "Alice" },
    senderCoworker: null,
  };
}

const userAuthContext: AuthVariables["authContext"] = {
  actor: "user",
  userId: USER_ID,
  organizationId: "org_1",
  role: "user",
};

function createApp(
  authContext: AuthVariables["authContext"] = userAuthContext,
  options: { evlog?: boolean } = {},
) {
  const app = new OpenAPIHonoWithAuth();
  if (options.evlog) app.use("*", coreEvlogMiddleware());

  app.use("*", async (c, next) => {
    c.set("isAuthenticated", true);
    c.set("authContext", authContext);
    return await next();
  });

  mountPostRoomStream(app);
  return app;
}

function roomWithOneCoworker(
  overrides: {
    kind?: string;
    organizationId?: string | null;
    providerConversationId?: string | null;
    userMembers?: Array<{ userId: string }>;
    coworkerMembers?: Array<{
      coworker: { id: string; name: string; slug: string };
    }>;
    sokoBotMembers?: Array<{
      sokoBot: { id: string; name: string };
    }>;
  } = {},
) {
  return {
    id: ROOM_ID,
    kind: overrides.kind ?? "direct",
    name: "Hannah DM",
    organizationId:
      "organizationId" in overrides ? overrides.organizationId : "org_1",
    providerConversationId:
      "providerConversationId" in overrides
        ? (overrides.providerConversationId ?? null)
        : "conv_remote_1",
    userMembers: overrides.userMembers ?? [{ userId: USER_ID }],
    coworkerMembers: overrides.coworkerMembers ?? [
      {
        coworker: {
          id: COWORKER_ID,
          name: "Hannah",
          slug: "hannah",
        },
      },
    ],
    sokoBotMembers: overrides.sokoBotMembers ?? [],
  };
}

async function postStream(
  body?: unknown,
  authContext: AuthVariables["authContext"] = userAuthContext,
) {
  const app = createApp(authContext);
  return await app.request(`/${ROOM_ID}/stream`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(
      body ?? {
        messages: [{ role: "user", parts: [{ type: "text", text: "Hello" }] }],
      },
    ),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  organizationFindUniqueMock.mockResolvedValue({ id: "org_1" });
  memberFindUniqueMock.mockResolvedValue({ role: "member" });
  convertToModelMessagesMock.mockResolvedValue([]);
  validateUIMessagesMock.mockImplementation(
    async ({ messages }: { messages: unknown[] }) => messages,
  );
  sokosumiProviderCallMock.mockReturnValue({});
  getSokosumiProviderMock.mockReturnValue(sokosumiProviderCallMock);
  workspaceFindUniqueMock.mockResolvedValue({ id: "ws_org_1" });
  requireCoworkerChatCapabilityInWorkspaceMock.mockResolvedValue({
    id: COWORKER_ID,
    slug: "hannah",
    baseURL: "https://responses.example.com/v1",
  });
  createCoworkerConversationMock.mockResolvedValue({ id: "conv_new_1" });
  chatRoomUpdateManyMock.mockResolvedValue({ count: 1 });
  persistUserMessageToChatRoomMock.mockResolvedValue({ id: "msg_user_1" });
  persistAssistantToChatRoomMock.mockResolvedValue({ id: "msg_asst_1" });
  isUiStreamResumptionConfiguredMock.mockReturnValue(false);
  getResumableUiStreamContextMock.mockReturnValue({
    createNewResumableStream: createNewResumableStreamMock,
  });
  createNewResumableStreamMock.mockResolvedValue(
    new ReadableStream({
      start(controller) {
        controller.close();
      },
    }),
  );
  setActiveUiStreamIdForRoomMock.mockResolvedValue(undefined);
  clearActiveUiStreamIdForRoomMock.mockResolvedValue(undefined);
  acquireStreamLockMock.mockResolvedValue({
    status: "acquired",
    ownerToken: "instance-test:token-1",
  });
  releaseStreamLockMock.mockResolvedValue(true);
  startStreamLockHeartbeatMock.mockReturnValue(() => {});
  getPendingResponseMirrorMock.mockResolvedValue(null);
  setPendingResponseMirrorMock.mockResolvedValue(undefined);
  clearPendingResponseMirrorMock.mockResolvedValue(undefined);
  renewPendingResponseMirrorMock.mockResolvedValue(undefined);
  waitUntilMock.mockImplementation((promise: Promise<unknown>) => {
    void promise;
  });
  toUIMessageStreamResponseMock.mockImplementation(
    (opts?: { headers?: Record<string, string> }) =>
      new Response(null, {
        status: 200,
        headers: {
          "Content-Type": "text/event-stream",
          ...(opts?.headers ?? {}),
        },
      }),
  );
  streamTextMock.mockReturnValue({
    toUIMessageStreamResponse: toUIMessageStreamResponseMock,
  });
  userFindUniqueMock.mockResolvedValue({ name: "Ada" });
  ensureThreadProviderConversationMock.mockResolvedValue({
    providerConversationId: "conv_thread_1",
    justCreated: true,
  });
  buildRoomStreamThreadModelMessagesMock.mockResolvedValue({
    modelMessages: [{ role: "user", content: "thread prompt" }],
    uiMessages: [
      {
        id: PARENT_MESSAGE_ID,
        role: "user",
        parts: [{ type: "text", text: "root" }],
      },
    ],
  });
});

describe("POST /chats/rooms/{id}/stream", () => {
  it("returns 404 when room is missing or caller is not a member", async () => {
    roomFindFirstMock.mockResolvedValue(null);

    const response = await postStream({
      messages: [{ role: "user", parts: [{ type: "text", text: "Hi" }] }],
    });

    expect(response.status).toBe(404);
    expect(prismaTransactionMock).not.toHaveBeenCalled();
    expect(streamTextMock).not.toHaveBeenCalled();
    expect(persistUserMessageToChatRoomMock).not.toHaveBeenCalled();
  });

  it("returns 400 when room has zero coworker members", async () => {
    roomFindFirstMock.mockResolvedValue(
      roomWithOneCoworker({ coworkerMembers: [] }),
    );

    const response = await postStream({
      messages: [{ role: "user", parts: [{ type: "text", text: "Hi" }] }],
    });

    expect(response.status).toBe(400);
    expect(streamTextMock).not.toHaveBeenCalled();
    expect(persistUserMessageToChatRoomMock).not.toHaveBeenCalled();
  });

  it("returns 400 when room has more than one coworker member", async () => {
    roomFindFirstMock.mockResolvedValue(
      roomWithOneCoworker({
        coworkerMembers: [
          {
            coworker: {
              id: COWORKER_ID,
              name: "Hannah",
              slug: "hannah",
            },
          },
          {
            coworker: {
              id: "coworker_2",
              name: "Otto",
              slug: "otto",
            },
          },
        ],
        sokoBotMembers: [],
      }),
    );

    const response = await postStream({
      messages: [{ role: "user", parts: [{ type: "text", text: "Hi" }] }],
    });

    expect(response.status).toBe(400);
    expect(streamTextMock).not.toHaveBeenCalled();
    expect(createCoworkerConversationMock).not.toHaveBeenCalled();
  });

  it("returns 400 when room is a channel with one coworker", async () => {
    roomFindFirstMock.mockResolvedValue(
      roomWithOneCoworker({ kind: "channel" }),
    );

    const response = await postStream({
      messages: [{ role: "user", parts: [{ type: "text", text: "Hi" }] }],
    });

    expect(response.status).toBe(400);
    expect(streamTextMock).not.toHaveBeenCalled();
    expect(persistUserMessageToChatRoomMock).not.toHaveBeenCalled();
  });

  it("returns 400 when direct has multiple human members", async () => {
    roomFindFirstMock.mockResolvedValue(
      roomWithOneCoworker({
        userMembers: [{ userId: USER_ID }, { userId: "user_other" }],
      }),
    );

    const response = await postStream({
      messages: [{ role: "user", parts: [{ type: "text", text: "Hi" }] }],
    });

    expect(response.status).toBe(400);
    expect(streamTextMock).not.toHaveBeenCalled();
    expect(persistUserMessageToChatRoomMock).not.toHaveBeenCalled();
  });

  it("persists user message to chat_room_message and streams without conversation* rows", async () => {
    roomFindFirstMock.mockResolvedValue(roomWithOneCoworker());

    const response = await postStream();

    expect(response.status).toBe(200);
    expect(response.headers.get("x-sokosumi-room-id")).toBe(ROOM_ID);

    expect(persistUserMessageToChatRoomMock).toHaveBeenCalledWith(
      expect.objectContaining({
        roomId: ROOM_ID,
        senderUserId: USER_ID,
        contentText: "Hello",
        parentMessageId: null,
      }),
    );

    expect(streamTextMock).toHaveBeenCalledOnce();
    expect(sokosumiProviderCallMock).toHaveBeenCalledWith(null);
    const streamArgs = streamTextMock.mock.calls[0]![0] as {
      providerOptions: {
        sokosumi: {
          mode: string;
          providerConversationId: string | null;
          coworkerSlug: string | null;
        };
      };
    };
    expect(streamArgs.providerOptions.sokosumi.mode).toBe("coworker");
    expect(streamArgs.providerOptions.sokosumi.providerConversationId).toBe(
      "conv_remote_1",
    );
    expect(streamArgs.providerOptions.sokosumi.coworkerSlug).toBe("hannah");

    expect(createCoworkerConversationMock).not.toHaveBeenCalled();
    expect(ensureThreadProviderConversationMock).not.toHaveBeenCalled();
    expect(buildRoomStreamThreadModelMessagesMock).not.toHaveBeenCalled();
    expect(chatRoomUpdateManyMock).not.toHaveBeenCalled();
    expect(prismaTransactionMock).not.toHaveBeenCalled();
  });

  it("persists thread replies under parentMessageId with thread-scoped conversation", async () => {
    roomFindFirstMock.mockResolvedValue(roomWithOneCoworker());
    chatRoomMessageFindFirstMock.mockResolvedValue({
      id: PARENT_MESSAGE_ID,
      parentMessageId: null,
    });

    const response = await postStream({
      messages: [
        { role: "user", parts: [{ type: "text", text: "Thread reply" }] },
      ],
      parentMessageId: PARENT_MESSAGE_ID,
    });

    expect(response.status).toBe(200);
    expect(response.headers.get("x-sokosumi-parent-message-id")).toBe(
      PARENT_MESSAGE_ID,
    );

    expect(persistUserMessageToChatRoomMock).toHaveBeenCalledWith(
      expect.objectContaining({
        roomId: ROOM_ID,
        contentText: "Thread reply",
        parentMessageId: PARENT_MESSAGE_ID,
      }),
    );
    expect(ensureThreadProviderConversationMock).toHaveBeenCalledWith(
      expect.objectContaining({
        roomId: ROOM_ID,
        parentMessageId: PARENT_MESSAGE_ID,
        coworkerSlug: "hannah",
      }),
    );
    expect(buildRoomStreamThreadModelMessagesMock).toHaveBeenCalledWith(
      expect.objectContaining({
        roomId: ROOM_ID,
        parentMessageId: PARENT_MESSAGE_ID,
        lastUserMessageText: "Thread reply",
        lastUserFileParts: [],
      }),
    );
    expect(createCoworkerConversationMock).not.toHaveBeenCalled();

    const streamArgs = streamTextMock.mock.calls[0]![0] as {
      messages: unknown[];
      providerOptions: {
        sokosumi: { providerConversationId: string | null };
      };
      onFinish: (finishEvent: { text: string }) => Promise<void>;
    };
    expect(streamArgs.providerOptions.sokosumi.providerConversationId).toBe(
      "conv_thread_1",
    );
    expect(streamArgs.messages).toEqual([
      { role: "user", content: "thread prompt" },
    ]);

    await streamArgs.onFinish({ text: "Thread assistant reply" });
    expect(persistAssistantToChatRoomMock).toHaveBeenCalledWith(
      expect.objectContaining({
        roomId: ROOM_ID,
        contentText: "Thread assistant reply",
        parentMessageId: PARENT_MESSAGE_ID,
      }),
    );
  });

  it("forwards owned last-user file parts on thread turns", async () => {
    roomFindFirstMock.mockResolvedValue(roomWithOneCoworker());
    chatRoomMessageFindFirstMock.mockResolvedValue({
      id: PARENT_MESSAGE_ID,
      parentMessageId: null,
    });

    const response = await postStream({
      messages: [
        {
          role: "user",
          parts: [
            { type: "text", text: "Look" },
            {
              type: "file",
              url: OWNED_ROOM_FILE_URL,
              mediaType: "image/png",
              filename: "a.png",
            },
          ],
        },
      ],
      parentMessageId: PARENT_MESSAGE_ID,
    });

    expect(response.status).toBe(200);
    expect(buildRoomStreamThreadModelMessagesMock).toHaveBeenCalledWith(
      expect.objectContaining({
        lastUserMessageText: "Look",
        lastUserFileParts: [
          {
            type: "file",
            url: OWNED_ROOM_FILE_URL,
            mediaType: "image/png",
            filename: "a.png",
          },
        ],
      }),
    );
  });

  it("returns 400 when a file part is not this user's upload in this room", async () => {
    roomFindFirstMock.mockResolvedValue(roomWithOneCoworker());

    const otherRoom = await postStream({
      messages: [
        {
          role: "user",
          parts: [
            { type: "text", text: "Look" },
            {
              type: "file",
              url: OTHER_ROOM_FILE_URL,
              mediaType: "image/png",
              filename: "a.png",
            },
          ],
        },
      ],
    });
    const arbitraryHost = await postStream({
      messages: [
        {
          role: "user",
          parts: [
            { type: "text", text: "Look" },
            {
              type: "file",
              url: "https://example.com/a.png",
              mediaType: "image/png",
              filename: "a.png",
            },
          ],
        },
      ],
    });

    expect(otherRoom.status).toBe(400);
    expect(arbitraryHost.status).toBe(400);
    expect(streamTextMock).not.toHaveBeenCalled();
    expect(persistUserMessageToChatRoomMock).not.toHaveBeenCalled();
    expect(buildRoomStreamThreadModelMessagesMock).not.toHaveBeenCalled();
  });

  it("returns 400 when parentMessageId is not in the room", async () => {
    roomFindFirstMock.mockResolvedValue(roomWithOneCoworker());
    chatRoomMessageFindFirstMock.mockResolvedValue(null);

    const response = await postStream({
      messages: [
        { role: "user", parts: [{ type: "text", text: "Thread reply" }] },
      ],
      parentMessageId: PARENT_MESSAGE_ID,
    });

    expect(response.status).toBe(400);
    expect(streamTextMock).not.toHaveBeenCalled();
    expect(persistUserMessageToChatRoomMock).not.toHaveBeenCalled();
  });

  it("ensures providerConversationId on chatRoom when missing (no conversation* writes)", async () => {
    roomFindFirstMock
      .mockResolvedValueOnce(
        roomWithOneCoworker({ providerConversationId: null }),
      )
      .mockResolvedValueOnce({ providerConversationId: null });

    const response = await postStream();

    expect(response.status).toBe(200);

    expect(createCoworkerConversationMock).toHaveBeenCalledWith(
      expect.objectContaining({
        sokosumiUserId: USER_ID,
        sokosumiOrganizationId: "org_1",
        coworkerSlug: "hannah",
        sokosumiConversationId: ROOM_ID,
        responsesApiBaseUrl: "https://responses.example.com/v1",
      }),
    );
    expect(chatRoomUpdateManyMock).toHaveBeenCalledWith({
      where: {
        id: ROOM_ID,
        providerConversationId: null,
        userMembers: { some: { userId: USER_ID } },
      },
      data: { providerConversationId: "conv_new_1" },
    });

    const streamArgs = streamTextMock.mock.calls[0]![0] as {
      providerOptions: {
        sokosumi: { providerConversationId: string | null };
      };
    };
    expect(streamArgs.providerOptions.sokosumi.providerConversationId).toBe(
      "conv_new_1",
    );
  });

  it("persists assistant turn on stream onFinish via persistAssistantToChatRoom", async () => {
    roomFindFirstMock.mockResolvedValue(roomWithOneCoworker());

    const response = await postStream();
    expect(response.status).toBe(200);

    const streamCall = streamTextMock.mock.calls[0]![0] as {
      onFinish: (finishEvent: {
        text: string;
        reasoning?: unknown[];
      }) => Promise<void>;
    };

    await streamCall.onFinish({
      text: "Assistant reply",
      reasoning: [{ type: "reasoning", text: "step" }],
    });

    expect(persistAssistantToChatRoomMock).toHaveBeenCalledWith(
      expect.objectContaining({
        roomId: ROOM_ID,
        senderCoworkerId: COWORKER_ID,
        contentText: "Assistant reply",
        parentMessageId: null,
        thoughtTiming: expect.objectContaining({
          startedAtMs: expect.any(Number),
          endedAtMs: expect.any(Number),
        }),
      }),
    );
  });

  it("uses room.organizationId (not active session org) for personal rooms", async () => {
    roomFindFirstMock.mockResolvedValue(
      roomWithOneCoworker({
        organizationId: null,
        providerConversationId: null,
      }),
    );

    const response = await postStream(undefined, {
      actor: "user",
      userId: USER_ID,
      organizationId: "org_active_session",
      role: "user",
    });
    expect(response.status).toBe(200);

    expect(createCoworkerConversationMock).toHaveBeenCalledWith(
      expect.objectContaining({
        sokosumiOrganizationId: null,
      }),
    );

    const streamArgs = streamTextMock.mock.calls[0]![0] as {
      providerOptions: {
        sokosumi: { sokosumiOrganizationId: string | null };
      };
    };
    expect(streamArgs.providerOptions.sokosumi.sokosumiOrganizationId).toBe(
      null,
    );
  });

  it("registers active UI stream id via consumeSseStream when resumption is configured", async () => {
    isUiStreamResumptionConfiguredMock.mockReturnValue(true);
    roomFindFirstMock.mockResolvedValue(roomWithOneCoworker());

    const response = await postStream();
    expect(response.status).toBe(200);
    expect(clearActiveUiStreamIdForRoomMock).toHaveBeenCalledWith({
      roomId: ROOM_ID,
      userId: USER_ID,
    });

    const init = toUIMessageStreamResponseMock.mock.calls[0]![0] as {
      consumeSseStream?: (args: {
        stream: ReadableStream<string>;
      }) => Promise<void>;
    };
    expect(init.consumeSseStream).toEqual(expect.any(Function));

    const sseCopy = new ReadableStream<string>({
      start(controller) {
        controller.close();
      },
    });
    await init.consumeSseStream!({ stream: sseCopy });

    expect(createNewResumableStreamMock).toHaveBeenCalledWith(
      "generated-id-test",
      expect.any(Function),
    );
    expect(setActiveUiStreamIdForRoomMock).toHaveBeenCalledWith({
      roomId: ROOM_ID,
      userId: USER_ID,
      streamId: "generated-id-test",
    });
  });

  it("clears active UI stream id on UI onFinish after successful resumable registration", async () => {
    isUiStreamResumptionConfiguredMock.mockReturnValue(true);
    roomFindFirstMock.mockResolvedValue(roomWithOneCoworker());

    const response = await postStream();
    expect(response.status).toBe(200);
    expect(clearActiveUiStreamIdForRoomMock).toHaveBeenCalledTimes(1);

    const init = toUIMessageStreamResponseMock.mock.calls[0]![0] as {
      consumeSseStream?: (args: {
        stream: ReadableStream<string>;
      }) => Promise<void>;
      onFinish?: () => Promise<void>;
    };
    const sseCopy = new ReadableStream<string>({
      start(controller) {
        controller.close();
      },
    });
    await init.consumeSseStream!({ stream: sseCopy });
    await init.onFinish!();

    expect(clearActiveUiStreamIdForRoomMock).toHaveBeenCalledTimes(2);
    expect(clearActiveUiStreamIdForRoomMock).toHaveBeenLastCalledWith({
      roomId: ROOM_ID,
      userId: USER_ID,
    });
  });

  describe("pending response mirror", () => {
    it("returns 409 when a mirrored pending response is still in progress", async () => {
      roomFindFirstMock.mockResolvedValue(roomWithOneCoworker());
      getPendingResponseMirrorMock.mockResolvedValueOnce("resp_inflight");
      pollCoworkerResponseStatusMock.mockResolvedValueOnce({
        status: "in_progress",
        responseId: "resp_inflight",
      });

      const response = await postStream();

      expect(response.status).toBe(409);
      expect(pollCoworkerResponseStatusMock).toHaveBeenCalledWith(
        expect.objectContaining({ responseId: "resp_inflight" }),
      );
      expect(clearPendingResponseMirrorMock).not.toHaveBeenCalled();
      expect(streamTextMock).not.toHaveBeenCalled();
      expect(releaseStreamLockMock).toHaveBeenCalledWith(
        ROOM_ID,
        "instance-test:token-1",
      );
    });

    it("clears a completed mirrored pending response and proceeds", async () => {
      roomFindFirstMock.mockResolvedValue(roomWithOneCoworker());
      getPendingResponseMirrorMock.mockResolvedValueOnce("resp_done");
      pollCoworkerResponseStatusMock.mockResolvedValueOnce({
        status: "completed",
        responseId: "resp_done",
      });

      const response = await postStream();

      expect(response.status).toBe(200);
      expect(clearPendingResponseMirrorMock).toHaveBeenCalledWith({
        roomId: ROOM_ID,
        parentMessageId: null,
      });
      expect(streamTextMock).toHaveBeenCalledOnce();
    });

    it("returns 503 and clears mirror when pending status cannot be verified", async () => {
      roomFindFirstMock.mockResolvedValue(roomWithOneCoworker());
      getPendingResponseMirrorMock.mockResolvedValueOnce("resp_unknown");
      pollCoworkerResponseStatusMock.mockResolvedValueOnce({
        status: "error",
        responseId: "resp_unknown",
        cause: new Error("retrieve failed"),
      });

      const response = await postStream();

      expect(response.status).toBe(503);
      expect(clearPendingResponseMirrorMock).toHaveBeenCalledWith({
        roomId: ROOM_ID,
        parentMessageId: null,
      });
      expect(streamTextMock).not.toHaveBeenCalled();
      expect(releaseStreamLockMock).toHaveBeenCalledWith(
        ROOM_ID,
        "instance-test:token-1",
      );
    });

    it("sets the room-scoped mirror on response start and clears on completed", async () => {
      roomFindFirstMock.mockResolvedValue(roomWithOneCoworker());

      const response = await postStream();
      expect(response.status).toBe(200);

      const streamArgs = streamTextMock.mock.calls[0]![0] as {
        providerOptions: {
          sokosumi: {
            onResponseStarted: (id: string) => Promise<void>;
            onResponseCompleted: () => Promise<void>;
          };
        };
      };

      await streamArgs.providerOptions.sokosumi.onResponseStarted("resp_new");
      expect(setPendingResponseMirrorMock).toHaveBeenCalledWith(
        { roomId: ROOM_ID, parentMessageId: null },
        "resp_new",
      );

      await streamArgs.providerOptions.sokosumi.onResponseCompleted();
      expect(clearPendingResponseMirrorMock).toHaveBeenCalledWith({
        roomId: ROOM_ID,
        parentMessageId: null,
      });
    });

    it("scopes mirror get/set to the thread parentMessageId", async () => {
      roomFindFirstMock.mockResolvedValue(roomWithOneCoworker());
      chatRoomMessageFindFirstMock.mockResolvedValue({
        id: PARENT_MESSAGE_ID,
        parentMessageId: null,
      });

      const response = await postStream({
        messages: [
          { role: "user", parts: [{ type: "text", text: "Thread reply" }] },
        ],
        parentMessageId: PARENT_MESSAGE_ID,
      });
      expect(response.status).toBe(200);

      expect(getPendingResponseMirrorMock).toHaveBeenCalledWith({
        roomId: ROOM_ID,
        parentMessageId: PARENT_MESSAGE_ID,
      });

      const streamArgs = streamTextMock.mock.calls[0]![0] as {
        providerOptions: {
          sokosumi: {
            onResponseStarted: (id: string) => Promise<void>;
          };
        };
      };

      await streamArgs.providerOptions.sokosumi.onResponseStarted(
        "resp_thread",
      );
      expect(setPendingResponseMirrorMock).toHaveBeenCalledWith(
        { roomId: ROOM_ID, parentMessageId: PARENT_MESSAGE_ID },
        "resp_thread",
      );
    });
  });

  describe("quote", () => {
    it("persists quote snapshot in metadata on the user message", async () => {
      roomFindFirstMock.mockResolvedValue(roomWithOneCoworker());
      chatRoomMessageFindFirstMock.mockResolvedValue(quotedSourceMessage());

      const response = await postStream({
        messages: [
          {
            role: "user",
            parts: [{ type: "text", text: "agreeing with that" }],
          },
        ],
        quote: { messageId: QUOTE_MESSAGE_ID },
      });

      expect(response.status).toBe(200);
      expect(persistUserMessageToChatRoomMock).toHaveBeenCalledWith(
        expect.objectContaining({
          roomId: ROOM_ID,
          contentText: "agreeing with that",
          parentMessageId: null,
          metadata: { quote: quoteSnapshot },
        }),
      );
      expect(streamTextMock).toHaveBeenCalledOnce();
      expect(chatRoomMessageFindFirstMock).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: QUOTE_MESSAGE_ID, roomId: ROOM_ID, deletedAt: null },
        }),
      );
    });

    it("returns 400 when quoted message is missing or in another room", async () => {
      roomFindFirstMock.mockResolvedValue(roomWithOneCoworker());
      chatRoomMessageFindFirstMock.mockResolvedValue(null);

      const response = await postStream({
        messages: [
          { role: "user", parts: [{ type: "text", text: "quoting ghost" }] },
        ],
        quote: { messageId: QUOTE_MESSAGE_ID },
      });

      expect(response.status).toBe(400);
      expect(persistUserMessageToChatRoomMock).not.toHaveBeenCalled();
      expect(streamTextMock).not.toHaveBeenCalled();
      expect(acquireStreamLockMock).not.toHaveBeenCalled();
    });

    it("accepts quote and parentMessageId independently", async () => {
      roomFindFirstMock.mockResolvedValue(roomWithOneCoworker());
      chatRoomMessageFindFirstMock
        .mockResolvedValueOnce({
          id: PARENT_MESSAGE_ID,
          parentMessageId: null,
        })
        .mockResolvedValueOnce(quotedSourceMessage());

      const response = await postStream({
        messages: [
          {
            role: "user",
            parts: [{ type: "text", text: "thread reply that also quotes" }],
          },
        ],
        parentMessageId: PARENT_MESSAGE_ID,
        quote: { messageId: QUOTE_MESSAGE_ID },
      });

      expect(response.status).toBe(200);
      expect(persistUserMessageToChatRoomMock).toHaveBeenCalledWith(
        expect.objectContaining({
          roomId: ROOM_ID,
          contentText: "thread reply that also quotes",
          parentMessageId: PARENT_MESSAGE_ID,
          metadata: { quote: quoteSnapshot },
        }),
      );
      expect(ensureThreadProviderConversationMock).toHaveBeenCalledWith(
        expect.objectContaining({
          roomId: ROOM_ID,
          parentMessageId: PARENT_MESSAGE_ID,
        }),
      );
      expect(streamTextMock).toHaveBeenCalledOnce();
    });

    it("persists image attachment cue when quoting a message with an image link", async () => {
      roomFindFirstMock.mockResolvedValue(roomWithOneCoworker());
      chatRoomMessageFindFirstMock.mockResolvedValue(
        quotedSourceMessage({ content: imageQuoteContent }),
      );

      const response = await postStream({
        messages: [
          {
            role: "user",
            parts: [{ type: "text", text: "nice shot" }],
          },
        ],
        quote: { messageId: QUOTE_MESSAGE_ID },
      });

      expect(response.status).toBe(200);
      expect(persistUserMessageToChatRoomMock).toHaveBeenCalledWith(
        expect.objectContaining({
          roomId: ROOM_ID,
          contentText: "nice shot",
          parentMessageId: null,
          metadata: { quote: imageQuoteSnapshot },
        }),
      );
    });
  });

  describe("room stream lock", () => {
    it("returns 409 when the coworker stream lock is already held", async () => {
      roomFindFirstMock.mockResolvedValue(roomWithOneCoworker());
      acquireStreamLockMock.mockResolvedValueOnce({ status: "held" });

      const response = await postStream();

      expect(response.status).toBe(409);
      expect(streamTextMock).not.toHaveBeenCalled();
      expect(persistUserMessageToChatRoomMock).not.toHaveBeenCalled();
      expect(releaseStreamLockMock).not.toHaveBeenCalled();
      expect(startStreamLockHeartbeatMock).not.toHaveBeenCalled();
    });

    it("proceeds unlocked when redis is not configured", async () => {
      roomFindFirstMock.mockResolvedValue(roomWithOneCoworker());
      acquireStreamLockMock.mockResolvedValueOnce({ status: "unavailable" });

      const response = await postStream();

      expect(response.status).toBe(200);
      expect(streamTextMock).toHaveBeenCalledOnce();
      expect(startStreamLockHeartbeatMock).not.toHaveBeenCalled();
      expect(persistUserMessageToChatRoomMock).toHaveBeenCalledOnce();
    });

    it("returns 503 when redis is configured but lock acquire fails", async () => {
      roomFindFirstMock.mockResolvedValue(roomWithOneCoworker());
      acquireStreamLockMock.mockResolvedValueOnce({ status: "error" });

      const response = await postStream();

      expect(response.status).toBe(503);
      expect(streamTextMock).not.toHaveBeenCalled();
      expect(persistUserMessageToChatRoomMock).not.toHaveBeenCalled();
      expect(startStreamLockHeartbeatMock).not.toHaveBeenCalled();
      expect(releaseStreamLockMock).not.toHaveBeenCalled();
    });

    it("acquires the room lock before persisting the user message", async () => {
      roomFindFirstMock.mockResolvedValue(roomWithOneCoworker());
      const order: string[] = [];
      acquireStreamLockMock.mockImplementation(async () => {
        order.push("lock");
        return { status: "acquired", ownerToken: "instance-test:token-1" };
      });
      persistUserMessageToChatRoomMock.mockImplementation(async () => {
        order.push("persist");
        return { id: "msg_user_1" };
      });

      const response = await postStream();

      expect(response.status).toBe(200);
      expect(order).toEqual(["lock", "persist"]);
      expect(acquireStreamLockMock).toHaveBeenCalledWith(ROOM_ID);
      expect(startStreamLockHeartbeatMock).toHaveBeenCalledWith(
        ROOM_ID,
        "instance-test:token-1",
        expect.objectContaining({
          onRenew: expect.any(Function),
        }),
      );

      const heartbeatOptions = startStreamLockHeartbeatMock.mock
        .calls[0]![2] as {
        onRenew: () => Promise<void>;
      };
      await heartbeatOptions.onRenew();
      expect(renewPendingResponseMirrorMock).toHaveBeenCalledWith({
        roomId: ROOM_ID,
        parentMessageId: null,
      });
    });

    it("releases the stream lock on UI onFinish", async () => {
      roomFindFirstMock.mockResolvedValue(roomWithOneCoworker());
      const waitUntilPromises: Promise<unknown>[] = [];
      waitUntilMock.mockImplementation((promise: Promise<unknown>) => {
        waitUntilPromises.push(promise);
      });

      const response = await postStream();
      expect(response.status).toBe(200);

      const init = toUIMessageStreamResponseMock.mock.calls[0]![0] as {
        onFinish?: () => Promise<void>;
      };
      await init.onFinish!();
      expect(waitUntilPromises).toHaveLength(2);
      await Promise.all(waitUntilPromises);

      expect(clearPendingResponseMirrorMock).toHaveBeenCalledWith({
        roomId: ROOM_ID,
        parentMessageId: null,
      });
      expect(releaseStreamLockMock).toHaveBeenCalledWith(
        ROOM_ID,
        "instance-test:token-1",
      );
    });

    it("releases the stream lock when setup fails after the lock is acquired", async () => {
      roomFindFirstMock
        .mockResolvedValueOnce(
          roomWithOneCoworker({ providerConversationId: null }),
        )
        .mockResolvedValueOnce({ providerConversationId: null });
      createCoworkerConversationMock.mockRejectedValueOnce(
        new Error("provider down"),
      );

      const response = await postStream();

      expect(response.status).toBe(503);
      expect(releaseStreamLockMock).toHaveBeenCalledWith(
        ROOM_ID,
        "instance-test:token-1",
      );
      expect(streamTextMock).not.toHaveBeenCalled();
    });

    it("releases the stream lock when the UI stream errors before finish", async () => {
      const errors = expectCoreLogWhys(
        "error",
        "A coworker's chat reply stream failed",
        ["The UI message stream reported an error"],
      );
      roomFindFirstMock.mockResolvedValue(roomWithOneCoworker());
      const waitUntilPromises: Promise<unknown>[] = [];
      waitUntilMock.mockImplementation((promise: Promise<unknown>) => {
        waitUntilPromises.push(promise);
      });

      const response = await postStream();
      expect(response.status).toBe(200);

      const init = toUIMessageStreamResponseMock.mock.calls[0]![0] as {
        onError?: (error: unknown) => string;
      };
      // A provider's stream error can quote the prompt.
      expect(
        init.onError?.(new Error('Upstream rejected prompt "Hello"')),
      ).toBe("An error occurred.");
      expect(errors[0]?.cause).toBeUndefined();
      expect(errors[0]?.event).toMatchObject({
        operation: "chat_room_coworker_stream",
        roomId: ROOM_ID,
        coworkerId: COWORKER_ID,
        failure: { errorName: "Error" },
      });
      expect(JSON.stringify(errors[0]?.event)).not.toContain("Hello");
      expect(waitUntilPromises).toHaveLength(2);
      await Promise.all(waitUntilPromises);

      expect(clearPendingResponseMirrorMock).toHaveBeenCalledWith({
        roomId: ROOM_ID,
        parentMessageId: null,
      });
      expect(releaseStreamLockMock).toHaveBeenCalledWith(
        ROOM_ID,
        "instance-test:token-1",
      );
    });
  });

  describe("coworker chat log fields", () => {
    const captured: DrainContext[] = [];

    async function postStreamLogged(body?: unknown) {
      captured.length = 0;
      initCoreLogger({
        silent: true,
        drain: (ctx) => {
          captured.push(ctx);
        },
      });
      const inner = createApp();
      const app = new Hono();
      app.use(requestId());
      app.use(coreEvlogMiddleware());
      app.use(bindCoreRequestContext());
      app.onError(errorHandler);
      app.route("/", inner);
      return await app.request(`/${ROOM_ID}/stream`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(
          body ?? {
            messages: [
              { role: "user", parts: [{ type: "text", text: "Hello" }] },
            ],
          },
        ),
      });
    }

    it("puts room, coworker, and lock-held on the request event for a 409", async () => {
      roomFindFirstMock.mockResolvedValue(roomWithOneCoworker());
      acquireStreamLockMock.mockResolvedValueOnce({ status: "held" });

      const response = await postStreamLogged();

      expect(response.status).toBe(409);
      expect(captured).toHaveLength(1);
      expect(captured[0]?.event.chat).toEqual({
        kind: "coworker_direct_stream",
        room: { id: ROOM_ID },
        coworker: { id: COWORKER_ID, slug: "hannah" },
        lock: { status: "held" },
      });
      expect(captured[0]?.event.coworker).toBeUndefined();
      expect(JSON.stringify(captured[0]?.event.chat)).not.toContain("Hello");
    });

    it("puts lock-error on the request event for a 503", async () => {
      roomFindFirstMock.mockResolvedValue(roomWithOneCoworker());
      acquireStreamLockMock.mockResolvedValueOnce({ status: "error" });

      const response = await postStreamLogged();

      expect(response.status).toBe(503);
      expect(captured[0]?.event.chat).toEqual({
        kind: "coworker_direct_stream",
        room: { id: ROOM_ID },
        coworker: { id: COWORKER_ID, slug: "hannah" },
        lock: { status: "error" },
      });
    });

    it("puts lock-acquired on the request event for a successful stream", async () => {
      roomFindFirstMock.mockResolvedValue(roomWithOneCoworker());

      const response = await postStreamLogged();

      expect(response.status).toBe(200);
      expect(captured[0]?.event.chat).toEqual({
        kind: "coworker_direct_stream",
        room: { id: ROOM_ID },
        coworker: { id: COWORKER_ID, slug: "hannah" },
        lock: { status: "acquired" },
      });
    });

    it("puts lock-unavailable when redis is not configured", async () => {
      roomFindFirstMock.mockResolvedValue(roomWithOneCoworker());
      acquireStreamLockMock.mockResolvedValueOnce({ status: "unavailable" });

      const response = await postStreamLogged();

      expect(response.status).toBe(200);
      expect(captured[0]?.event.chat).toMatchObject({
        lock: { status: "unavailable" },
      });
    });

    it("includes thread parent on a thread reply stream", async () => {
      roomFindFirstMock.mockResolvedValue(roomWithOneCoworker());
      chatRoomMessageFindFirstMock.mockResolvedValue({
        id: PARENT_MESSAGE_ID,
        parentMessageId: null,
      });

      const response = await postStreamLogged({
        messages: [
          { role: "user", parts: [{ type: "text", text: "Thread reply" }] },
        ],
        parentMessageId: PARENT_MESSAGE_ID,
      });

      expect(response.status).toBe(200);
      expect(captured[0]?.event.chat).toEqual({
        kind: "coworker_direct_stream",
        room: { id: ROOM_ID },
        coworker: { id: COWORKER_ID, slug: "hannah" },
        thread: { parentMessageId: PARENT_MESSAGE_ID },
        lock: { status: "acquired" },
      });
    });

    it("does not set chat fields when the room is not a 1:1 coworker direct", async () => {
      roomFindFirstMock.mockResolvedValue(
        roomWithOneCoworker({ coworkerMembers: [] }),
      );

      const response = await postStreamLogged();

      expect(response.status).toBe(400);
      expect(captured[0]?.event.chat).toBeUndefined();
    });
  });
});

/** Error text that carries a prompt and a key, as a dependency error can. */
const PRIVATE_TEXT = "Quarterly secrets sk_live_51PrivateKeyValue";
const privateError = () => new Error(`write failed near "${PRIVATE_TEXT}"`);

/** The entry keeps only content-free fields: no cause, no error text. */
function expectContentFree(entry: CoreLogEntry | undefined) {
  expect(entry?.cause).toBeUndefined();
  expect(entry?.event.failure).toEqual({ errorName: "Error" });
  expect(JSON.stringify(entry?.event)).not.toContain("Quarterly");
  expect(JSON.stringify(entry?.event)).not.toContain("sk_live");
}

describe("POST /chats/rooms/:id/stream events", () => {
  type UiStreamInit = {
    onError?: (error: unknown) => string;
    onFinish?: () => Promise<void>;
    consumeSseStream?: (args: {
      stream: ReadableStream<string>;
    }) => Promise<void>;
  };
  const closedStream = () =>
    new ReadableStream<string>({
      start(controller) {
        controller.close();
      },
    });

  it("frees the lock as background work when the stream fails before the response leaves", async () => {
    expectBackgroundProbe("clearPendingResponseMirror");
    expectBackgroundProbe("releaseStreamLock");
    expectCoreLog("error", "A coworker's chat reply stream failed");
    roomFindFirstMock.mockResolvedValue(roomWithOneCoworker());
    const pending: Promise<unknown>[] = [];
    waitUntilMock.mockImplementation((promise: Promise<unknown>) => {
      pending.push(promise);
    });
    clearPendingResponseMirrorMock.mockImplementationOnce(async () => {
      probeBackgroundFailure("clearPendingResponseMirror");
    });
    releaseStreamLockMock.mockImplementationOnce(async () => {
      probeBackgroundFailure("releaseStreamLock");
      return true;
    });
    // A stream that errors at once runs onError while the request is live.
    toUIMessageStreamResponseMock.mockImplementationOnce(
      (init: UiStreamInit) => {
        init.onError?.(new Error("stream boom"));
        return new Response(null, { status: 200 });
      },
    );

    const response = await createApp(userAuthContext, { evlog: true }).request(
      `/${ROOM_ID}/stream`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          messages: [{ role: "user", parts: [{ type: "text", text: "Hi" }] }],
        }),
      },
    );
    await Promise.all(pending);

    expect(response.status).toBe(200);
  });

  it("logs each failed save of the reply without its text, then gives up", async () => {
    const errors = expectCoreLogWhys(
      "error",
      "Could not save a coworker's streamed reply",
      [
        "Writing the reply to the room failed",
        "Writing the reply to the room failed",
        "Writing the reply to the room failed",
      ],
    );
    roomFindFirstMock.mockResolvedValue(roomWithOneCoworker());
    // A database error quotes the values it was writing.
    persistAssistantToChatRoomMock.mockRejectedValue(
      new Error('Invalid value for "contentText": "Quarterly secrets"'),
    );
    await postStream();
    const streamCall = streamTextMock.mock.calls[0]![0] as {
      onFinish: (finishEvent: { text: string }) => Promise<void>;
    };

    await expect(
      streamCall.onFinish({ text: "Quarterly secrets" }),
    ).rejects.toThrow();

    expect(errors.map((entry) => entry.event.attempt)).toEqual([1, 2, 3]);
    for (const entry of errors) {
      expect(entry.cause).toBeUndefined();
      expect(entry.event.failure).toEqual({ errorName: "Error" });
      expect(JSON.stringify(entry.event)).not.toContain("Quarterly");
    }
  });

  it("logs a failed resumable registration without the stream's text", async () => {
    const errors = expectCoreLogWhys(
      "error",
      "Could not make a chat reply stream resumable",
      ["Registering the stream for resumption failed"],
    );
    isUiStreamResumptionConfiguredMock.mockReturnValue(true);
    roomFindFirstMock.mockResolvedValue(roomWithOneCoworker());
    createNewResumableStreamMock.mockRejectedValueOnce(
      new Error('Redis rejected chunk "Quarterly secrets"'),
    );
    await postStream();
    const init = toUIMessageStreamResponseMock.mock
      .calls[0]![0] as UiStreamInit;

    await init.consumeSseStream!({ stream: closedStream() });

    expect(errors[0]?.cause).toBeUndefined();
    expect(JSON.stringify(errors[0]?.event)).not.toContain("Quarterly");
  });

  it("logs each failed clear of a finished stream's id as its own error, without the error's text", async () => {
    const first = expectCoreLogWhys(
      "error",
      "Could not clear a finished chat stream's id on the first try",
      ["Writing the room's stream metadata failed"],
    );
    const retry = expectCoreLogWhys(
      "error",
      "Gave up clearing a finished chat stream's id",
      ["Writing the room's stream metadata failed twice"],
    );
    isUiStreamResumptionConfiguredMock.mockReturnValue(true);
    roomFindFirstMock.mockResolvedValue(roomWithOneCoworker());
    await postStream();
    const init = toUIMessageStreamResponseMock.mock
      .calls[0]![0] as UiStreamInit;
    await init.consumeSseStream!({ stream: closedStream() });
    clearActiveUiStreamIdForRoomMock
      .mockRejectedValueOnce(privateError())
      .mockRejectedValueOnce(privateError());

    await init.onFinish!();

    expect(clearActiveUiStreamIdForRoomMock).toHaveBeenCalledTimes(3);
    expect(first[0]?.level).toBe("error");
    expect(retry[0]?.level).toBe("error");
    expectContentFree(first[0]);
    expectContentFree(retry[0]);
  });

  it("logs a first failed clear as an error when the retry succeeds", async () => {
    const first = expectCoreLog(
      "error",
      "Could not clear a finished chat stream's id on the first try",
    );
    expectCoreLog("error", "Gave up clearing a finished chat stream's id", 0);
    expectCoreLog("warn", "Could not clear a finished chat stream's id", 0);
    isUiStreamResumptionConfiguredMock.mockReturnValue(true);
    roomFindFirstMock.mockResolvedValue(roomWithOneCoworker());
    await postStream();
    const init = toUIMessageStreamResponseMock.mock
      .calls[0]![0] as UiStreamInit;
    await init.consumeSseStream!({ stream: closedStream() });
    clearActiveUiStreamIdForRoomMock.mockRejectedValueOnce(privateError());

    await init.onFinish!();

    expect(clearActiveUiStreamIdForRoomMock).toHaveBeenCalledTimes(3);
    expect(first[0]?.event.method).toBeUndefined();
    expectContentFree(first[0]);
  });

  it("still streams when the previous stream id cannot be cleared", async () => {
    const errors = expectCoreLogWhys(
      "error",
      "Could not clear a chat room's previous stream id",
      ["Writing the room's stream metadata failed before the new stream"],
    );
    isUiStreamResumptionConfiguredMock.mockReturnValue(true);
    roomFindFirstMock.mockResolvedValue(roomWithOneCoworker());
    clearActiveUiStreamIdForRoomMock.mockRejectedValueOnce(privateError());

    const response = await postStream();

    expect(response.status).toBe(200);
    expect(errors[0]?.event).toMatchObject({ roomId: ROOM_ID });
    expectContentFree(errors[0]);
  });

  it("logs a lock it could not release while the request fails", async () => {
    const errors = expectCoreLogWhys(
      "error",
      "Could not release a chat room's coworker stream lock",
      ["Releasing the lock in Redis failed while the request was failing"],
    );
    roomFindFirstMock
      .mockResolvedValueOnce(
        roomWithOneCoworker({ providerConversationId: null }),
      )
      .mockResolvedValueOnce({ providerConversationId: null });
    createCoworkerConversationMock.mockRejectedValueOnce(
      new Error("provider down"),
    );
    releaseStreamLockMock.mockRejectedValueOnce(privateError());

    const response = await postStream();

    expect(response.status).toBe(503);
    expectContentFree(errors[0]);
  });

  it("logs a room conversation id it could not reset", async () => {
    const errors = expectCoreLogWhys(
      "error",
      "Could not reset a chat room's coworker conversation",
      ["Clearing the invalid conversation id on the room failed"],
    );
    roomFindFirstMock.mockResolvedValue(roomWithOneCoworker());
    await postStream();
    const streamArgs = streamTextMock.mock.calls[0]![0] as {
      providerOptions: {
        sokosumi: { onInvalidProviderConversationId: () => Promise<void> };
      };
    };
    chatRoomUpdateMock.mockRejectedValueOnce(privateError());

    await streamArgs.providerOptions.sokosumi.onInvalidProviderConversationId();

    expectContentFree(errors[0]);
  });

  it("logs a thread conversation id it could not reset, without the error's text", async () => {
    const errors = expectCoreLogWhys(
      "error",
      "Could not reset a thread's coworker conversation",
      ["Clearing the invalid conversation id on the thread failed"],
    );
    roomFindFirstMock.mockResolvedValue(roomWithOneCoworker());
    chatRoomMessageFindFirstMock.mockResolvedValue({
      id: PARENT_MESSAGE_ID,
      parentMessageId: null,
    });
    await postStream({
      messages: [{ role: "user", parts: [{ type: "text", text: "Thread" }] }],
      parentMessageId: PARENT_MESSAGE_ID,
    });
    const streamArgs = streamTextMock.mock.calls[0]![0] as {
      providerOptions: {
        sokosumi: { onInvalidProviderConversationId: () => Promise<void> };
      };
    };
    deleteChatRoomMessageMetadataKeysMock.mockRejectedValueOnce(privateError());

    await streamArgs.providerOptions.sokosumi.onInvalidProviderConversationId();

    expectContentFree(errors[0]);
  });
});
