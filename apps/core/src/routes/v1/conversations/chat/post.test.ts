import { OpenAPIHono } from "@hono/zod-openapi";
import { HTTPException } from "hono/http-exception";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { OpenAPIHonoWithAuth } from "@/lib/hono";
import type { AuthVariables } from "@/middleware/auth";

import mountPostConversationChat from "./post";

const {
  conversationFindFirstMock,
  conversationItemCreateMock,
  coworkerConversationStreamMock,
  coworkerFindFirstMock,
  generateChatTitleMock,
  openrouterConversationStreamMock,
  requireCoworkerChatCapabilityMock,
  streamWithAssistantPersistenceMock,
  updateConversationMock,
} = vi.hoisted(() => ({
  conversationFindFirstMock: vi.fn(),
  conversationItemCreateMock: vi.fn(),
  coworkerConversationStreamMock: vi.fn(),
  coworkerFindFirstMock: vi.fn(),
  generateChatTitleMock: vi.fn(),
  openrouterConversationStreamMock: vi.fn(),
  requireCoworkerChatCapabilityMock: vi.fn(),
  streamWithAssistantPersistenceMock: vi.fn(),
  updateConversationMock: vi.fn(),
}));

vi.mock("@/helpers/access-control", () => ({
  requireCoworkerChatCapability: requireCoworkerChatCapabilityMock,
}));

vi.mock("@/clients/coworker-api.client", () => ({
  coworkerConversationClient: {
    provider: "coworker",
    stream: coworkerConversationStreamMock,
  },
}));

