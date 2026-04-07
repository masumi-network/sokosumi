import { OpenAPIHono } from "@hono/zod-openapi";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { OpenAPIHonoWithAuth } from "@/lib/hono";
import { defaultValidationHook } from "@/lib/hono";
import type { AuthVariables } from "@/middleware/auth";

import mountGetChat from "./get";

const {
  conversationFindFirstMock,
  conversationItemFindManyMock,
  validateUIMessagesMock,
} = vi.hoisted(() => ({
  conversationFindFirstMock: vi.fn(),
  conversationItemFindManyMock: vi.fn(),
  validateUIMessagesMock: vi.fn(),
}));

vi.mock("ai", () => ({
  validateUIMessages: validateUIMessagesMock,
}));

vi.mock("@/lib/db/prisma", () => ({
  default: {
    conversation: {
      findFirst: conversationFindFirstMock,
    },
    conversationItem: {
      findMany: conversationItemFindManyMock,
    },
  },
}));

function createApp() {
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
      organizationId: null,
    });
    return await next();
  });

  mountGetChat(app as unknown as OpenAPIHonoWithAuth);
  return app;
}

describe("GET /chat", () => {
  const cid = "550e8400-e29b-41d4-a716-446655440000";

  beforeEach(() => {
    vi.clearAllMocks();
    validateUIMessagesMock.mockImplementation(
      async ({ messages }: { messages: unknown[] }) => messages,
    );
  });

  it("returns 404 when the conversation is missing", async () => {
    conversationFindFirstMock.mockResolvedValueOnce(null);

    const app = createApp();
    const response = await app.request(
      `http://localhost/?conversationId=${cid}`,
    );

    expect(response.status).toBe(404);
    expect(conversationItemFindManyMock).not.toHaveBeenCalled();
  });

  it("returns UIMessages from persisted items", async () => {
    conversationFindFirstMock.mockResolvedValueOnce({ id: cid });
    conversationItemFindManyMock.mockResolvedValueOnce([
      { id: "m1", role: "user", contentText: "Hi" },
      { id: "m2", role: "assistant", contentText: "Hello" },
    ]);

    const app = createApp();
    const response = await app.request(
      `http://localhost/?conversationId=${cid}`,
    );

    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      messages: Array<{ id: string; role: string; parts: unknown[] }>;
    };
    expect(body.messages).toHaveLength(2);
    expect(body.messages[0]?.id).toBe("m1");
    expect(body.messages[1]?.role).toBe("assistant");
  });

  it("coalesces null contentText to empty string so validation is not tripped", async () => {
    conversationFindFirstMock.mockResolvedValueOnce({ id: cid });
    conversationItemFindManyMock.mockResolvedValueOnce([
      { id: "m1", role: "user", contentText: null },
    ]);

    const app = createApp();
    const response = await app.request(
      `http://localhost/?conversationId=${cid}`,
    );

    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      messages: Array<{
        parts: Array<{ type: string; text: string }>;
      }>;
    };
    expect(body.messages[0]?.parts[0]?.text).toBe("");
    expect(validateUIMessagesMock).toHaveBeenCalledWith({
      messages: expect.arrayContaining([
        expect.objectContaining({
          parts: [{ type: "text", text: "" }],
        }),
      ]),
    });
  });
});
