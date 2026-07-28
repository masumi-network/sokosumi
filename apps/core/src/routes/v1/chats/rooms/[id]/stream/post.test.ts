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
  conversationCreateMock,
  conversationMessageCreateMock,
  persistUserMessageToChatRoomMock,
  persistAssistantToChatRoomMock,
} = vi.hoisted(() => ({
  roomFindFirstMock: vi.fn(),
  chatRoomUpdateMock: vi.fn(),
  chatRoomUpdateManyMock: vi.fn(),
  chatRoomMessageCreateMock: vi.fn(),
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
  conversationCreateMock: vi.fn(),
  conversationMessageCreateMock: vi.fn(),
  persistUserMessageToChatRoomMock: vi.fn(),
  persistAssistantToChatRoomMock: vi.fn(),
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

vi.mock("@/helpers/persist-assistant-to-chat-room", () => ({
  persistAssistantToChatRoom: persistAssistantToChatRoomMock,
  persistUserMessageToChatRoom: persistUserMessageToChatRoomMock,
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
    },
    organization: {
      findUnique: organizationFindUniqueMock,
    },
    member: {
      findUnique: memberFindUniqueMock,
    },
    conversation: {
      create: conversationCreateMock,
    },
    conversationMessage: {
      create: conversationMessageCreateMock,
    },
  },
}));

const ROOM_ID = "550e8400-e29b-41d4-a716-446655440000";
const USER_ID = "user_123";
const COWORKER_ID = "coworker_1";

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
    providerConversationId?: string | null;
    coworkerMembers?: Array<{
      coworker: { id: string; name: string; slug: string };
    }>;
  } = {},
) {
  return {
    id: ROOM_ID,
    organizationId: "org_1",
    providerConversationId:
      "providerConversationId" in overrides
        ? (overrides.providerConversationId ?? null)
        : "conv_remote_1",
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

async function postStream(body?: unknown) {
  const app = createApp();
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
    expect(conversationCreateMock).not.toHaveBeenCalled();
    expect(conversationMessageCreateMock).not.toHaveBeenCalled();
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
    expect(chatRoomUpdateManyMock).not.toHaveBeenCalled();
    expect(conversationCreateMock).not.toHaveBeenCalled();
    expect(conversationMessageCreateMock).not.toHaveBeenCalled();
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

    expect(conversationCreateMock).not.toHaveBeenCalled();
    expect(conversationMessageCreateMock).not.toHaveBeenCalled();
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
      reasoning: [],
    });

    expect(persistAssistantToChatRoomMock).toHaveBeenCalledWith(
      expect.objectContaining({
        roomId: ROOM_ID,
        senderCoworkerId: COWORKER_ID,
        contentText: "Assistant reply",
      }),
    );
    expect(conversationCreateMock).not.toHaveBeenCalled();
    expect(conversationMessageCreateMock).not.toHaveBeenCalled();
  });
});
