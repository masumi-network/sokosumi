import { OpenAPIHono } from "@hono/zod-openapi";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { OpenAPIHonoWithAuth } from "@/lib/hono";
import { defaultValidationHook } from "@/lib/hono";
import type { AuthVariables } from "@/middleware/auth";

import mountGetConversationWarmup from "./get";

const {
  conversationFindFirstMock,
  coworkerFindFirstMock,
  prismaTransactionMock,
  readCoworkerReadyStateMock,
} = vi.hoisted(() => ({
  conversationFindFirstMock: vi.fn(),
  coworkerFindFirstMock: vi.fn(),
  prismaTransactionMock: vi.fn(),
  readCoworkerReadyStateMock: vi.fn(),
}));

vi.mock("@/lib/db/prisma", () => ({
  default: {
    $transaction: prismaTransactionMock,
    conversation: { findFirst: conversationFindFirstMock },
    coworker: { findFirst: coworkerFindFirstMock },
  },
}));

vi.mock("@/routes/v1/chat/warmup-coworker", () => ({
  readCoworkerReadyState: readCoworkerReadyStateMock,
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

  mountGetConversationWarmup(app as unknown as OpenAPIHonoWithAuth);
  return app;
}

const cid = "550e8400-e29b-41d4-a716-446655440000";

function conversation(metadata: Record<string, unknown>) {
  return {
    id: cid,
    userId: "user_123",
    title: "Chat",
    metadata,
    createdAt: new Date("2025-01-01T00:00:00.000Z"),
    updatedAt: new Date("2025-01-01T00:00:00.000Z"),
  };
}

describe("GET /conversations/{id}/warmup", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    prismaTransactionMock.mockImplementation(
      async (cb: (tx: unknown) => unknown) =>
        cb({
          conversation: { findFirst: conversationFindFirstMock },
          coworker: { findFirst: coworkerFindFirstMock },
        }),
    );
    readCoworkerReadyStateMock.mockResolvedValue({
      state: "ready",
      completedAt: "2025-01-01T00:00:00.000Z",
      source: "redis",
    });
  });

  it("returns 404 when the conversation is missing", async () => {
    conversationFindFirstMock.mockResolvedValueOnce(null);

    const response = await createApp().request(
      `http://localhost/${cid}/warmup`,
    );

    expect(response.status).toBe(404);
  });

  it("returns warmup state for the owning user", async () => {
    conversationFindFirstMock.mockResolvedValueOnce(
      conversation({ userId: "user_123", warmup_state: "ready" }),
    );

    const response = await createApp().request(
      `http://localhost/${cid}/warmup`,
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.data).toEqual({
      conversationId: cid,
      state: "ready",
      completedAt: "2025-01-01T00:00:00.000Z",
      source: "redis",
    });
    expect(readCoworkerReadyStateMock).toHaveBeenCalledWith(cid, {
      userId: "user_123",
      warmup_state: "ready",
    });
  });

  it("returns 404 when the conversation belongs to another user", async () => {
    conversationFindFirstMock.mockResolvedValueOnce(null);

    const response = await createApp({
      actor: "user",
      userId: "user_other",
      organizationId: null,
      role: "user",
    }).request(`http://localhost/${cid}/warmup`);

    expect(response.status).toBe(404);
  });

  it("falls back to metadata when Redis misses", async () => {
    conversationFindFirstMock.mockResolvedValueOnce(
      conversation({ warmup_state: "ready" }),
    );
    readCoworkerReadyStateMock.mockResolvedValueOnce({
      state: "ready",
      completedAt: "2025-01-02T00:00:00.000Z",
      source: "metadata",
    });

    const response = await createApp().request(
      `http://localhost/${cid}/warmup`,
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.data.source).toBe("metadata");
    expect(body.data.state).toBe("ready");
  });
});
