import { OpenAPIHono } from "@hono/zod-openapi";
import { HTTPException } from "hono/http-exception";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { OpenAPIHonoWithAuth } from "@/lib/hono";
import type { AuthVariables } from "@/middleware/auth";

import mountPostConversationChat from "./post";

const {
  conversationFindFirstMock,
  conversationItemCreateMock,
  coworkerFindFirstMock,
  generateChatTitleMock,
  isResponsesApiConfiguredMock,
  openrouterStreamChatResponseMock,
  requireCoworkerChatCapabilityMock,
  streamResponsesApiMock,
  streamWithAssistantPersistenceMock,
  updateConversationMock,
} = vi.hoisted(() => ({
  conversationFindFirstMock: vi.fn(),
  conversationItemCreateMock: vi.fn(),
  coworkerFindFirstMock: vi.fn(),
  generateChatTitleMock: vi.fn(),
  isResponsesApiConfiguredMock: vi.fn(() => false),
  openrouterStreamChatResponseMock: vi.fn(),
  requireCoworkerChatCapabilityMock: vi.fn(),
  streamResponsesApiMock: vi.fn(),
  streamWithAssistantPersistenceMock: vi.fn(),
  updateConversationMock: vi.fn(),
}));

vi.mock("@/helpers/access-control", () => ({
  requireCoworkerChatCapability: requireCoworkerChatCapabilityMock,
}));

vi.mock("@/clients/coworker-api.client", () => ({
  streamResponsesApi: streamResponsesApiMock,
}));

vi.mock("@/clients/openrouter.client", () => ({
  openrouterClient: {
    generateChatTitle: generateChatTitleMock,
    streamChatResponse: openrouterStreamChatResponseMock,
  },
}));

vi.mock("@/config/env", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/config/env")>();
  return {
    ...actual,
    isResponsesApiConfigured: isResponsesApiConfiguredMock,
  };
});

vi.mock("@/helpers/chat-stream-persist", () => ({
  streamWithAssistantPersistence: streamWithAssistantPersistenceMock,
}));

vi.mock("@/lib/db/prisma", () => ({
  default: {
    conversation: {
      findFirst: conversationFindFirstMock,
      update: updateConversationMock,
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
  }>();

  app.use("*", async (c, next) => {
    c.set("isAuthenticated", true);
    c.set("authContext", {
      actor: "user",
      userId: "user_123",
      organizationId,
    });
    return await next();
  });

  mountPostConversationChat(app as unknown as OpenAPIHonoWithAuth);
  return app;
}

describe("POST /conversations/chat", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    isResponsesApiConfiguredMock.mockReturnValue(false);
    conversationItemCreateMock.mockResolvedValue(undefined);
    generateChatTitleMock.mockResolvedValue(null);
    streamResponsesApiMock.mockResolvedValue(
      new Response("responses", {
        headers: {
          "Content-Type": "text/event-stream",
        },
      }),
    );
    streamWithAssistantPersistenceMock.mockImplementation((body) => body);
    openrouterStreamChatResponseMock.mockResolvedValue(
      new Response("openrouter", {
        headers: {
          "Content-Type": "text/plain",
        },
      }),
    );
    requireCoworkerChatCapabilityMock.mockResolvedValue({
      id: "cow_123",
      slug: "ops-agent",
      baseURL: "https://responses.example.com/v1",
    });
  });

  it("returns 404 when the conversation coworker cannot be resolved", async () => {
    conversationFindFirstMock.mockResolvedValueOnce({
      id: "550e8400-e29b-41d4-a716-446655440000",
      metadata: { coworker_slug: "ops-agent" },
    });
    coworkerFindFirstMock.mockResolvedValueOnce(null);

    const app = createApp();
    const response = await app.request("http://localhost/chat", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        conversationId: "550e8400-e29b-41d4-a716-446655440000",
        messages: [
          {
            role: "user",
            parts: [{ type: "text", text: "Hello" }],
          },
        ],
      }),
    });

    expect(response.status).toBe(404);
    expect(requireCoworkerChatCapabilityMock).not.toHaveBeenCalled();
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
    const response = await app.request("http://localhost/chat", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        conversationId: "550e8400-e29b-41d4-a716-446655440000",
        messages: [
          {
            role: "user",
            parts: [{ type: "text", text: "Hello" }],
          },
        ],
      }),
    });

    expect(response.status).toBe(403);
    expect(openrouterStreamChatResponseMock).not.toHaveBeenCalled();
  });

  it("falls back to OpenRouter when coworker chat is allowed but Responses API is disabled", async () => {
    conversationFindFirstMock
      .mockResolvedValueOnce({
        id: "550e8400-e29b-41d4-a716-446655440000",
        metadata: { coworker_slug: "ops-agent" },
      })
      .mockResolvedValueOnce({
        _count: {
          items: 0,
        },
      });
    coworkerFindFirstMock.mockResolvedValueOnce({ id: "cow_123" });

    const app = createApp();
    const response = await app.request("http://localhost/chat", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        conversationId: "550e8400-e29b-41d4-a716-446655440000",
        messages: [
          {
            role: "user",
            parts: [{ type: "text", text: "Hello" }],
          },
        ],
      }),
    });

    expect(response.status).toBe(200);
    expect(requireCoworkerChatCapabilityMock).toHaveBeenCalledWith("cow_123");
    expect(openrouterStreamChatResponseMock).toHaveBeenCalledWith(
      [{ role: "user", content: "Hello" }],
      null,
    );
    expect(streamResponsesApiMock).not.toHaveBeenCalled();
  });

  it("passes coworker slug and organization id to the Responses API", async () => {
    isResponsesApiConfiguredMock.mockReturnValue(true);
    conversationFindFirstMock
      .mockResolvedValueOnce({
        id: "550e8400-e29b-41d4-a716-446655440000",
        metadata: {
          coworker_slug: "ops-agent",
          last_responses_api_response_id: "resp_prev",
        },
      })
      .mockResolvedValueOnce({
        _count: {
          items: 1,
        },
      });
    coworkerFindFirstMock.mockResolvedValueOnce({ id: "cow_123" });

    const app = createApp({
      organizationId: "org_123",
    });
    const response = await app.request("http://localhost/chat", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        conversationId: "550e8400-e29b-41d4-a716-446655440000",
        messages: [
          {
            role: "user",
            parts: [{ type: "text", text: "Hello" }],
          },
        ],
      }),
    });

    expect(response.status).toBe(200);
    expect(streamResponsesApiMock).toHaveBeenCalledWith("Hello", {
      sokosumiUserId: "user_123",
      sokosumiOrganizationId: "org_123",
      coworkerSlug: "ops-agent",
      previousResponseId: "resp_prev",
      onResponseCompleted: expect.any(Function),
    });
    expect(openrouterStreamChatResponseMock).not.toHaveBeenCalled();
  });
});
