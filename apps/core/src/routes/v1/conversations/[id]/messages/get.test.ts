import { OpenAPIHono } from "@hono/zod-openapi";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { OpenAPIHonoWithAuth } from "@/lib/hono";
import { defaultValidationHook } from "@/lib/hono";
import type { AuthVariables } from "@/middleware/auth";

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

function createApp() {
  const app = new OpenAPIHono<{
    Variables: AuthVariables & { requestId: string };
  }>({
    defaultHook: defaultValidationHook,
  });

  app.use("*", async (c, next) => {
    c.set("isAuthenticated", true);
    c.set("authContext", {
      actor: "user",
      userId: "user_123",
      organizationId: null,
      role: "user",
    });
    c.set("requestId", "req_test");
    return await next();
  });

  mountGetConversationMessages(app as unknown as OpenAPIHonoWithAuth);
  return app;
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
});
