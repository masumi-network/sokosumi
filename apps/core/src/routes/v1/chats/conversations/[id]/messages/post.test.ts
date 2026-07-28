import { OpenAPIHono } from "@hono/zod-openapi";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { OpenAPIHonoWithAuth } from "@/lib/hono";
import { defaultValidationHook } from "@/lib/hono";
import type { AuthVariables } from "@/middleware/auth";
import { TEST_VENDOR_ID } from "@/test-fixtures/vendor.js";

import mountPostConversationMessage from "./post";

const {
  conversationFindFirstMock,
  conversationMessageCreateMock,
  conversationUpdateMock,
  coworkerFindFirstMock,
  generateChatTitleMock,
  prismaTransactionMock,
} = vi.hoisted(() => ({
  conversationFindFirstMock: vi.fn(),
  conversationMessageCreateMock: vi.fn(),
  conversationUpdateMock: vi.fn(),
  coworkerFindFirstMock: vi.fn(),
  generateChatTitleMock: vi.fn(),
  prismaTransactionMock: vi.fn(),
}));

vi.mock("@/lib/db/prisma", () => ({
  default: {
    $transaction: prismaTransactionMock,
    conversation: { update: conversationUpdateMock },
  },
}));

vi.mock("@/clients/openrouter.client", () => ({
  openrouterClient: { generateChatTitle: generateChatTitleMock },
}));

function createApp(
  authContext: AuthVariables["authContext"] = {
    actor: "user",
    userId: "user_123",
    organizationId: null,
    role: "user",
  },
) {
  const app = new OpenAPIHono<{ Variables: AuthVariables }>({
    defaultHook: defaultValidationHook,
  });

  app.use("*", async (c, next) => {
    c.set("isAuthenticated", true);
    c.set("authContext", authContext);
    return await next();
  });

  mountPostConversationMessage(app as unknown as OpenAPIHonoWithAuth);
  return app;
}

const cid = "550e8400-e29b-41d4-a716-446655440000";

const delegatedCoworker: AuthVariables["authContext"] = {
  actor: "coworker",
  coworkerId: "cow_123",
  vendorId: TEST_VENDOR_ID,
  context: {
    userId: "delegated_user_123",
    organizationId: "delegated_org_123",
  },
};

function post(app: ReturnType<typeof createApp>) {
  return app.request(`http://localhost/${cid}/messages`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ role: "user", content: "Hi" }),
  });
}

describe("POST /conversations/{id}/messages", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    generateChatTitleMock.mockResolvedValue(null);
    conversationMessageCreateMock.mockResolvedValue({
      id: "550e8400-e29b-41d4-a716-446655440009",
      role: "user",
      contentType: null,
      contentText: "Hi",
      metadata: null,
      createdAt: new Date("2025-01-01T00:00:00.000Z"),
    });
    prismaTransactionMock.mockImplementation(
      async (cb: (tx: unknown) => unknown) =>
        cb({
          conversation: { findFirst: conversationFindFirstMock },
          conversationMessage: { create: conversationMessageCreateMock },
          coworker: { findFirst: coworkerFindFirstMock },
        }),
    );
  });

  function conversation(metadata: Record<string, unknown>) {
    return { id: cid, metadata, _count: { messages: 0 } };
  }

  it("returns 404 when the conversation is missing", async () => {
    conversationFindFirstMock.mockResolvedValueOnce(null);

    expect((await post(createApp())).status).toBe(404);
    expect(conversationMessageCreateMock).not.toHaveBeenCalled();
  });

  it("posts a message for the owning user", async () => {
    conversationFindFirstMock.mockResolvedValueOnce(
      conversation({ userId: "user_123" }),
    );

    expect((await post(createApp())).status).toBe(201);
    expect(conversationMessageCreateMock).toHaveBeenCalled();
  });

  it("returns 403 for coworker API keys (no X-Context-User-Id impersonation)", async () => {
    expect((await post(createApp(delegatedCoworker))).status).toBe(403);
    expect(conversationMessageCreateMock).not.toHaveBeenCalled();
  });
});
