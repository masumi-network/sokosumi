import { OpenAPIHono } from "@hono/zod-openapi";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { OpenAPIHonoWithAuth } from "@/lib/hono";
import { defaultValidationHook } from "@/lib/hono";
import type { AuthVariables } from "@/middleware/auth";
import { TEST_VENDOR_ID } from "@/test-fixtures/vendor.js";

import mountCreateConversation from "./post";

const {
  conversationCreateMock,
  conversationFindFirstMock,
  prismaTransactionMock,
} = vi.hoisted(() => ({
  conversationCreateMock: vi.fn(),
  conversationFindFirstMock: vi.fn(),
  prismaTransactionMock: vi.fn(),
}));

vi.mock("@/lib/db/prisma", () => ({
  default: {
    $transaction: prismaTransactionMock,
    conversation: {
      findFirst: conversationFindFirstMock,
      create: conversationCreateMock,
    },
    coworker: {
      findFirst: vi.fn().mockResolvedValue(null),
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
  const app = new OpenAPIHono<{ Variables: AuthVariables }>({
    defaultHook: defaultValidationHook,
  });

  app.use("*", async (c, next) => {
    c.set("isAuthenticated", true);
    c.set("authContext", authContext);
    return await next();
  });

  mountCreateConversation(app as unknown as OpenAPIHonoWithAuth);
  return app;
}

const delegatedCoworker: AuthVariables["authContext"] = {
  actor: "coworker",
  coworkerId: "cow_123",
  vendorId: TEST_VENDOR_ID,
  context: {
    userId: "delegated_user_123",
    organizationId: "delegated_org_123",
  },
};

function create(
  app: ReturnType<typeof createApp>,
  metadata?: Record<string, unknown>,
) {
  return app.request("http://localhost/", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      title: "New chat",
      ...(metadata ? { metadata } : {}),
    }),
  });
}

describe("POST /conversations", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    conversationFindFirstMock.mockResolvedValue(null);
    conversationCreateMock.mockImplementation(async ({ data }) => ({
      id: "550e8400-e29b-41d4-a716-446655440000",
      userId: data.userId,
      title: data.title,
      metadata: data.metadata,
      createdAt: new Date("2025-01-01T00:00:00.000Z"),
      updatedAt: new Date("2025-01-01T00:00:00.000Z"),
    }));
    prismaTransactionMock.mockImplementation(
      async (cb: (tx: unknown) => unknown) =>
        cb({
          conversation: {
            findFirst: conversationFindFirstMock,
            create: conversationCreateMock,
          },
        }),
    );
  });

  it("does not stamp a coworker binding for user sessions", async () => {
    const response = await create(createApp());

    expect(response.status).toBe(201);
    const data = conversationCreateMock.mock.calls[0]![0].data as {
      metadata: Record<string, unknown>;
    };
    expect(data.metadata.coworker_id).toBeUndefined();
    expect(data.metadata.userId).toBe("user_123");
  });

  it("returns 403 for coworker API keys (no X-Context-User-Id impersonation)", async () => {
    const response = await create(createApp(delegatedCoworker));

    expect(response.status).toBe(403);
    expect(conversationCreateMock).not.toHaveBeenCalled();
  });

  it("preserves a client coworker_slug for a user session", async () => {
    const response = await create(createApp(), {
      coworker_slug: "ops-agent",
    });

    expect(response.status).toBe(201);
    const data = conversationCreateMock.mock.calls[0]![0].data as {
      metadata: Record<string, unknown>;
    };
    expect(data.metadata.coworker_slug).toBe("ops-agent");
    expect(data.metadata.coworker_id).toBeUndefined();
  });
});
