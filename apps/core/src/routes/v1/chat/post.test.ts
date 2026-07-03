import { OpenAPIHono } from "@hono/zod-openapi";
import { HTTPException } from "hono/http-exception";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { LIMITS } from "@/config/constants";
import type { OpenAPIHonoWithAuth } from "@/lib/hono";
import { defaultValidationHook } from "@/lib/hono";
import type { AuthVariables } from "@/middleware/auth";

import { CoworkerConversationError } from "./coworker-conversation";
import mountPostChat from "./post";

const {
  acquireStreamLockMock,
  clearActiveUiStreamIdInMetadataMock,
  clearPendingResponseIdMock,
  clearPendingResponseMirrorMock,
  conversationFindFirstMock,
  conversationMessageCreateMock,
  conversationMessageFindManyMock,
  conversationUpdateMock,
  conversationUpdateManyMock,
  convertToModelMessagesMock,
  coworkerFindFirstMock,
  createCoworkerConversationMock,
  ensureCoworkerProviderConversationMock,
  createNewResumableStreamMock,
  generateChatTitleMock,
  getOpenRouterChatApiKeyForProviderMock,
  getPendingResponseMirrorMock,
  getRedisClientMock,
  getSokosumiProviderMock,
  isUiStreamResumptionConfiguredMock,
  pollCoworkerResponseStatusMock,
  prismaTransactionMock,
  releaseStreamLockMock,
  requireConversationCoworkerAccessMock,
  requireCoworkerChatCapabilityMock,
  setActiveUiStreamIdInMetadataMock,
  setPendingResponseMirrorMock,
  startStreamLockHeartbeatMock,
  streamTextMock,
  toUIMessageStreamResponseMock,
  uploadGeneratedChatImageMock,
  validateUIMessagesMock,
  waitUntilCapturedPromises,
} = vi.hoisted(() => ({
  acquireStreamLockMock: vi.fn(),
  clearActiveUiStreamIdInMetadataMock: vi.fn(),
  clearPendingResponseIdMock: vi.fn(),
  clearPendingResponseMirrorMock: vi.fn(),
  conversationFindFirstMock: vi.fn(),
  conversationMessageCreateMock: vi.fn(),
  conversationMessageFindManyMock: vi.fn(),
  conversationUpdateMock: vi.fn(),
  conversationUpdateManyMock: vi.fn(),
  convertToModelMessagesMock: vi.fn(),
  coworkerFindFirstMock: vi.fn(),
  createCoworkerConversationMock: vi.fn(),
  ensureCoworkerProviderConversationMock: vi.fn(),
  createNewResumableStreamMock: vi.fn(),
  generateChatTitleMock: vi.fn(),
  getOpenRouterChatApiKeyForProviderMock: vi.fn(),
  getPendingResponseMirrorMock: vi.fn(),
  getRedisClientMock: vi.fn(),
  getSokosumiProviderMock: vi.fn(),
  isUiStreamResumptionConfiguredMock: vi.fn(() => false),
  pollCoworkerResponseStatusMock: vi.fn(),
  prismaTransactionMock: vi.fn(),
  releaseStreamLockMock: vi.fn(),
  requireConversationCoworkerAccessMock: vi.fn(),
  requireCoworkerChatCapabilityMock: vi.fn(),
  setActiveUiStreamIdInMetadataMock: vi.fn(),
  setPendingResponseMirrorMock: vi.fn(),
  startStreamLockHeartbeatMock: vi.fn(() => vi.fn()),
  streamTextMock: vi.fn(),
  toUIMessageStreamResponseMock: vi.fn(),
  uploadGeneratedChatImageMock: vi.fn(),
  validateUIMessagesMock: vi.fn(),
  waitUntilCapturedPromises: [] as Promise<unknown>[],
}));

vi.mock("ai", () => ({
  convertToModelMessages: convertToModelMessagesMock,
  generateId: vi.fn(() => "generated-id-test"),
  streamText: streamTextMock,
  validateUIMessages: validateUIMessagesMock,
}));

vi.mock("@/lib/sokosumi-ai-provider", () => ({
  getOpenRouterChatApiKeyForProvider: getOpenRouterChatApiKeyForProviderMock,
  getSokosumiProvider: getSokosumiProviderMock,
}));

vi.mock("@/helpers/access-control", () => ({
  requireConversationCoworkerAccess: requireConversationCoworkerAccessMock,
  requireCoworkerChatCapability: requireCoworkerChatCapabilityMock,
}));

vi.mock("./coworker-conversation", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("./coworker-conversation")>();
  return {
    ...actual,
    createCoworkerConversation: (...args: unknown[]) =>
      createCoworkerConversationMock(...args),
    ensureCoworkerProviderConversation: (...args: unknown[]) =>
      ensureCoworkerProviderConversationMock(...args),
  };
});

vi.mock("@/clients/openrouter.client", () => ({
  openrouterClient: {
    generateChatTitle: generateChatTitleMock,
  },
}));

vi.mock("@/lib/db/prisma", () => ({
  default: {
    $transaction: prismaTransactionMock,
    conversation: {
      findFirst: conversationFindFirstMock,
      update: conversationUpdateMock,
      updateMany: conversationUpdateManyMock,
    },
    conversationMessage: {
      create: conversationMessageCreateMock,
      findMany: conversationMessageFindManyMock,
    },
    coworker: {
      findFirst: coworkerFindFirstMock,
    },
  },
}));

vi.mock("@vercel/functions", () => ({
  waitUntil: (promise: Promise<unknown>) => {
    waitUntilCapturedPromises.push(promise);
  },
}));

vi.mock("@/helpers/active-ui-stream-metadata", () => ({
  ACTIVE_UI_STREAM_ID_METADATA_KEY: "active_ui_stream_id",
  clearActiveUiStreamIdInMetadata: clearActiveUiStreamIdInMetadataMock,
  setActiveUiStreamIdInMetadata: setActiveUiStreamIdInMetadataMock,
}));

vi.mock("@/lib/resumable-ui-stream-context", () => ({
  isUiStreamResumptionConfigured: () => isUiStreamResumptionConfiguredMock(),
  getResumableUiStreamContext: vi.fn(() => ({
    createNewResumableStream: createNewResumableStreamMock,
  })),
}));

vi.mock("@/lib/blob", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/blob")>();
  return {
    ...actual,
    uploadGeneratedChatImage: (...args: unknown[]) =>
      uploadGeneratedChatImageMock(...args),
  };
});

vi.mock("@/lib/redis", () => ({
  getRedisClient: getRedisClientMock,
}));

vi.mock("@/helpers/coworker-stream-lock", () => ({
  acquireStreamLock: acquireStreamLockMock,
  releaseStreamLock: releaseStreamLockMock,
  startStreamLockHeartbeat: startStreamLockHeartbeatMock,
}));

vi.mock("@/helpers/coworker-response-poll", () => ({
  pollCoworkerResponseStatus: pollCoworkerResponseStatusMock,
}));

vi.mock("@/helpers/coworker-pending-response-mirror", () => ({
  getPendingResponseMirror: getPendingResponseMirrorMock,
  setPendingResponseMirror: setPendingResponseMirrorMock,
  clearPendingResponseMirror: clearPendingResponseMirrorMock,
}));

vi.mock("@/helpers/persist-pending-response-id", () => ({
  persistPendingResponseId: vi.fn(),
  clearPendingResponseId: clearPendingResponseIdMock,
  clearPendingAndSetPrevious: vi.fn(),
  clearCoworkerResponseChain: vi.fn(),
}));

function setupCoworkerChatConversation(
  metadata: Record<string, unknown> = { coworker_slug: "ops-agent" },
) {
  const cid = "550e8400-e29b-41d4-a716-446655440000";
  conversationFindFirstMock.mockResolvedValueOnce({
    id: cid,
    metadata,
    providerConversationId: "conv_remote_1",
  });
  coworkerFindFirstMock.mockResolvedValueOnce({ id: "cow_123" });
  return cid;
}

function createApp({
  authContext = {
    actor: "user",
    userId: "user_123",
    organizationId: null,
    role: "user",
  },
}: {
  authContext?: AuthVariables["authContext"];
} = {}) {
  const app = new OpenAPIHono<{
    Variables: AuthVariables;
  }>({
    defaultHook: defaultValidationHook,
  });

  app.use("*", async (c, next) => {
    c.set("isAuthenticated", true);
    c.set("authContext", authContext);
    return await next();
  });

  mountPostChat(app as unknown as OpenAPIHonoWithAuth);
  return app;
}