vi.mock("@/clients/openrouter.client", () => ({
  openrouterClient: {
    generateChatTitle: generateChatTitleMock,
  },
  openrouterConversationClient: {
    provider: "openrouter",
    stream: openrouterConversationStreamMock,
  },
}));

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
    conversationItemCreateMock.mockResolvedValue(undefined);
    generateChatTitleMock.mockResolvedValue(null);
    coworkerConversationStreamMock.mockResolvedValue(
      new Response("responses", {
        headers: {
          "Content-Type": "text/event-stream",
        },
      }),
    );
    streamWithAssistantPersistenceMock.mockImplementation((body) => body);
    openrouterConversationStreamMock.mockResolvedValue(
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
    expect(openrouterConversationStreamMock).not.toHaveBeenCalled();
  });

  it("falls back to OpenRouter when conversation has no coworker", async () => {
    conversationFindFirstMock
      .mockResolvedValueOnce({
        id: "550e8400-e29b-41d4-a716-446655440000",
        metadata: {},
      })
      .mockResolvedValueOnce({
        _count: {
          items: 0,
        },
      });

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
    expect(requireCoworkerChatCapabilityMock).not.toHaveBeenCalled();
    expect(openrouterConversationStreamMock).toHaveBeenCalledWith(
      expect.objectContaining({
        actor: {
          userId: "user_123",
          organizationId: null,
        },
        messages: [{ role: "user", content: "Hello" }],
        modelId: null,
        previousResponseId: null,
      }),
    );
    expect(coworkerConversationStreamMock).not.toHaveBeenCalled();
  });

  it("passes coworker baseURL, slug and organization id to the Responses API", async () => {
    conversationFindFirstMock
      .mockResolvedValueOnce({
        id: "550e8400-e29b-41d4-a716-446655440000",
        metadata: {
          coworker_slug: "ops-agent",
          previous_response_id: "resp_prev",
        },
      })
      .mockResolvedValueOnce({
        _count: {
          items: 1,
        },
      });
    coworkerFindFirstMock.mockResolvedValueOnce({ id: "cow_123" });
    requireCoworkerChatCapabilityMock.mockResolvedValueOnce({
      id: "cow_123",
      slug: "ops-agent",
      baseURL: "https://responses.example.com/v1",
    });

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
    expect(requireCoworkerChatCapabilityMock).toHaveBeenCalledWith("cow_123");
    expect(coworkerConversationStreamMock).toHaveBeenCalledWith(
      expect.objectContaining({
        actor: {
          userId: "user_123",
          organizationId: "org_123",
        },
        coworker: {
          id: "cow_123",
          slug: "ops-agent",
          baseUrl: "https://responses.example.com/v1",
        },
        previousResponseId: "resp_prev",
        lifecycle: {
          onResponseStarted: expect.any(Function),
          onResponseCompleted: expect.any(Function),
        },
      }),
    );
    expect(openrouterConversationStreamMock).not.toHaveBeenCalled();
  });

  it("prefers previousResponseId from request body over conversation metadata", async () => {
    conversationFindFirstMock
      .mockResolvedValueOnce({
        id: "550e8400-e29b-41d4-a716-446655440000",
        metadata: {
          coworker_slug: "ops-agent",
          previous_response_id: "resp_from_db",
        },
      })
      .mockResolvedValueOnce({
        _count: {
          items: 1,
        },
      });
    coworkerFindFirstMock.mockResolvedValueOnce({ id: "cow_123" });
    requireCoworkerChatCapabilityMock.mockResolvedValueOnce({
      id: "cow_123",
      slug: "ops-agent",
      baseURL: "https://responses.example.com/v1",
    });

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
        previousResponseId: "resp_from_client",
        messages: [
          {
            role: "user",
            parts: [{ type: "text", text: "Hello" }],
          },
        ],
      }),
    });

    expect(response.status).toBe(200);
    expect(coworkerConversationStreamMock).toHaveBeenCalledWith(
      expect.objectContaining({
        messages: [{ role: "user", content: "Hello" }],
        previousResponseId: "resp_from_client",
      }),
    );
  });

  it("returns 503 when conversation has coworker but coworker has no Responses API URL", async () => {
    conversationFindFirstMock
      .mockResolvedValueOnce({
        id: "550e8400-e29b-41d4-a716-446655440000",
        metadata: { coworker_slug: "ops-agent" },
      })
      .mockResolvedValueOnce({
        _count: {
          items: 1,
        },
      });
    coworkerFindFirstMock.mockResolvedValueOnce({ id: "cow_123" });
    requireCoworkerChatCapabilityMock.mockResolvedValueOnce({
      id: "cow_123",
      slug: "ops-agent",
      baseURL: null,
    });

    const app = createApp({ organizationId: "org_123" });
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

    expect(response.status).toBe(503);
    const bodyText = await response.text();
    expect(bodyText).toContain("no Responses API URL configured");
    expect(coworkerConversationStreamMock).not.toHaveBeenCalled();
    expect(openrouterConversationStreamMock).not.toHaveBeenCalled();
  });

  it("passes previous response id to coworker adapter for stale-id fallback handling", async () => {
    conversationFindFirstMock.mockReset();
    conversationFindFirstMock.mockResolvedValueOnce({
      id: "550e8400-e29b-41d4-a716-446655440000",
      metadata: {
        coworker_slug: "ops-agent",
        previous_response_id: "resp_stale",
      },
    });
    coworkerFindFirstMock.mockResolvedValueOnce({ id: "cow_123" });
    requireCoworkerChatCapabilityMock.mockResolvedValueOnce({
      id: "cow_123",
      slug: "ops-agent",
      baseURL: "https://responses.example.com/v1",
    });

    const app = createApp({ organizationId: "org_123" });
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
    expect(coworkerConversationStreamMock).toHaveBeenCalledTimes(1);
    expect(coworkerConversationStreamMock).toHaveBeenCalledWith(
      expect.objectContaining({
        messages: [{ role: "user", content: "Hello" }],
        previousResponseId: "resp_stale",
        lifecycle: {
          onResponseStarted: expect.any(Function),
          onResponseCompleted: expect.any(Function),
        },
      }),
    );
    expect(openrouterConversationStreamMock).not.toHaveBeenCalled();
    expect(updateConversationMock).not.toHaveBeenCalled();
  });
});
