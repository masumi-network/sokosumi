import { OpenAPIHono } from "@hono/zod-openapi";
import { HTTPException } from "hono/http-exception";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { OpenAPIHonoWithAuth } from "@/lib/hono";
import { defaultValidationHook } from "@/lib/hono";
import type { AuthVariables } from "@/middleware/auth";

import mountPostChat from "./post";

const {
  conversationFindFirstMock,
  conversationItemCreateMock,
  conversationItemFindManyMock,
  convertToModelMessagesMock,
  coworkerFindFirstMock,
  generateChatTitleMock,
  getOpenRouterChatApiKeyForProviderMock,
  getSokosumiProviderMock,
  requireCoworkerChatCapabilityMock,
  streamTextMock,
  validateUIMessagesMock,
} = vi.hoisted(() => ({
  conversationFindFirstMock: vi.fn(),
  conversationItemCreateMock: vi.fn(),
  conversationItemFindManyMock: vi.fn(),
  convertToModelMessagesMock: vi.fn(),
  coworkerFindFirstMock: vi.fn(),
  generateChatTitleMock: vi.fn(),
  getOpenRouterChatApiKeyForProviderMock: vi.fn(),
  getSokosumiProviderMock: vi.fn(),
  requireCoworkerChatCapabilityMock: vi.fn(),
  streamTextMock: vi.fn(),
  validateUIMessagesMock: vi.fn(),
}));

vi.mock("ai", () => ({
  convertToModelMessages: convertToModelMessagesMock,
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

vi.mock("@/clients/openrouter.client", () => ({
  openrouterClient: {
    generateChatTitle: generateChatTitleMock,
  },
}));

vi.mock("@/lib/db/prisma", () => ({
  default: {
    conversation: {
      findFirst: conversationFindFirstMock,
      update: vi.fn(),
    },
    conversationItem: {
      create: conversationItemCreateMock,
      findMany: conversationItemFindManyMock,
    },
    coworker: {
      findFirst: coworkerFindFirstMock,
    },
  },
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
    getOpenRouterChatApiKeyForProviderMock.mockReturnValue(
      "sk-or-v1-test-0000000000000000000000000000000000000000",
    );
    getSokosumiProviderMock.mockReturnValue(() => ({}));
    convertToModelMessagesMock.mockResolvedValue([]);
    conversationItemCreateMock.mockResolvedValue(undefined);
    conversationItemFindManyMock.mockResolvedValue([]);
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

  it("returns 404 when the conversation is missing", async () => {
    conversationFindFirstMock.mockResolvedValueOnce(null);

    const app = createApp();
    const response = await app.request("http://localhost/", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
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
        conversationId: "550e8400-e29b-41d4-a716-446655440000",
        messages: [{ role: "user", parts: [{ type: "text", text: "Hi" }] }],
      }),
    });

    expect(response.status).toBe(503);
    expect(streamTextMock).not.toHaveBeenCalled();
  });

  it("calls streamText for OpenRouter-backed conversation", async () => {
    conversationFindFirstMock
      .mockResolvedValueOnce({
        id: "550e8400-e29b-41d4-a716-446655440000",
        metadata: { model_id: "claude-opus-4-6" },
      })
      .mockResolvedValueOnce({ _count: { items: 1 } });

    const app = createApp();
    const response = await app.request("http://localhost/", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
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

  it("passes onInvalidPreviousResponseId for coworker threads with conversation id", async () => {
    conversationFindFirstMock
      .mockResolvedValueOnce({
        id: "550e8400-e29b-41d4-a716-446655440000",
        metadata: {
          coworker_slug: "ops-agent",
          previous_response_id: "resp_stale",
        },
      })
      .mockResolvedValueOnce({ _count: { items: 1 } });
    coworkerFindFirstMock.mockResolvedValueOnce({ id: "cow_123" });

    const app = createApp({ organizationId: "org_1" });
    const response = await app.request("http://localhost/", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        conversationId: "550e8400-e29b-41d4-a716-446655440000",
        messages: [{ role: "user", parts: [{ type: "text", text: "Hi" }] }],
      }),
    });

    expect(response.status).toBe(200);
    expect(streamTextMock).toHaveBeenCalledOnce();
    const args = streamTextMock.mock.calls[0]![0] as {
      providerOptions?: {
        sokosumi?: { mode?: string; onInvalidPreviousResponseId?: unknown };
      };
    };
    expect(args.providerOptions?.sokosumi?.mode).toBe("coworker");
    expect(
      typeof args.providerOptions?.sokosumi?.onInvalidPreviousResponseId,
    ).toBe("function");
  });

  it("merges DB history when the client sends only the new message (submit-message)", async () => {
    const cid = "550e8400-e29b-41d4-a716-446655440000";
    conversationFindFirstMock
      .mockResolvedValueOnce({
        id: cid,
        metadata: { model_id: "claude-opus-4-6" },
      })
      .mockResolvedValueOnce({ _count: { items: 1 } });
    conversationItemFindManyMock.mockResolvedValueOnce([
      {
        id: "item-1",
        role: "user",
        contentText: "Earlier",
      },
    ]);

    const app = createApp();
    const response = await app.request("http://localhost/", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        conversationId: cid,
        trigger: "submit-message",
        message: { role: "user", parts: [{ type: "text", text: "Next" }] },
      }),
    });

    expect(response.status).toBe(200);
    expect(conversationItemFindManyMock).toHaveBeenCalledOnce();
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
        conversationId: "550e8400-e29b-41d4-a716-446655440000",
        messages: [{ role: "user", parts: [{ type: "text", text: "Hi" }] }],
      }),
    });

    expect(response.status).toBe(403);
    expect(streamTextMock).not.toHaveBeenCalled();
  });
});