describe("POST /chat", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    waitUntilCapturedPromises.length = 0;
    getOpenRouterChatApiKeyForProviderMock.mockReturnValue(
      "sk-or-v1-test-0000000000000000000000000000000000000000",
    );
    getSokosumiProviderMock.mockReturnValue(() => ({}));
    convertToModelMessagesMock.mockResolvedValue([]);
    conversationMessageCreateMock.mockResolvedValue(undefined);
    conversationMessageFindManyMock.mockResolvedValue([]);
    conversationUpdateMock.mockResolvedValue(undefined);
    conversationUpdateManyMock.mockResolvedValue({ count: 1 });
    prismaTransactionMock.mockImplementation(
      async (
        callback: (tx: {
          $queryRaw: ReturnType<typeof vi.fn>;
          conversationMessage: {
            count: ReturnType<typeof vi.fn>;
            create: typeof conversationMessageCreateMock;
          };
        }) => Promise<boolean>,
      ) =>
        await callback({
          $queryRaw: vi.fn().mockResolvedValue([{ id: "conv" }]),
          conversationMessage: {
            count: vi.fn().mockResolvedValue(1),
            create: conversationMessageCreateMock,
          },
        }),
    );
    createCoworkerConversationMock.mockResolvedValue({ id: "conv_test_1" });
    ensureCoworkerProviderConversationMock.mockImplementation(
      async (options: {
        internalConversationId: string;
        userId: string;
        organizationId: string | null;
        coworkerSlug: string;
        responsesApiBaseUrl: string;
      }) => {
        const created = await createCoworkerConversationMock({
          responsesApiBaseUrl: options.responsesApiBaseUrl,
          sokosumiUserId: options.userId,
          sokosumiOrganizationId: options.organizationId,
          coworkerSlug: options.coworkerSlug,
          sokosumiConversationId: options.internalConversationId,
        });
        return {
          providerConversationId: created.id,
          justCreated: true,
        };
      },
    );
    validateUIMessagesMock.mockImplementation(
      async ({ messages }: { messages: unknown[] }) => messages,
    );
    generateChatTitleMock.mockResolvedValue(null);
    isUiStreamResumptionConfiguredMock.mockReturnValue(false);
    createNewResumableStreamMock.mockResolvedValue(
      new ReadableStream<string>({
        start(controller) {
          controller.close();
        },
      }),
    );
    setActiveUiStreamIdInMetadataMock.mockResolvedValue(undefined);
    clearActiveUiStreamIdInMetadataMock.mockResolvedValue(undefined);
    uploadGeneratedChatImageMock.mockResolvedValue({
      url: "https://blob.example.com/generated.png",
      mediaType: "image/png",
      filename: "generated.png",
    });
    toUIMessageStreamResponseMock.mockReturnValue(
      new Response(null, {
        status: 200,
        headers: { "Content-Type": "text/event-stream" },
      }),
    );
    streamTextMock.mockReturnValue({
      toUIMessageStreamResponse: toUIMessageStreamResponseMock,
    });
    requireCoworkerChatCapabilityMock.mockResolvedValue({
      id: "cow_123",
      slug: "ops-agent",
      baseURL: "https://responses.example.com/v1",
    });
    requireConversationCoworkerAccessMock.mockResolvedValue(undefined);
    getRedisClientMock.mockReturnValue({ connected: true });
    acquireStreamLockMock.mockResolvedValue({
      status: "acquired",
      ownerToken: "instance-test:lock-token",
    });
    releaseStreamLockMock.mockResolvedValue(true);
    getPendingResponseMirrorMock.mockResolvedValue(null);
    pollCoworkerResponseStatusMock.mockResolvedValue({
      status: "completed",
      responseId: "resp_pending",
    });
    clearPendingResponseIdMock.mockResolvedValue(undefined);
    clearPendingResponseMirrorMock.mockResolvedValue(undefined);
    setPendingResponseMirrorMock.mockResolvedValue(undefined);
  });

  it("returns 422 when the JSON body fails OpenAPI / Zod validation", async () => {
    const app = createApp();
    const response = await app.request("http://localhost/", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        messages: "not-an-array",
      }),
    });

    expect(response.status).toBe(422);
    expect(streamTextMock).not.toHaveBeenCalled();
  });

  it("returns 422 when messages are missing and server-history mode is not used", async () => {
    const app = createApp();
    const response = await app.request("http://localhost/", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });

    expect(response.status).toBe(422);
    expect(streamTextMock).not.toHaveBeenCalled();
  });

  it("returns 422 when messages is an empty array", async () => {
    const app = createApp();
    const response = await app.request("http://localhost/", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ messages: [] }),
    });

    expect(response.status).toBe(422);
    expect(streamTextMock).not.toHaveBeenCalled();
  });

  it("returns 422 when conversationId and message are set without submit-message trigger", async () => {
    const app = createApp();
    const response = await app.request("http://localhost/", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        id: "550e8400-e29b-41d4-a716-446655440000",
        conversationId: "550e8400-e29b-41d4-a716-446655440000",
        message: { role: "user", parts: [{ type: "text", text: "Hi" }] },
      }),
    });

    expect(response.status).toBe(422);
    expect(streamTextMock).not.toHaveBeenCalled();
  });

  it("returns 404 when the conversation is missing", async () => {
    conversationFindFirstMock.mockResolvedValueOnce(null);

    const app = createApp();
    const response = await app.request("http://localhost/", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        id: "550e8400-e29b-41d4-a716-446655440000",
        conversationId: "550e8400-e29b-41d4-a716-446655440000",
        messages: [{ role: "user", parts: [{ type: "text", text: "Hi" }] }],
      }),
    });

    expect(response.status).toBe(404);
    expect(streamTextMock).not.toHaveBeenCalled();
  });

  it("accepts delegated coworker auth and uses the delegated user context", async () => {
    const cid = "550e8400-e29b-41d4-a716-446655440000";
    conversationFindFirstMock.mockResolvedValueOnce({
      id: cid,
      metadata: { coworker_slug: "ops-agent" },
      providerConversationId: null,
    });
    coworkerFindFirstMock.mockResolvedValueOnce({ id: "cow_123" });

    const app = createApp({
      authContext: {
        actor: "coworker",
        coworkerId: "cow_123",
        delegation: {
          userId: "delegated_user_123",
          organizationId: "delegated_org_123",
        },
      },
    });
    const response = await app.request("http://localhost/", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        id: cid,
        conversationId: cid,
        messages: [{ role: "user", parts: [{ type: "text", text: "Hi" }] }],
      }),
    });

    expect(response.status).toBe(200);
    expect(conversationFindFirstMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          id: cid,
          userId: "delegated_user_123",
        }),
      }),
    );
    expect(ensureCoworkerProviderConversationMock).toHaveBeenCalledWith({
      internalConversationId: cid,
      userId: "delegated_user_123",
      organizationId: "delegated_org_123",
      coworkerSlug: "ops-agent",
      responsesApiBaseUrl: "https://responses.example.com/v1",
    });
    const args = streamTextMock.mock.calls[0]![0] as {
      providerOptions?: {
        sokosumi?: {
          sokosumiUserId?: string | null;
          sokosumiOrganizationId?: string | null;
        };
      };
    };
    expect(args.providerOptions?.sokosumi?.sokosumiUserId).toBe(
      "delegated_user_123",
    );
    expect(args.providerOptions?.sokosumi?.sokosumiOrganizationId).toBe(
      "delegated_org_123",
    );
  });

  it("resolves the coworker by coworker_id, ignoring a divergent coworker_slug", async () => {
    const cid = "550e8400-e29b-41d4-a716-446655440000";
    conversationFindFirstMock.mockResolvedValueOnce({
      id: cid,
      metadata: { coworker_id: "cow_123", coworker_slug: "victim-agent" },
      providerConversationId: "conv_remote_1",
    });
    coworkerFindFirstMock.mockResolvedValueOnce({ id: "cow_123" });

    const app = createApp({
      authContext: {
        actor: "coworker",
        coworkerId: "cow_123",
        delegation: {
          userId: "delegated_user_123",
          organizationId: "delegated_org_123",
        },
      },
    });
    const response = await app.request("http://localhost/", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        id: cid,
        conversationId: cid,
        messages: [{ role: "user", parts: [{ type: "text", text: "Hi" }] }],
      }),
    });

    expect(response.status).toBe(200);
    expect(coworkerFindFirstMock).toHaveBeenCalledWith({
      where: { archivedAt: null, id: "cow_123" },
      select: { id: true },
    });
  });

  it("rejects a delegated coworker on a conversation assigned to another coworker", async () => {
    const cid = "550e8400-e29b-41d4-a716-446655440000";
    conversationFindFirstMock.mockResolvedValueOnce({
      id: cid,
      metadata: { coworker_id: "cow_other" },
      providerConversationId: null,
    });
    requireConversationCoworkerAccessMock.mockRejectedValueOnce(
      new HTTPException(403, {
        message: "You can only access conversations assigned to your coworker",
      }),
    );

    const app = createApp({
      authContext: {
        actor: "coworker",
        coworkerId: "cow_123",
        delegation: {
          userId: "delegated_user_123",
          organizationId: "delegated_org_123",
        },
      },
    });
    const response = await app.request("http://localhost/", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        id: cid,
        conversationId: cid,
        messages: [{ role: "user", parts: [{ type: "text", text: "Hi" }] }],
      }),
    });

    expect(response.status).toBe(403);
    expect(requireConversationCoworkerAccessMock).toHaveBeenCalled();
    expect(createCoworkerConversationMock).not.toHaveBeenCalled();
    expect(streamTextMock).not.toHaveBeenCalled();
  });

  it("rejects a delegated coworker chat without a conversationId", async () => {
    const app = createApp({
      authContext: {
        actor: "coworker",
        coworkerId: "cow_123",
        delegation: {
          userId: "delegated_user_123",
          organizationId: "delegated_org_123",
        },
      },
    });
    const response = await app.request("http://localhost/", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        messages: [{ role: "user", parts: [{ type: "text", text: "Hi" }] }],
      }),
    });

    expect(response.status).toBe(403);
    expect(conversationFindFirstMock).not.toHaveBeenCalled();
    expect(streamTextMock).not.toHaveBeenCalled();
  });

  it("rejects attachment-only system messages for coworker chats", async () => {
    const cid = "550e8400-e29b-41d4-a716-446655440000";
    conversationFindFirstMock.mockResolvedValueOnce({
      id: cid,
      metadata: { coworker_slug: "ops-agent" },
      providerConversationId: null,
    });
    coworkerFindFirstMock.mockResolvedValueOnce({ id: "cow_123" });

    const app = createApp();
    const response = await app.request("http://localhost/", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        id: cid,
        conversationId: cid,
        messages: [
          {
            role: "system",
            parts: [
              {
                type: "file",
                url: "https://example.com/brief.pdf",
                mediaType: "application/pdf",
                filename: "brief.pdf",
              },
            ],
          },
        ],
      }),
    });

    expect(response.status).toBe(400);
    expect(createCoworkerConversationMock).not.toHaveBeenCalled();
    expect(streamTextMock).not.toHaveBeenCalled();
  });

  it("accepts coworker chat when the last user message uses string content only", async () => {
    const cid = "550e8400-e29b-41d4-a716-446655440000";
    conversationFindFirstMock.mockResolvedValueOnce({
      id: cid,
      metadata: { coworker_slug: "ops-agent" },
      providerConversationId: "conv_remote_1",
    });
    coworkerFindFirstMock.mockResolvedValueOnce({ id: "cow_123" });

    const app = createApp();
    const response = await app.request("http://localhost/", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        id: cid,
        conversationId: cid,
        messages: [{ role: "user", content: "Hello from string content" }],
      }),
    });

    expect(response.status).toBe(200);
    expect(streamTextMock).toHaveBeenCalledOnce();
    const call = streamTextMock.mock.calls[0]![0] as {
      providerOptions?: { sokosumi?: { mode?: string } };
    };
    expect(call.providerOptions?.sokosumi?.mode).toBe("coworker");
  });

  it("rejects coworker auth without delegation headers for user-scoped chat", async () => {
    const app = createApp({
      authContext: {
        actor: "coworker",
        coworkerId: "cow_123",
      },
    });
    const response = await app.request("http://localhost/", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        messages: [{ role: "user", parts: [{ type: "text", text: "Hi" }] }],
      }),
    });

    expect(response.status).toBe(403);
    expect(conversationFindFirstMock).not.toHaveBeenCalled();
    expect(streamTextMock).not.toHaveBeenCalled();
  });

  it("returns 503 when OpenRouter chat key is missing for model chat", async () => {
    conversationFindFirstMock.mockResolvedValueOnce({
      id: "550e8400-e29b-41d4-a716-446655440000",
      metadata: { model_id: "claude-opus-4-6" },
    });
    getOpenRouterChatApiKeyForProviderMock.mockReturnValueOnce("");

    const app = createApp();
    const response = await app.request("http://localhost/", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        id: "550e8400-e29b-41d4-a716-446655440000",
        conversationId: "550e8400-e29b-41d4-a716-446655440000",
        messages: [{ role: "user", parts: [{ type: "text", text: "Hi" }] }],
      }),
    });

    expect(response.status).toBe(503);
    expect(streamTextMock).not.toHaveBeenCalled();
  });

  it("passes null to the Sokosumi provider when no model is resolved (matches legacy null)", async () => {
    const providerFactory = vi.fn(() => ({}));
    getSokosumiProviderMock.mockReturnValue(providerFactory);

    const app = createApp();
    const response = await app.request("http://localhost/", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        messages: [{ role: "user", parts: [{ type: "text", text: "Hi" }] }],
      }),
    });

    expect(response.status).toBe(200);
    expect(providerFactory).toHaveBeenCalledOnce();
    expect(providerFactory).toHaveBeenCalledWith(null);
  });

  it("calls streamText for OpenRouter-backed conversation", async () => {
    conversationFindFirstMock.mockResolvedValueOnce({
      id: "550e8400-e29b-41d4-a716-446655440000",
      metadata: { model_id: "claude-opus-4-6" },
    });

    const app = createApp();
    const response = await app.request("http://localhost/", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        id: "550e8400-e29b-41d4-a716-446655440000",
        conversationId: "550e8400-e29b-41d4-a716-446655440000",
        messages: [{ role: "user", parts: [{ type: "text", text: "Hi" }] }],
      }),
    });

    expect(response.status).toBe(200);
    expect(streamTextMock).toHaveBeenCalledOnce();
    const call = streamTextMock.mock.calls[0]![0] as {
      providerOptions?: {
        sokosumi?: { mode?: string; webSearchEnabled?: boolean };
      };
    };
    expect(call.providerOptions?.sokosumi?.mode).toBe("openrouter");
    expect(call.providerOptions?.sokosumi?.webSearchEnabled).toBe(true);
  });

  it("wires onInvalidProviderConversationId for coworker Conversations mode", async () => {
    conversationFindFirstMock.mockResolvedValueOnce({
      id: "550e8400-e29b-41d4-a716-446655440000",
      metadata: {
        coworker_slug: "ops-agent",
        previous_response_id: "resp_stale",
      },
      providerConversationId: "conv_remote_1",
    });
    coworkerFindFirstMock.mockResolvedValueOnce({ id: "cow_123" });

    const app = createApp({
      authContext: {
        actor: "user",
        userId: "user_123",
        organizationId: "org_1",
        role: "user",
      },
    });
    const response = await app.request("http://localhost/", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        id: "550e8400-e29b-41d4-a716-446655440000",
        conversationId: "550e8400-e29b-41d4-a716-446655440000",
        messages: [{ role: "user", parts: [{ type: "text", text: "Hi" }] }],
      }),
    });

    expect(response.status).toBe(200);
    expect(streamTextMock).toHaveBeenCalledOnce();
    const args = streamTextMock.mock.calls[0]![0] as {
      providerOptions?: {
        sokosumi?: {
          mode?: string;
          onInvalidProviderConversationId?: () => Promise<void>;
          previousResponseId?: string | null;
          providerConversationId?: string | null;
        };
      };
    };
    expect(args.providerOptions?.sokosumi?.mode).toBe("coworker");
    expect(args.providerOptions?.sokosumi?.providerConversationId).toBe(
      "conv_remote_1",
    );
    expect(args.providerOptions?.sokosumi?.previousResponseId).toBeNull();
    const onInvalidProviderConversationId =
      args.providerOptions?.sokosumi?.onInvalidProviderConversationId;
    expect(onInvalidProviderConversationId).toEqual(expect.any(Function));
    await onInvalidProviderConversationId?.();
    expect(conversationUpdateMock).toHaveBeenCalledWith({
      where: {
        id: "550e8400-e29b-41d4-a716-446655440000",
        userId: "user_123",
      },
      data: { providerConversationId: null },
    });
  });

  it("ignores previousResponseId when coworker Conversations mode is active", async () => {
    conversationFindFirstMock.mockResolvedValueOnce({
      id: "550e8400-e29b-41d4-a716-446655440000",
      metadata: {
        coworker_slug: "ops-agent",
        previous_response_id: "resp_from_meta",
      },
      providerConversationId: "conv_remote_1",
    });
    coworkerFindFirstMock.mockResolvedValueOnce({ id: "cow_123" });

    const app = createApp({
      authContext: {
        actor: "user",
        userId: "user_123",
        organizationId: "org_1",
        role: "user",
      },
    });
    const response = await app.request("http://localhost/", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        id: "550e8400-e29b-41d4-a716-446655440000",
        conversationId: "550e8400-e29b-41d4-a716-446655440000",
        previousResponseId: "resp_from_body",
        messages: [{ role: "user", parts: [{ type: "text", text: "Hi" }] }],
      }),
    });

    expect(response.status).toBe(200);
    expect(streamTextMock).toHaveBeenCalledOnce();
    const args = streamTextMock.mock.calls[0]![0] as {
      providerOptions?: {
        sokosumi?: { previousResponseId?: string | null };
      };
    };
    expect(args.providerOptions?.sokosumi?.previousResponseId).toBeNull();
  });

  it("merges DB history when the client sends only the new message (submit-message)", async () => {
    const cid = "550e8400-e29b-41d4-a716-446655440000";
    conversationFindFirstMock.mockResolvedValueOnce({
      id: cid,
      metadata: { model_id: "claude-opus-4-6" },
    });
    const persistedMessagesNewestFirst = [
      {
        id: "message-2",
        role: "user",
        contentText: "Next",
      },
      {
        id: "message-1",
        role: "user",
        contentText: "Earlier",
      },
    ];
    conversationMessageFindManyMock.mockResolvedValueOnce(
      persistedMessagesNewestFirst,
    );

    const app = createApp();
    const response = await app.request("http://localhost/", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        id: cid,
        conversationId: cid,
        trigger: "submit-message",
        message: { role: "user", parts: [{ type: "text", text: "Next" }] },
      }),
    });

    expect(response.status).toBe(200);
    expect(conversationMessageCreateMock).toHaveBeenCalledOnce();
    expect(conversationMessageFindManyMock).toHaveBeenCalledOnce();
    expect(conversationMessageFindManyMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { conversationId: cid },
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        take: LIMITS.CHAT_UI_MESSAGES_MAX_LIMIT,
      }),
    );
    expect(convertToModelMessagesMock).toHaveBeenCalledOnce();
    const uiArg = convertToModelMessagesMock.mock.calls[0]![0] as Array<{
      role: string;
      parts?: Array<{ type: string; text: string }>;
    }>;
    expect(uiArg).toHaveLength(2);
    expect(uiArg[0]?.parts?.[0]?.text).toBe("Earlier");
    expect(uiArg[1]?.parts?.[0]?.text).toBe("Next");
  });

  it("does not strip markdown images from assistant finish when image generation is off", async () => {
    const cid = "550e8400-e29b-41d4-a716-446655440000";
    conversationFindFirstMock
      .mockResolvedValueOnce({
        id: cid,
        metadata: { model_id: "claude-opus-4-6" },
      })
      .mockResolvedValueOnce({
        id: cid,
        metadata: null,
      });
    conversationMessageFindManyMock.mockResolvedValueOnce([
      {
        id: "message-1",
        role: "user",
        contentText: "Earlier",
      },
      {
        id: "message-2",
        role: "user",
        contentText: "Show me a diagram link",
      },
    ]);

    const app = createApp();
    const finishText =
      "See this chart.\n\n![diagram](https://example.com/chart.png)\n";
    const response = await app.request("http://localhost/", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        id: cid,
        conversationId: cid,
        trigger: "submit-message",
        message: {
          role: "user",
          parts: [{ type: "text", text: "Show me a diagram link" }],
        },
      }),
    });

    expect(response.status).toBe(200);
    const streamCall = streamTextMock.mock.calls[0]![0] as {
      onFinish: (finishEvent: {
        text: string;
        reasoning?: unknown[];
      }) => Promise<void>;
    };
    await streamCall.onFinish({
      text: finishText,
      reasoning: [],
    });

    expect(uploadGeneratedChatImageMock).not.toHaveBeenCalled();
    expect(conversationMessageCreateMock).toHaveBeenLastCalledWith({
      data: expect.objectContaining({
        role: "assistant",
        contentText: finishText,
        metadata: undefined,
      }),
    });
  });

  it("does not strip ReAct-shaped JSON from assistant finish when image generation is off", async () => {
    const cid = "550e8400-e29b-41d4-a716-446655440000";
    conversationFindFirstMock
      .mockResolvedValueOnce({
        id: cid,
        metadata: { model_id: "claude-opus-4-6" },
      })
      .mockResolvedValueOnce({
        id: cid,
        metadata: null,
      });
    conversationMessageFindManyMock.mockResolvedValueOnce([
      {
        id: "message-1",
        role: "user",
        contentText: "Return the JSON shape",
      },
    ]);
    const finishText = JSON.stringify({
      action: "openrouter_image_generation",
      action_input: '{"prompt":"A calm robot"}',
      thought: "Return this exactly.",
    });

    const app = createApp();
    const response = await app.request("http://localhost/", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        id: cid,
        conversationId: cid,
        trigger: "submit-message",
        message: {
          role: "user",
          parts: [{ type: "text", text: "Return the JSON shape" }],
        },
      }),
    });

    expect(response.status).toBe(200);
    const streamCall = streamTextMock.mock.calls[0]![0] as {
      onFinish: (finishEvent: {
        text: string;
        reasoning?: unknown[];
      }) => Promise<void>;
    };
    await streamCall.onFinish({
      text: finishText,
      reasoning: [],
    });

    expect(conversationMessageCreateMock).toHaveBeenLastCalledWith({
      data: expect.objectContaining({
        role: "assistant",
        contentText: finishText,
        metadata: undefined,
      }),
    });
  });

  it("persists image generation intent on submitted user messages", async () => {
    const cid = "550e8400-e29b-41d4-a716-446655440000";
    conversationFindFirstMock.mockResolvedValueOnce({
      id: cid,
      metadata: { model_id: "gpt-5-4" },
    });
    conversationMessageFindManyMock.mockResolvedValueOnce([
      {
        id: "message-1",
        role: "user",
        contentText: "Make an image",
        metadata: {
          image_generation: true,
          ui_message_v1: {
            parts: [{ type: "text", text: "Make an image" }],
          },
        },
      },
    ]);
    const infoSpy = vi.spyOn(console, "info").mockImplementation(() => {});

    const app = createApp();
    const response = await app.request("http://localhost/", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        id: cid,
        conversationId: cid,
        trigger: "submit-message",
        imageGeneration: true,
        message: {
          role: "user",
          parts: [{ type: "text", text: "Make an image" }],
        },
      }),
    });

    expect(response.status).toBe(200);
    expect(conversationUpdateMock).toHaveBeenCalledWith({
      where: {
        id: cid,
        userId: "user_123",
      },
      data: {
        metadata: {
          model_id: "gpt-5-4",
          image_generation: true,
          userId: "user_123",
        },
      },
    });
    expect(conversationMessageCreateMock).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          metadata: expect.objectContaining({
            image_generation: true,
          }),
        }),
      }),
    );
    const call = streamTextMock.mock.calls[0]![0] as {
      providerOptions?: {
        sokosumi?: { imageGenerationModel?: string | null };
      };
    };
    expect(call.providerOptions?.sokosumi?.imageGenerationModel).toBe(
      "openai/gpt-5.4-image-2",
    );
    infoSpy.mockRestore();
  });

  it("uses sticky conversation image mode on later submitted user messages", async () => {
    const cid = "550e8400-e29b-41d4-a716-446655440000";
    conversationFindFirstMock.mockResolvedValueOnce({
      id: cid,
      metadata: { model_id: "gpt-5-4", image_generation: true },
    });
    conversationMessageFindManyMock.mockResolvedValueOnce([
      {
        id: "message-1",
        role: "user",
        contentText: "Make another one",
        metadata: {
          image_generation: true,
          ui_message_v1: {
            parts: [{ type: "text", text: "Make another one" }],
          },
        },
      },
    ]);
    const infoSpy = vi.spyOn(console, "info").mockImplementation(() => {});

    const app = createApp();
    const response = await app.request("http://localhost/", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        id: cid,
        conversationId: cid,
        trigger: "submit-message",
        message: {
          role: "user",
          parts: [{ type: "text", text: "Make another one" }],
        },
      }),
    });

    expect(response.status).toBe(200);
    expect(conversationUpdateMock).not.toHaveBeenCalled();
    expect(conversationMessageCreateMock).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          metadata: expect.objectContaining({
            image_generation: true,
          }),
        }),
      }),
    );
    const call = streamTextMock.mock.calls[0]![0] as {
      providerOptions?: {
        sokosumi?: { imageGenerationModel?: string | null };
      };
    };
    expect(call.providerOptions?.sokosumi?.imageGenerationModel).toBe(
      "openai/gpt-5.4-image-2",
    );
    infoSpy.mockRestore();
  });

  it("rejects sticky image mode for coworker conversations", async () => {
    const cid = "550e8400-e29b-41d4-a716-446655440000";
    conversationFindFirstMock.mockResolvedValueOnce({
      id: cid,
      metadata: {
        coworker_slug: "ops-agent",
        image_generation: true,
      },
      providerConversationId: "conv_remote_1",
    });
    coworkerFindFirstMock.mockResolvedValueOnce({ id: "cow_123" });

    const app = createApp();
    const response = await app.request("http://localhost/", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        id: cid,
        conversationId: cid,
        messages: [{ role: "user", content: "Can you help?" }],
      }),
    });

    expect(response.status).toBe(400);
    expect(conversationUpdateMock).not.toHaveBeenCalled();
    expect(createCoworkerConversationMock).not.toHaveBeenCalled();
    expect(streamTextMock).not.toHaveBeenCalled();
  });

  it("persists generated image markdown as structured file parts on finish", async () => {
    const cid = "550e8400-e29b-41d4-a716-446655440000";
    const dataUrl = "data:image/png;base64,aGVsbG8=";
    conversationFindFirstMock
      .mockResolvedValueOnce({
        id: cid,
        metadata: { model_id: "gpt-5-4" },
      })
      .mockResolvedValueOnce({
        id: cid,
        metadata: null,
      });
    conversationMessageFindManyMock.mockResolvedValueOnce([
      {
        id: "message-1",
        role: "user",
        contentText: "Make an image",
        metadata: {
          image_generation: true,
          ui_message_v1: {
            parts: [{ type: "text", text: "Make an image" }],
          },
        },
      },
    ]);
    const infoSpy = vi.spyOn(console, "info").mockImplementation(() => {});

    const app = createApp();
    const response = await app.request("http://localhost/", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        id: cid,
        conversationId: cid,
        trigger: "submit-message",
        imageGeneration: true,
        message: {
          role: "user",
          parts: [{ type: "text", text: "Make an image" }],
        },
      }),
    });

    expect(response.status).toBe(200);
    const streamCall = streamTextMock.mock.calls[0]![0] as {
      onFinish: (finishEvent: {
        text: string;
        reasoning?: unknown[];
      }) => Promise<void>;
    };
    await streamCall.onFinish({
      text: `Here you go.\n\n![Generated image](${dataUrl})\n\n`,
      reasoning: [],
    });

    expect(uploadGeneratedChatImageMock).toHaveBeenCalledWith({
      dataUrl,
      userId: "user_123",
      conversationId: cid,
    });
    expect(conversationMessageCreateMock).toHaveBeenLastCalledWith({
      data: expect.objectContaining({
        role: "assistant",
        contentText: "Here you go.",
        metadata: {
          ui_message_v1: {
            parts: [
              { type: "text", text: "Here you go." },
              {
                type: "file",
                url: "https://blob.example.com/generated.png",
                mediaType: "image/png",
                filename: "generated.png",
              },
            ],
          },
        },
      }),
    });
    infoSpy.mockRestore();
  });

  it("uploads case-variant data image markdown when another remote image yields file parts", async () => {
    const cid = "550e8400-e29b-41d4-a716-446655440000";
    const dataUrl = "Data:Image/PNG;Base64,aGVsbG8=";
    conversationFindFirstMock
      .mockResolvedValueOnce({
        id: cid,
        metadata: { model_id: "gpt-5-4" },
      })
      .mockResolvedValueOnce({
        id: cid,
        metadata: null,
      });
    conversationMessageFindManyMock.mockResolvedValueOnce([
      {
        id: "message-1",
        role: "user",
        contentText: "Make images",
        metadata: {
          image_generation: true,
          ui_message_v1: {
            parts: [{ type: "text", text: "Make images" }],
          },
        },
      },
    ]);
    const infoSpy = vi.spyOn(console, "info").mockImplementation(() => {});

    const app = createApp();
    const response = await app.request("http://localhost/", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        id: cid,
        conversationId: cid,
        trigger: "submit-message",
        imageGeneration: true,
        message: {
          role: "user",
          parts: [{ type: "text", text: "Make images" }],
        },
      }),
    });

    expect(response.status).toBe(200);
    const streamCall = streamTextMock.mock.calls[0]![0] as {
      onFinish: (finishEvent: {
        text: string;
        reasoning?: unknown[];
      }) => Promise<void>;
    };
    await streamCall.onFinish({
      text: `Here.\n\n![remote](https://example.com/chart.png)\n![gen](${dataUrl})\n`,
      reasoning: [],
    });

    expect(uploadGeneratedChatImageMock).toHaveBeenCalledWith({
      dataUrl,
      userId: "user_123",
      conversationId: cid,
    });
    expect(conversationMessageCreateMock).toHaveBeenLastCalledWith({
      data: expect.objectContaining({
        role: "assistant",
        contentText: "Here.",
        metadata: {
          ui_message_v1: {
            parts: [
              { type: "text", text: "Here." },
              {
                type: "file",
                url: "https://example.com/chart.png",
                mediaType: "image/png",
                filename: "chart.png",
              },
              {
                type: "file",
                url: "https://blob.example.com/generated.png",
                mediaType: "image/png",
                filename: "generated.png",
              },
            ],
          },
        },
      }),
    });
    infoSpy.mockRestore();
  });

  it("never persists data image markdown in assistant contentText when upload fails", async () => {
    const cid = "550e8400-e29b-41d4-a716-446655440000";
    const dataUrl = "data:image/png;base64,aGVsbG8=";
    conversationFindFirstMock
      .mockResolvedValueOnce({
        id: cid,
        metadata: { model_id: "gpt-5-4" },
      })
      .mockResolvedValueOnce({
        id: cid,
        metadata: null,
      });
    conversationMessageFindManyMock.mockResolvedValueOnce([
      {
        id: "message-1",
        role: "user",
        contentText: "Make an image",
        metadata: {
          image_generation: true,
          ui_message_v1: {
            parts: [{ type: "text", text: "Make an image" }],
          },
        },
      },
    ]);
    uploadGeneratedChatImageMock.mockResolvedValueOnce(null);
    const infoSpy = vi.spyOn(console, "info").mockImplementation(() => {});

    const app = createApp();
    const response = await app.request("http://localhost/", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        id: cid,
        conversationId: cid,
        trigger: "submit-message",
        imageGeneration: true,
        message: {
          role: "user",
          parts: [{ type: "text", text: "Make an image" }],
        },
      }),
    });

    expect(response.status).toBe(200);
    const streamCall = streamTextMock.mock.calls[0]![0] as {
      onFinish: (finishEvent: {
        text: string;
        reasoning?: unknown[];
      }) => Promise<void>;
    };
    await streamCall.onFinish({
      text: `Here you go.\n\n![Generated image](${dataUrl})\n\n`,
      reasoning: [],
    });

    expect(conversationMessageCreateMock).toHaveBeenLastCalledWith({
      data: expect.objectContaining({
        role: "assistant",
        contentText: "Here you go.",
      }),
    });
    expect(
      JSON.stringify(conversationMessageCreateMock.mock.calls.at(-1)),
    ).not.toContain("data:image/png;base64");
    infoSpy.mockRestore();
  });

  it("persists a fallback caption when upload fails and the assistant reply was image-only", async () => {
    const cid = "550e8400-e29b-41d4-a716-446655440000";
    const dataUrl = "data:image/png;base64,aGVsbG8=";
    conversationFindFirstMock
      .mockResolvedValueOnce({
        id: cid,
        metadata: { model_id: "gpt-5-4" },
      })
      .mockResolvedValueOnce({
        id: cid,
        metadata: null,
      });
    conversationMessageFindManyMock.mockResolvedValueOnce([
      {
        id: "message-1",
        role: "user",
        contentText: "Make an image",
        metadata: {
          image_generation: true,
          ui_message_v1: {
            parts: [{ type: "text", text: "Make an image" }],
          },
        },
      },
    ]);
    uploadGeneratedChatImageMock.mockResolvedValueOnce(null);
    const infoSpy = vi.spyOn(console, "info").mockImplementation(() => {});

    const app = createApp();
    const response = await app.request("http://localhost/", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        id: cid,
        conversationId: cid,
        trigger: "submit-message",
        imageGeneration: true,
        message: {
          role: "user",
          parts: [{ type: "text", text: "Make an image" }],
        },
      }),
    });

    expect(response.status).toBe(200);
    const streamCall = streamTextMock.mock.calls[0]![0] as {
      onFinish: (finishEvent: {
        text: string;
        reasoning?: unknown[];
      }) => Promise<void>;
    };
    await streamCall.onFinish({
      text: `![Generated image](${dataUrl})\n`,
      reasoning: [],
    });

    expect(conversationMessageCreateMock).toHaveBeenLastCalledWith({
      data: expect.objectContaining({
        role: "assistant",
        contentText:
          "The generated image could not be saved. Try generating again.",
      }),
    });
    expect(
      JSON.stringify(conversationMessageCreateMock.mock.calls.at(-1)),
    ).not.toContain("data:image/png;base64");
    infoSpy.mockRestore();
  });

  it("strips ReAct JSON from persisted assistant text and stores thought as reasoning", async () => {
    const cid = "550e8400-e29b-41d4-a716-446655440000";
    conversationFindFirstMock
      .mockResolvedValueOnce({
        id: cid,
        metadata: { model_id: "gpt-5-4" },
      })
      .mockResolvedValueOnce({
        id: cid,
        metadata: null,
      });
    conversationMessageFindManyMock.mockResolvedValueOnce([
      {
        id: "message-1",
        role: "user",
        contentText: "Make an image",
        metadata: {
          image_generation: true,
          ui_message_v1: {
            parts: [{ type: "text", text: "Make an image" }],
          },
        },
      },
    ]);
    const infoSpy = vi.spyOn(console, "info").mockImplementation(() => {});
    const reactEnvelope = JSON.stringify({
      action: "openrouter_image_generation",
      action_input: '{"prompt":"A calm robot"}',
      thought: "I should generate an image for the user.",
    });

    const app = createApp();
    const response = await app.request("http://localhost/", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        id: cid,
        conversationId: cid,
        trigger: "submit-message",
        imageGeneration: true,
        message: {
          role: "user",
          parts: [{ type: "text", text: "Make an image" }],
        },
      }),
    });

    expect(response.status).toBe(200);
    const streamCall = streamTextMock.mock.calls[0]![0] as {
      onFinish: (finishEvent: {
        text: string;
        reasoning?: unknown[];
      }) => Promise<void>;
    };
    await streamCall.onFinish({
      text: `${reactEnvelope}\n\nHere is the result.`,
      reasoning: [],
    });

    expect(conversationMessageCreateMock).toHaveBeenLastCalledWith({
      data: expect.objectContaining({
        role: "assistant",
        contentText: "Here is the result.",
        metadata: {
          reasoning: [
            {
              type: "reasoning",
              text: "I should generate an image for the user.",
            },
          ],
        },
      }),
    });
    expect(
      JSON.stringify(conversationMessageCreateMock.mock.calls.at(-1)),
    ).not.toContain("openrouter_image_generation");
    infoSpy.mockRestore();
  });

  it("strips single-line fenced ReAct JSON (space after json) on persist", async () => {
    const cid = "550e8400-e29b-41d4-a716-446655440000";
    conversationFindFirstMock
      .mockResolvedValueOnce({
        id: cid,
        metadata: { model_id: "gpt-5-4" },
      })
      .mockResolvedValueOnce({
        id: cid,
        metadata: null,
      });
    conversationMessageFindManyMock.mockResolvedValueOnce([
      {
        id: "message-1",
        role: "user",
        contentText: "Make an image",
        metadata: {
          image_generation: true,
          ui_message_v1: {
            parts: [{ type: "text", text: "Make an image" }],
          },
        },
      },
    ]);
    const infoSpy = vi.spyOn(console, "info").mockImplementation(() => {});
    const inner = JSON.stringify({
      action: "openrouter_image_generation",
      action_input: '{"prompt":"A calm robot"}',
      thought: "Fenced on one line.",
    });
    const fenced = `\`\`\`json ${inner}\`\`\`\n\nHere is the result.`;

    const app = createApp();
    const response = await app.request("http://localhost/", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        id: cid,
        conversationId: cid,
        trigger: "submit-message",
        imageGeneration: true,
        message: {
          role: "user",
          parts: [{ type: "text", text: "Make an image" }],
        },
      }),
    });

    expect(response.status).toBe(200);
    const streamCall = streamTextMock.mock.calls[0]![0] as {
      onFinish: (finishEvent: {
        text: string;
        reasoning?: unknown[];
      }) => Promise<void>;
    };
    await streamCall.onFinish({
      text: fenced,
      reasoning: [],
    });

    expect(conversationMessageCreateMock).toHaveBeenLastCalledWith({
      data: expect.objectContaining({
        role: "assistant",
        contentText: "Here is the result.",
        metadata: {
          reasoning: [
            {
              type: "reasoning",
              text: "Fenced on one line.",
            },
          ],
        },
      }),
    });
    expect(
      JSON.stringify(conversationMessageCreateMock.mock.calls.at(-1)),
    ).not.toContain("openrouter_image_generation");
    infoSpy.mockRestore();
  });

  it("persists an unavailable fallback when Gemini emits only a ReAct image envelope", async () => {
    const cid = "550e8400-e29b-41d4-a716-446655440000";
    conversationFindFirstMock
      .mockResolvedValueOnce({
        id: cid,
        metadata: { model_id: "gemini-3-flash-preview" },
      })
      .mockResolvedValueOnce({
        id: cid,
        metadata: null,
      });
    conversationMessageFindManyMock.mockResolvedValueOnce([
      {
        id: "message-1",
        role: "user",
        contentText: "Make an image",
        metadata: {
          image_generation: true,
          ui_message_v1: {
            parts: [{ type: "text", text: "Make an image" }],
          },
        },
      },
    ]);
    const infoSpy = vi.spyOn(console, "info").mockImplementation(() => {});
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const reactEnvelope = JSON.stringify({
      action: "openrouter_image_generation",
      action_input: '{"prompt":"A calm robot"}',
      thought: "I should generate an image for the user.",
    });

    const app = createApp();
    const response = await app.request("http://localhost/", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        id: cid,
        conversationId: cid,
        trigger: "submit-message",
        imageGeneration: true,
        message: {
          role: "user",
          parts: [{ type: "text", text: "Make an image" }],
        },
      }),
    });

    expect(response.status).toBe(200);
    const streamCall = streamTextMock.mock.calls[0]![0] as {
      onFinish: (finishEvent: {
        text: string;
        reasoning?: unknown[];
      }) => Promise<void>;
    };
    await streamCall.onFinish({
      text: reactEnvelope,
      reasoning: [],
    });

    expect(warnSpy).toHaveBeenCalledWith(
      "Image generation requested but no image was returned",
      { modelId: "gemini-3-flash-preview" },
    );
    expect(conversationMessageCreateMock).toHaveBeenLastCalledWith({
      data: expect.objectContaining({
        role: "assistant",
        contentText:
          "The image generation tool did not return an image. Try generating again.",
        metadata: {
          reasoning: [
            {
              type: "reasoning",
              text: "I should generate an image for the user.",
            },
          ],
        },
      }),
    });
    expect(
      JSON.stringify(conversationMessageCreateMock.mock.calls.at(-1)),
    ).not.toContain("openrouter_image_generation");
    infoSpy.mockRestore();
    warnSpy.mockRestore();
  });

  it("strips Gemini dalle.text2im ReAct JSON from persisted assistant text", async () => {
    const cid = "550e8400-e29b-41d4-a716-446655440000";
    conversationFindFirstMock
      .mockResolvedValueOnce({
        id: cid,
        metadata: { model_id: "gemini-3-flash-preview" },
      })
      .mockResolvedValueOnce({
        id: cid,
        metadata: null,
      });
    conversationMessageFindManyMock.mockResolvedValueOnce([
      {
        id: "message-1",
        role: "user",
        contentText: "Make an image",
        metadata: {
          image_generation: true,
          ui_message_v1: {
            parts: [{ type: "text", text: "Make an image" }],
          },
        },
      },
    ]);
    const infoSpy = vi.spyOn(console, "info").mockImplementation(() => {});
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const reactEnvelope = JSON.stringify(
      {
        action: "dalle.text2im",
        action_input: '{"prompt":"A calm robot","aspect_ratio":"16:9"}',
        thought: "I should generate an image for the user.",
      },
      null,
      2,
    );

    const app = createApp();
    const response = await app.request("http://localhost/", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        id: cid,
        conversationId: cid,
        trigger: "submit-message",
        imageGeneration: true,
        message: {
          role: "user",
          parts: [{ type: "text", text: "Make an image" }],
        },
      }),
    });

    expect(response.status).toBe(200);
    const streamCall = streamTextMock.mock.calls[0]![0] as {
      onFinish: (finishEvent: {
        text: string;
        reasoning?: unknown[];
      }) => Promise<void>;
    };
    await streamCall.onFinish({
      text: reactEnvelope,
      reasoning: [],
    });

    expect(warnSpy).toHaveBeenCalledWith(
      "Image generation requested but no image was returned",
      { modelId: "gemini-3-flash-preview" },
    );
    expect(conversationMessageCreateMock).toHaveBeenLastCalledWith({
      data: expect.objectContaining({
        role: "assistant",
        contentText:
          "The image generation tool did not return an image. Try generating again.",
        metadata: {
          reasoning: [
            {
              type: "reasoning",
              text: "I should generate an image for the user.",
            },
          ],
        },
      }),
    });
    expect(
      JSON.stringify(conversationMessageCreateMock.mock.calls.at(-1)),
    ).not.toContain("dalle.text2im");
    infoSpy.mockRestore();
    warnSpy.mockRestore();
  });

  it("persists an unavailable fallback when the stream stripped the ReAct envelope", async () => {
    const cid = "550e8400-e29b-41d4-a716-446655440000";
    conversationFindFirstMock
      .mockResolvedValueOnce({
        id: cid,
        metadata: { model_id: "gemini-3-flash-preview" },
      })
      .mockResolvedValueOnce({
        id: cid,
        metadata: null,
      });
    conversationMessageFindManyMock.mockResolvedValueOnce([
      {
        id: "message-1",
        role: "user",
        contentText: "Make an image",
        metadata: {
          image_generation: true,
          ui_message_v1: {
            parts: [{ type: "text", text: "Make an image" }],
          },
        },
      },
    ]);
    const infoSpy = vi.spyOn(console, "info").mockImplementation(() => {});
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    const app = createApp();
    const response = await app.request("http://localhost/", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        id: cid,
        conversationId: cid,
        trigger: "submit-message",
        imageGeneration: true,
        message: {
          role: "user",
          parts: [{ type: "text", text: "Make an image" }],
        },
      }),
    });

    expect(response.status).toBe(200);
    const streamCall = streamTextMock.mock.calls[0]![0] as {
      onFinish: (finishEvent: {
        text: string;
        reasoning?: unknown[];
      }) => Promise<void>;
    };
    await streamCall.onFinish({
      text: "",
      reasoning: [
        {
          type: "reasoning",
          text: "I should generate an image for the user.",
        },
      ],
    });

    expect(warnSpy).toHaveBeenCalledWith(
      "Image generation requested but no image was returned",
      { modelId: "gemini-3-flash-preview" },
    );
    expect(conversationMessageCreateMock).toHaveBeenLastCalledWith({
      data: expect.objectContaining({
        role: "assistant",
        contentText:
          "The image generation tool did not return an image. Try generating again.",
        metadata: {
          reasoning: [
            {
              type: "reasoning",
              text: "I should generate an image for the user.",
            },
          ],
        },
      }),
    });
    infoSpy.mockRestore();
    warnSpy.mockRestore();
  });

  it("returns 403 when coworker chat is unavailable", async () => {
    conversationFindFirstMock.mockResolvedValueOnce({
      id: "550e8400-e29b-41d4-a716-446655440000",
      metadata: { coworker_slug: "ops-agent" },
    });
    coworkerFindFirstMock.mockResolvedValueOnce({ id: "cow_123" });
    requireCoworkerChatCapabilityMock.mockRejectedValue(
      new HTTPException(403, {
        message: "Coworker chat is not available",
      }),
    );

    const app = createApp();
    const response = await app.request("http://localhost/", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        id: "550e8400-e29b-41d4-a716-446655440000",
        conversationId: "550e8400-e29b-41d4-a716-446655440000",
        messages: [{ role: "user", parts: [{ type: "text", text: "Hi" }] }],
      }),
    });

    expect(response.status).toBe(403);
    expect(streamTextMock).not.toHaveBeenCalled();
  });

  it("returns 503 when creating the remote coworker conversation fails unexpectedly", async () => {
    const cid = "550e8400-e29b-41d4-a716-446655440000";
    conversationFindFirstMock.mockResolvedValueOnce({
      id: cid,
      metadata: { coworker_slug: "ops-agent" },
      providerConversationId: null,
    });
    coworkerFindFirstMock.mockResolvedValueOnce({ id: "cow_123" });
    createCoworkerConversationMock.mockRejectedValueOnce(
      new Error("upstream unavailable"),
    );

    const app = createApp();
    const response = await app.request("http://localhost/", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        id: cid,
        conversationId: cid,
        messages: [{ role: "user", parts: [{ type: "text", text: "Hi" }] }],
      }),
    });

    expect(response.status).toBe(503);
    expect(releaseStreamLockMock).toHaveBeenCalledWith(
      cid,
      "instance-test:lock-token",
    );
    expect(streamTextMock).not.toHaveBeenCalled();
  });

  it("returns 403 when coworker provider billing is required", async () => {
    const cid = "550e8400-e29b-41d4-a716-446655440000";
    conversationFindFirstMock.mockResolvedValueOnce({
      id: cid,
      metadata: { coworker_slug: "ops-agent" },
      providerConversationId: null,
    });
    coworkerFindFirstMock.mockResolvedValueOnce({ id: "cow_123" });
    createCoworkerConversationMock.mockRejectedValueOnce(
      new CoworkerConversationError(
        "Conversations API request failed",
        403,
        "billing_required",
      ),
    );

    const app = createApp();
    const response = await app.request("http://localhost/", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        id: cid,
        conversationId: cid,
        messages: [{ role: "user", parts: [{ type: "text", text: "Hi" }] }],
      }),
    });

    expect(response.status).toBe(403);
    expect(await response.text()).toContain("billing setup");
    expect(streamTextMock).not.toHaveBeenCalled();
  });

  it("schedules OpenRouter title generation when persisting the first user message", async () => {
    const cid = "550e8400-e29b-41d4-a716-446655440000";
    prismaTransactionMock.mockImplementationOnce(
      async (
        callback: (tx: {
          $queryRaw: ReturnType<typeof vi.fn>;
          conversationMessage: {
            count: ReturnType<typeof vi.fn>;
            create: typeof conversationMessageCreateMock;
          };
        }) => Promise<boolean>,
      ) =>
        await callback({
          $queryRaw: vi.fn().mockResolvedValue([{ id: cid }]),
          conversationMessage: {
            count: vi.fn().mockResolvedValue(0),
            create: conversationMessageCreateMock,
          },
        }),
    );
    conversationFindFirstMock.mockResolvedValueOnce({
      id: cid,
      metadata: { model_id: "claude-opus-4-6" },
    });
    generateChatTitleMock.mockResolvedValueOnce("Generated");

    const app = createApp();
    const response = await app.request("http://localhost/", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        id: cid,
        conversationId: cid,
        messages: [{ role: "user", parts: [{ type: "text", text: "Hi" }] }],
      }),
    });

    expect(response.status).toBe(200);
    expect(waitUntilCapturedPromises).toHaveLength(1);
    await waitUntilCapturedPromises[0]!;
    expect(generateChatTitleMock).toHaveBeenCalledOnce();
  });

  it("does not clear active UI stream metadata on UI onFinish when resumable registration fails", async () => {
    const cid = "550e8400-e29b-41d4-a716-446655440000";
    isUiStreamResumptionConfiguredMock.mockReturnValue(true);
    createNewResumableStreamMock.mockRejectedValue(
      new Error("resumable stream unavailable"),
    );
    conversationFindFirstMock.mockResolvedValueOnce({
      id: cid,
      metadata: { model_id: "claude-opus-4-6" },
    });

    const app = createApp();
    const response = await app.request("http://localhost/", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        id: cid,
        conversationId: cid,
        messages: [{ role: "user", parts: [{ type: "text", text: "Hi" }] }],
      }),
    });

    expect(response.status).toBe(200);
    expect(toUIMessageStreamResponseMock).toHaveBeenCalledOnce();
    expect(clearActiveUiStreamIdInMetadataMock).toHaveBeenCalledTimes(1);

    const init = toUIMessageStreamResponseMock.mock.calls[0]![0] as {
      consumeSseStream?: (args: {
        stream: ReadableStream<string>;
      }) => Promise<void>;
      onFinish?: () => Promise<void>;
    };
    expect(init.consumeSseStream).toEqual(expect.any(Function));
    expect(init.onFinish).toEqual(expect.any(Function));

    const sseCopy = new ReadableStream<string>({
      start(controller) {
        controller.close();
      },
    });
    await init.consumeSseStream!({ stream: sseCopy });
    await init.onFinish!();

    expect(clearActiveUiStreamIdInMetadataMock).toHaveBeenCalledTimes(1);
  });

  it("clears active UI stream metadata on UI onFinish after successful resumable registration", async () => {
    const cid = "550e8400-e29b-41d4-a716-446655440000";
    isUiStreamResumptionConfiguredMock.mockReturnValue(true);
    conversationFindFirstMock.mockResolvedValueOnce({
      id: cid,
      metadata: { model_id: "claude-opus-4-6" },
    });

    const app = createApp();
    const response = await app.request("http://localhost/", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        id: cid,
        conversationId: cid,
        messages: [{ role: "user", parts: [{ type: "text", text: "Hi" }] }],
      }),
    });

    expect(response.status).toBe(200);
    expect(clearActiveUiStreamIdInMetadataMock).toHaveBeenCalledTimes(1);

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

    expect(clearActiveUiStreamIdInMetadataMock).toHaveBeenCalledTimes(2);
  });

  describe("coworker stream lock and pending recovery", () => {
    it("returns 409 when the coworker stream lock is already held", async () => {
      const cid = setupCoworkerChatConversation();
      acquireStreamLockMock.mockResolvedValueOnce({ status: "held" });

      const app = createApp();
      const response = await app.request("http://localhost/", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: cid,
          conversationId: cid,
          messages: [{ role: "user", parts: [{ type: "text", text: "Hi" }] }],
        }),
      });

      expect(response.status).toBe(409);
      expect(streamTextMock).not.toHaveBeenCalled();
      expect(conversationMessageCreateMock).not.toHaveBeenCalled();
      expect(releaseStreamLockMock).not.toHaveBeenCalled();
    });

    it("proceeds unlocked when redis is unavailable", async () => {
      const cid = setupCoworkerChatConversation();
      acquireStreamLockMock.mockResolvedValueOnce({ status: "unavailable" });

      const app = createApp();
      const response = await app.request("http://localhost/", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: cid,
          conversationId: cid,
          messages: [{ role: "user", parts: [{ type: "text", text: "Hi" }] }],
        }),
      });

      expect(response.status).toBe(200);
      expect(streamTextMock).toHaveBeenCalledOnce();
    });

    it("returns 409 when a pending coworker response is still in progress", async () => {
      const cid = setupCoworkerChatConversation({
        coworker_slug: "ops-agent",
        pending_responses_api_response_id: "resp_pending",
      });
      pollCoworkerResponseStatusMock.mockResolvedValueOnce({
        status: "in_progress",
        responseId: "resp_pending",
      });

      const app = createApp();
      const response = await app.request("http://localhost/", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: cid,
          conversationId: cid,
          messages: [{ role: "user", parts: [{ type: "text", text: "Hi" }] }],
        }),
      });

      expect(response.status).toBe(409);
      expect(pollCoworkerResponseStatusMock).toHaveBeenCalledOnce();
      expect(releaseStreamLockMock).toHaveBeenCalledWith(
        cid,
        "instance-test:lock-token",
      );
      expect(streamTextMock).not.toHaveBeenCalled();
    });

    it("clears completed pending responses and proceeds", async () => {
      const cid = setupCoworkerChatConversation({
        coworker_slug: "ops-agent",
        pending_responses_api_response_id: "resp_pending",
      });
      pollCoworkerResponseStatusMock.mockResolvedValueOnce({
        status: "completed",
        responseId: "resp_pending",
      });

      const app = createApp();
      const response = await app.request("http://localhost/", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: cid,
          conversationId: cid,
          messages: [{ role: "user", parts: [{ type: "text", text: "Hi" }] }],
        }),
      });

      expect(response.status).toBe(200);
      expect(clearPendingResponseIdMock).toHaveBeenCalledWith({
        conversationId: cid,
        userId: "user_123",
      });
      expect(clearPendingResponseMirrorMock).toHaveBeenCalledWith(cid);
      expect(streamTextMock).toHaveBeenCalledOnce();
    });

    it("clears failed pending responses and proceeds", async () => {
      const cid = setupCoworkerChatConversation({
        coworker_slug: "ops-agent",
        pending_responses_api_response_id: "resp_pending",
      });
      pollCoworkerResponseStatusMock.mockResolvedValueOnce({
        status: "failed",
        responseId: "resp_pending",
      });

      const app = createApp();
      const response = await app.request("http://localhost/", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: cid,
          conversationId: cid,
          messages: [{ role: "user", parts: [{ type: "text", text: "Hi" }] }],
        }),
      });

      expect(response.status).toBe(200);
      expect(clearPendingResponseIdMock).toHaveBeenCalledOnce();
      expect(streamTextMock).toHaveBeenCalledOnce();
    });

    it("returns 503 when pending response polling fails", async () => {
      const cid = setupCoworkerChatConversation({
        coworker_slug: "ops-agent",
        pending_responses_api_response_id: "resp_pending",
      });
      pollCoworkerResponseStatusMock.mockResolvedValueOnce({
        status: "error",
        responseId: "resp_pending",
        cause: new Error("upstream unavailable"),
      });

      const app = createApp();
      const response = await app.request("http://localhost/", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: cid,
          conversationId: cid,
          messages: [{ role: "user", parts: [{ type: "text", text: "Hi" }] }],
        }),
      });

      expect(response.status).toBe(503);
      expect(releaseStreamLockMock).toHaveBeenCalledWith(
        cid,
        "instance-test:lock-token",
      );
      expect(streamTextMock).not.toHaveBeenCalled();
    });

    it("releases the stream lock on finish while retaining pending on disconnect", async () => {
      const cid = setupCoworkerChatConversation();
      const stopHeartbeatMock = vi.fn();
      startStreamLockHeartbeatMock.mockReturnValueOnce(stopHeartbeatMock);

      const app = createApp();
      const response = await app.request("http://localhost/", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: cid,
          conversationId: cid,
          messages: [{ role: "user", parts: [{ type: "text", text: "Hi" }] }],
        }),
      });

      expect(response.status).toBe(200);
      const streamCall = streamTextMock.mock.calls[0]![0] as {
        providerOptions?: {
          sokosumi?: {
            onResponseStarted?: (responseId: string) => Promise<void>;
            onResponseCompleted?: (responseId: string) => Promise<void>;
          };
        };
      };
      await streamCall.providerOptions?.sokosumi?.onResponseStarted?.(
        "resp_live",
      );
      expect(setPendingResponseMirrorMock).toHaveBeenCalledWith(
        cid,
        "resp_live",
      );

      const init = toUIMessageStreamResponseMock.mock.calls[0]![0] as {
        onFinish?: () => Promise<void>;
      };
      await init.onFinish?.();
      expect(waitUntilCapturedPromises).toHaveLength(1);
      await waitUntilCapturedPromises[0]!;
      expect(stopHeartbeatMock).toHaveBeenCalledOnce();
      expect(releaseStreamLockMock).toHaveBeenCalledWith(
        cid,
        "instance-test:lock-token",
      );
      expect(clearPendingResponseMirrorMock).not.toHaveBeenCalled();
      expect(clearPendingResponseIdMock).not.toHaveBeenCalled();
    });
  });
});
