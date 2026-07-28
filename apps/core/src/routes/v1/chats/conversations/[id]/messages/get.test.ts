import { OpenAPIHono } from "@hono/zod-openapi";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { OpenAPIHonoWithAuth } from "@/lib/hono";
import { defaultValidationHook } from "@/lib/hono";
import type { AuthenticationContext, AuthVariables } from "@/middleware/auth";
import { TEST_VENDOR_ID } from "@/test-fixtures/vendor.js";

import mountGetConversationMessages from "./get";

const { prismaTransactionMock } = vi.hoisted(() => ({
  prismaTransactionMock: vi.fn(),
}));

vi.mock("@/lib/db/prisma", () => ({
  default: {
    $transaction: prismaTransactionMock,
  },
}));

const CONVERSATION_ID = "550e8400-e29b-41d4-a716-446655440000";
const ASSISTANT_MESSAGE_ID = "550e8400-e29b-41d4-a716-446655440001";

interface ConversationMessagesTestTransaction {
  conversation: {
    findFirst: ReturnType<typeof vi.fn>;
  };
  conversationMessage: {
    findMany: ReturnType<typeof vi.fn>;
    count: ReturnType<typeof vi.fn>;
  };
}

function createApp(
  authContext: AuthenticationContext = {
    actor: "user",
    userId: "user_123",
    organizationId: null,
    role: "user",
  },
) {
  const app = new OpenAPIHono<{
    Variables: AuthVariables & { requestId: string };
  }>({
    defaultHook: defaultValidationHook,
  });

  app.use("*", async (c, next) => {
    c.set("isAuthenticated", true);
    c.set("authContext", authContext);
    c.set("requestId", "req_test");
    return await next();
  });

  mountGetConversationMessages(app as unknown as OpenAPIHonoWithAuth);
  return app;
}

function mockConversationWithMessages(
  metadata: Record<string, unknown> | null = null,
) {
  prismaTransactionMock.mockImplementation(
    (callback: (tx: ConversationMessagesTestTransaction) => Promise<unknown>) =>
      callback({
        conversation: {
          findFirst: vi.fn().mockResolvedValue({
            id: CONVERSATION_ID,
            userId: "user_123",
            metadata,
          }),
        },
        conversationMessage: {
          findMany: vi.fn().mockResolvedValue([
            {
              id: ASSISTANT_MESSAGE_ID,
              role: "assistant",
              contentType: "output_text",
              contentText: "Hello",
              createdAt: new Date("2026-05-01T17:00:00.000Z"),
              metadata: null,
            },
          ]),
          count: vi.fn().mockResolvedValue(1),
        },
      }),
  );
}

describe("GET /conversations/{id}/messages", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns assistant image file parts from persisted ui metadata", async () => {
    prismaTransactionMock.mockImplementation(
      (
        callback: (tx: ConversationMessagesTestTransaction) => Promise<unknown>,
      ) =>
        callback({
          conversation: {
            findFirst: vi.fn().mockResolvedValue({
              id: CONVERSATION_ID,
              userId: "user_123",
            }),
          },
          conversationMessage: {
            findMany: vi.fn().mockResolvedValue([
              {
                id: ASSISTANT_MESSAGE_ID,
                role: "assistant",
                contentType: "output_text",
                contentText: "Here's the generated image.",
                createdAt: new Date("2026-05-01T17:00:00.000Z"),
                metadata: {
                  ui_message_v1: {
                    parts: [
                      {
                        type: "output_text",
                        text: "Here's the generated image.",
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
              },
            ]),
            count: vi.fn().mockResolvedValue(1),
          },
        }),
    );

    const app = createApp();
    const response = await app.request(
      `http://localhost/${CONVERSATION_ID}/messages`,
    );
    const body = (await response.json()) as {
      data: Array<{
        id: string;
        role: string;
        content: unknown;
      }>;
    };

    expect(response.status).toBe(200);
    expect(body.data).toEqual([
      {
        id: ASSISTANT_MESSAGE_ID,
        role: "assistant",
        content: [
          { type: "output_text", text: "Here's the generated image." },
          {
            type: "file",
            url: "https://blob.example.com/generated.png",
            mediaType: "image/png",
            filename: "generated.png",
          },
        ],
        createdAt: 1777654800,
      },
    ]);
  });

  it("allows orchestrator with context headers as the context user", async () => {
    mockConversationWithMessages({ coworker_id: "cow_123" });

    const response = await createApp({
      actor: "orchestrator",
      orchestratorId: "orch_123",
      context: { userId: "user_123", organizationId: null },
    }).request(`http://localhost/${CONVERSATION_ID}/messages`);

    expect(response.status).toBe(200);
  });

  it("returns 403 for bare orchestrator without context headers", async () => {
    mockConversationWithMessages();

    const response = await createApp({
      actor: "orchestrator",
      orchestratorId: "orch_123",
    }).request(`http://localhost/${CONVERSATION_ID}/messages`);

    expect(response.status).toBe(403);
  });

  it("returns 403 for coworker API keys (no X-Context-User-Id impersonation)", async () => {
    mockConversationWithMessages({ coworker_id: "cow_123" });

    const response = await createApp({
      actor: "coworker",
      coworkerId: "cow_123",
      vendorId: TEST_VENDOR_ID,
      context: { userId: "user_123", organizationId: null },
    }).request(`http://localhost/${CONVERSATION_ID}/messages`);

    expect(response.status).toBe(403);
  });
});
