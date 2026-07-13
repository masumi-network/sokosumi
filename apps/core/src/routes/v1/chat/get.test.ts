import { OpenAPIHono } from "@hono/zod-openapi";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { OpenAPIHonoWithAuth } from "@/lib/hono";
import { defaultValidationHook } from "@/lib/hono";
import type { AuthVariables } from "@/middleware/auth";
import { TEST_VENDOR_ID } from "@/test-fixtures/vendor.js";

import mountGetChat from "./get";

const {
  conversationFindFirstMock,
  conversationMessageFindManyMock,
  conversationMessageCountMock,
  validateUIMessagesMock,
} = vi.hoisted(() => ({
  conversationFindFirstMock: vi.fn(),
  conversationMessageFindManyMock: vi.fn(),
  conversationMessageCountMock: vi.fn(),
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
    conversationMessage: {
      findMany: conversationMessageFindManyMock,
      count: conversationMessageCountMock,
    },
  },
}));

function createApp(
  authContext: AuthVariables["authContext"] = {
    actor: "user",
    userId: "user_123",
    organizationId: null,
    role: "user",
  },
) {
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

  mountGetChat(app as unknown as OpenAPIHonoWithAuth);
  return app;
}

describe("GET /chat", () => {
  const cid = "550e8400-e29b-41d4-a716-446655440000";

  beforeEach(() => {
    vi.clearAllMocks();
    conversationMessageCountMock.mockResolvedValue(0);
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
    expect(conversationMessageFindManyMock).not.toHaveBeenCalled();
  });

  it("returns UIMessages from persisted items", async () => {
    conversationFindFirstMock.mockResolvedValueOnce({ id: cid });
    conversationMessageCountMock.mockResolvedValueOnce(2);
    conversationMessageFindManyMock.mockResolvedValueOnce([
      { id: "m1", role: "user", contentText: "Hi" },
      { id: "m2", role: "assistant", contentText: "Hello" },
    ]);

    const app = createApp();
    const response = await app.request(
      `http://localhost/?conversationId=${cid}`,
    );

    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      data: { messages: Array<{ id: string; role: string; parts: unknown[] }> };
      meta: { pagination: { total: number; nextCursor: string | null } };
    };
    expect(body.data.messages).toHaveLength(2);
    expect(body.data.messages[0]?.id).toBe("m1");
    expect(body.data.messages[1]?.role).toBe("assistant");
    expect(body.meta.pagination.total).toBe(2);
    expect(body.meta.pagination.nextCursor).toBeNull();
  });

  it("allows delegated coworker auth to read the delegated user's chat", async () => {
    conversationFindFirstMock.mockResolvedValueOnce({
      id: cid,
      metadata: { coworker_id: "cow_123" },
    });
    conversationMessageCountMock.mockResolvedValueOnce(1);
    conversationMessageFindManyMock.mockResolvedValueOnce([
      { id: "m1", role: "user", contentText: "Hi" },
    ]);

    const app = createApp({
      actor: "coworker",
      coworkerId: "cow_123",
      vendorId: TEST_VENDOR_ID,
      context: {
        userId: "delegated_user_123",
        organizationId: "delegated_org_123",
      },
    });
    const response = await app.request(
      `http://localhost/?conversationId=${cid}`,
    );

    expect(response.status).toBe(200);
    expect(conversationFindFirstMock).toHaveBeenCalledWith({
      where: {
        id: cid,
        userId: "delegated_user_123",
        archivedAt: null,
      },
      select: { id: true, metadata: true },
    });
  });

  it("rejects a delegated coworker reading a conversation assigned to another coworker", async () => {
    conversationFindFirstMock.mockResolvedValueOnce({
      id: cid,
      metadata: { coworker_id: "cow_other" },
    });

    const app = createApp({
      actor: "coworker",
      coworkerId: "cow_123",
      vendorId: TEST_VENDOR_ID,
      context: {
        userId: "delegated_user_123",
        organizationId: "delegated_org_123",
      },
    });
    const response = await app.request(
      `http://localhost/?conversationId=${cid}`,
    );

    expect(response.status).toBe(403);
    expect(conversationMessageFindManyMock).not.toHaveBeenCalled();
  });

  it("includes stored reasoning parts before assistant text", async () => {
    conversationFindFirstMock.mockResolvedValueOnce({ id: cid });
    conversationMessageCountMock.mockResolvedValueOnce(1);
    conversationMessageFindManyMock.mockResolvedValueOnce([
      {
        id: "m2",
        role: "assistant",
        contentText: "Done",
        metadata: { reasoning: [{ type: "reasoning", text: "Step A" }] },
      },
    ]);

    const app = createApp();
    const response = await app.request(
      `http://localhost/?conversationId=${cid}`,
    );

    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      data: {
        messages: Array<{ parts: Array<{ type: string; text: string }> }>;
      };
    };
    expect(body.data.messages[0]?.parts).toEqual([
      { type: "reasoning", text: "Step A" },
      { type: "text", text: "Done" },
    ]);
  });

  it("returns pagination nextCursor when more than one page exists", async () => {
    conversationFindFirstMock.mockResolvedValueOnce({ id: cid });
    conversationMessageCountMock.mockResolvedValueOnce(201);
    const rows = Array.from({ length: 201 }, (_, i) => ({
      id: `m${String(i).padStart(3, "0")}`,
      role: "user",
      contentText: `t${i}`,
    }));
    conversationMessageFindManyMock.mockResolvedValueOnce(rows);

    const app = createApp();
    const response = await app.request(
      `http://localhost/?conversationId=${cid}&limit=200`,
    );

    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      data: { messages: Array<{ id: string }> };
      meta: { pagination: { nextCursor: string | null; total: number } };
    };
    expect(body.data.messages).toHaveLength(200);
    expect(body.meta.pagination.total).toBe(201);
    expect(body.meta.pagination.nextCursor).toBe("m199");
  });

  it("coalesces null contentText to empty string so validation is not tripped", async () => {
    conversationFindFirstMock.mockResolvedValueOnce({ id: cid });
    conversationMessageCountMock.mockResolvedValueOnce(1);
    conversationMessageFindManyMock.mockResolvedValueOnce([
      { id: "m1", role: "user", contentText: null },
    ]);

    const app = createApp();
    const response = await app.request(
      `http://localhost/?conversationId=${cid}`,
    );

    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      data: {
        messages: Array<{
          parts: Array<{ type: string; text: string }>;
        }>;
      };
    };
    expect(body.data.messages[0]?.parts[0]?.text).toBe("");
    expect(validateUIMessagesMock).toHaveBeenCalledWith({
      messages: expect.arrayContaining([
        expect.objectContaining({
          parts: [{ type: "text", text: "" }],
        }),
      ]),
    });
  });
});
