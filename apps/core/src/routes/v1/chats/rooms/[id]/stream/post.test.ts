import { OpenAPIHono } from "@hono/zod-openapi";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { OpenAPIHonoWithAuth } from "@/lib/hono";
import { defaultValidationHook } from "@/lib/hono";
import type { AuthVariables } from "@/middleware/auth";

import mountPostRoomStream from "./post";

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
  requireCoworkerChatCapabilityMock,
  createCoworkerConversationMock,
  streamTextMock,
  toUIMessageStreamResponseMock,
  convertToModelMessagesMock,
  validateUIMessagesMock,
  getSokosumiProviderMock,
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
  requireCoworkerChatCapabilityMock: vi.fn(),
  createCoworkerConversationMock: vi.fn(),
  streamTextMock: vi.fn(),
  toUIMessageStreamResponseMock: vi.fn(),
  convertToModelMessagesMock: vi.fn(),
  validateUIMessagesMock: vi.fn(),
  getSokosumiProviderMock: vi.fn(),
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
  waitUntil: (...args: unknown[]) => waitUntilMock(...args),
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
  requireCoworkerChatCapability: requireCoworkerChatCapabilityMock,
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
  },
}));

const ROOM_ID = "550e8400-e29b-41d4-a716-446655440000";
const USER_ID = "user_123";
const COWORKER_ID = "coworker_1";
const PARENT_MESSAGE_ID = "550e8400-e29b-41d4-a716-446655440099";
const QUOTE_MESSAGE_ID = "550e8400-e29b-41d4-a716-446655440004";

const quoteSnapshot = {
  messageId: QUOTE_MESSAGE_ID,
  authorName: "Alice",
  snippet: "Earlier point about launch risk",
  attachment: null,
};

const imageQuoteContent =
  "see this [launch.png](https://blob.example/launch.png)";
const imageQuoteSnapshot = {
  messageId: QUOTE_MESSAGE_ID,
  authorName: "Alice",
  snippet: "see this",
  attachment: {
    fileName: "launch.png",
    url: "https://blob.example/launch.png",
    mediaKind: "image" as const,
  },
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
) {
  const app = new OpenAPIHono<{ Variables: AuthVariables }>({
    defaultHook: defaultValidationHook,
  });

  app.use("*", async (c, next) => {
    c.set("isAuthenticated", true);
    c.set("authContext", authContext);
    return await next();
  });

  mountPostRoomStream(app as unknown as OpenAPIHonoWithAuth);
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
  prismaTransactionMock.mockImplementation(async (callback) =>
    callback({
      chatRoom: {
        findFirst: roomFindFirstMock,
      },
      chatRoomMessage: {
        findFirst: chatRoomMessageFindFirstMock,
      },
      organization: {
        findUnique: organizationFindUniqueMock,
      },
      member: {
        findUnique: memberFindUniqueMock,
      },
    }),
  );
  organizationFindUniqueMock.mockResolvedValue({ id: "org_1" });
  memberFindUniqueMock.mockResolvedValue({ role: "member" });
  convertToModelMessagesMock.mockResolvedValue([]);
  validateUIMessagesMock.mockImplementation(
    async ({ messages }: { messages: unknown[] }) => messages,
  );
  getSokosumiProviderMock.mockReturnValue(() => ({}));
  requireCoworkerChatCapabilityMock.mockResolvedValue({
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
      onChunk: (args: { chunk: { type: string } }) => void;
      onFinish: (finishEvent: {
        text: string;
        reasoning?: unknown[];
      }) => Promise<void>;
    };

    streamCall.onChunk({ chunk: { type: "reasoning-start" } });
    streamCall.onChunk({ chunk: { type: "reasoning-delta" } });
    streamCall.onChunk({ chunk: { type: "reasoning-end" } });

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
          where: { id: QUOTE_MESSAGE_ID, roomId: ROOM_ID },
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
      expect(init.onError?.(new Error("stream boom"))).toBe(
        "An error occurred.",
      );
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
});
