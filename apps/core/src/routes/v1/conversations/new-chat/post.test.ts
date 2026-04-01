import { OpenAPIHono } from "@hono/zod-openapi";
import { HTTPException } from "hono/http-exception";
import { beforeEach, describe, expect, it, vi } from "vitest";

import * as envConfig from "@/config/env";
import type { OpenAPIHonoWithAuth } from "@/lib/hono";
import { openApiValidationDefaultHook } from "@/lib/hono";
import type { AuthVariables } from "@/middleware/auth";

import mountPostNewChat from "./post";

const {
  conversationFindFirstMock,
  conversationItemCreateMock,
  convertToModelMessagesMock,
  coworkerFindFirstMock,
  generateChatTitleMock,
  getSokosumiProviderMock,
  requireCoworkerChatCapabilityMock,
  streamTextMock,
} = vi.hoisted(() => ({
  conversationFindFirstMock: vi.fn(),
  conversationItemCreateMock: vi.fn(),
  convertToModelMessagesMock: vi.fn(),
  coworkerFindFirstMock: vi.fn(),
  generateChatTitleMock: vi.fn(),
  getSokosumiProviderMock: vi.fn(),
  requireCoworkerChatCapabilityMock: vi.fn(),
  streamTextMock: vi.fn(),
}));

vi.mock("ai", () => ({
  convertToModelMessages: convertToModelMessagesMock,
  streamText: streamTextMock,
}));

vi.mock("@/lib/sokosumi-ai-provider", () => ({
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
    defaultHook: openApiValidationDefaultHook,
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

  mountPostNewChat(app as unknown as OpenAPIHonoWithAuth);
  return app;
}

describe("POST /conversations/new-chat", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getSokosumiProviderMock.mockReturnValue(() => ({}));
    convertToModelMessagesMock.mockResolvedValue([]);
    conversationItemCreateMock.mockResolvedValue(undefined);
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
    const response = await app.request("http://localhost/new-chat", {
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
    const baseline = envConfig.getEnv();
    const spy = vi.spyOn(envConfig, "getEnv").mockReturnValue({
      ...baseline,
      OPENROUTER_CHAT_API_KEY: undefined,
    });

    const app = createApp();
    const response = await app.request("http://localhost/new-chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        conversationId: "550e8400-e29b-41d4-a716-446655440000",
        messages: [{ role: "user", parts: [{ type: "text", text: "Hi" }] }],
      }),
    });

    spy.mockRestore();
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
    const response = await app.request("http://localhost/new-chat", {
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
    const response = await app.request("http://localhost/new-chat", {
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
    const response = await app.request("http://localhost/new-chat", {
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
