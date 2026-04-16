import { OpenAPIHono } from "@hono/zod-openapi";
import { HTTPException } from "hono/http-exception";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { OpenAPIHonoWithAuth } from "@/lib/hono";
import { defaultValidationHook } from "@/lib/hono";
import type { AuthVariables } from "@/middleware/auth";

import mountPostChat from "./post";

const {
  conversationFindFirstMock,
  conversationMessageCreateMock,
  conversationMessageFindManyMock,
  conversationUpdateManyMock,
  convertToModelMessagesMock,
  coworkerFindFirstMock,
  createCoworkerConversationMock,
  generateChatTitleMock,
  getOpenRouterChatApiKeyForProviderMock,
  getSokosumiProviderMock,
  prismaTransactionMock,
  requireCoworkerChatCapabilityMock,
  streamTextMock,
  validateUIMessagesMock,
  waitUntilCapturedPromises,
} = vi.hoisted(() => ({
  conversationFindFirstMock: vi.fn(),
  conversationMessageCreateMock: vi.fn(),
  conversationMessageFindManyMock: vi.fn(),
  conversationUpdateManyMock: vi.fn(),
  convertToModelMessagesMock: vi.fn(),
  coworkerFindFirstMock: vi.fn(),
  createCoworkerConversationMock: vi.fn(),
  generateChatTitleMock: vi.fn(),
  getOpenRouterChatApiKeyForProviderMock: vi.fn(),
  getSokosumiProviderMock: vi.fn(),
  prismaTransactionMock: vi.fn(),
  requireCoworkerChatCapabilityMock: vi.fn(),
  streamTextMock: vi.fn(),
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
  requireCoworkerChatCapability: requireCoworkerChatCapabilityMock,
}));

vi.mock("./coworker-conversation", () => ({
  createCoworkerConversation: (...args: unknown[]) =>
    createCoworkerConversationMock(...args),
}));

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
      update: vi.fn(),
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

vi.mock("@/lib/resumable-ui-stream-context", () => ({
  isUiStreamResumptionConfigured: () => false,
  getResumableUiStreamContext: vi.fn(),
}));

function createApp({
  organizationId = null,
}: {
  organizationId?: string | null;
} = {}) {
  const app = new OpenAPIHono<{
    Variables: AuthVariables;
  }>({
    defaultHook: defaultValidationHook,
  });

  app.use("*", async (c, next) => {
    c.set("isAuthenticated", true);
    c.set("authContext", {
      actor: "user",
      userId: "user_123",
      organizationId,
    });
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
    validateUIMessagesMock.mockImplementation(
      async ({ messages }: { messages: unknown[] }) => messages,
    );
    generateChatTitleMock.mockResolvedValue(null);
    streamTextMock.mockReturnValue({
      toUIMessageStreamResponse: vi.fn().mockReturnValue(
        new Response(null, {
          status: 200,
          headers: { "Content-Type": "text/event-stream" },
        }),
      ),
    });
    requireCoworkerChatCapabilityMock.mockResolvedValue({
      id: "cow_123",
      slug: "ops-agent",
      baseURL: "https://responses.example.com/v1",
    });
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
      providerOptions?: { sokosumi?: { mode?: string } };
    };
    expect(call.providerOptions?.sokosumi?.mode).toBe("openrouter");
  });

  it("uses Conversations mode for coworker (no onInvalidPreviousResponseId)", async () => {
    conversationFindFirstMock.mockResolvedValueOnce({
      id: "550e8400-e29b-41d4-a716-446655440000",
      metadata: {
        coworker_slug: "ops-agent",
        previous_response_id: "resp_stale",
      },
      providerConversationId: "conv_remote_1",
    });
    coworkerFindFirstMock.mockResolvedValueOnce({ id: "cow_123" });

    const app = createApp({ organizationId: "org_1" });
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
          onInvalidPreviousResponseId?: unknown;
          previousResponseId?: string | null;
          providerConversationId?: string | null;
        };
      };
    };
    expect(args.providerOptions?.sokosumi?.mode).toBe("coworker");
    expect(args.providerOptions?.sokosumi?.providerConversationId).toBe(
      "conv_remote_1",
    );
    expect(args.providerOptions?.sokosumi?.previousResponseId).toBe(
      "resp_stale",
    );
    expect(args.providerOptions?.sokosumi?.onInvalidPreviousResponseId).toBe(
      undefined,
    );
  });

  it("prefers request body previousResponseId over metadata for coworker", async () => {
    conversationFindFirstMock.mockResolvedValueOnce({
      id: "550e8400-e29b-41d4-a716-446655440000",
      metadata: {
        coworker_slug: "ops-agent",
        previous_response_id: "resp_from_meta",
      },
      providerConversationId: "conv_remote_1",
    });
    coworkerFindFirstMock.mockResolvedValueOnce({ id: "cow_123" });

    const app = createApp({ organizationId: "org_1" });
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
    expect(args.providerOptions?.sokosumi?.previousResponseId).toBe(
      "resp_from_body",
    );
  });

  it("merges DB history when the client sends only the new message (submit-message)", async () => {
    const cid = "550e8400-e29b-41d4-a716-446655440000";
    conversationFindFirstMock.mockResolvedValueOnce({
      id: cid,
      metadata: { model_id: "claude-opus-4-6" },
    });
    conversationMessageFindManyMock.mockResolvedValueOnce([
      {
        id: "item-1",
        role: "user",
        contentText: "Earlier",
      },
      {
        id: "item-2",
        role: "user",
        contentText: "Next",
      },
    ]);

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
    expect(convertToModelMessagesMock).toHaveBeenCalledOnce();
    const uiArg = convertToModelMessagesMock.mock.calls[0]![0] as Array<{
      role: string;
      parts?: Array<{ type: string; text: string }>;
    }>;
    expect(uiArg).toHaveLength(2);
    expect(uiArg[0]?.parts?.[0]?.text).toBe("Earlier");
    expect(uiArg[1]?.parts?.[0]?.text).toBe("Next");
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
});
