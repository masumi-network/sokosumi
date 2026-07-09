import { OpenAPIHono } from "@hono/zod-openapi";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { OpenAPIHonoWithAuth } from "@/lib/hono";
import { defaultValidationHook } from "@/lib/hono";
import type { AuthVariables } from "@/middleware/auth";
import { TEST_VENDOR_ID } from "@/test-fixtures/vendor.js";

import mountGetConversation from "./get";

const {
  conversationFindFirstMock,
  coworkerFindFirstMock,
  prismaTransactionMock,
} = vi.hoisted(() => ({
  conversationFindFirstMock: vi.fn(),
  coworkerFindFirstMock: vi.fn(),
  prismaTransactionMock: vi.fn(),
}));

vi.mock("@/lib/db/prisma", () => ({
  default: {
    $transaction: prismaTransactionMock,
    conversation: { findFirst: conversationFindFirstMock },
    coworker: { findFirst: coworkerFindFirstMock },
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

  mountGetConversation(app as unknown as OpenAPIHonoWithAuth);
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

const delegatedCoworker: AuthVariables["authContext"] = {
  actor: "coworker",
  coworkerId: "cow_123",
  vendorId: TEST_VENDOR_ID,
  delegation: {
    userId: "delegated_user_123",
    organizationId: "delegated_org_123",
  },
};

describe("GET /conversations/{id}", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    prismaTransactionMock.mockImplementation(
      async (cb: (tx: unknown) => unknown) =>
        cb({
          conversation: { findFirst: conversationFindFirstMock },
          coworker: { findFirst: coworkerFindFirstMock },
        }),
    );
  });

  it("returns 404 when the conversation is missing", async () => {
    conversationFindFirstMock.mockResolvedValueOnce(null);

    const response = await createApp().request(`http://localhost/${cid}`);

    expect(response.status).toBe(404);
  });

  it("returns the conversation for the owning user", async () => {
    conversationFindFirstMock.mockResolvedValueOnce(
      conversation({ userId: "user_123" }),
    );

    const response = await createApp().request(`http://localhost/${cid}`);

    expect(response.status).toBe(200);
  });

  it("allows a delegated coworker on its own conversation", async () => {
    conversationFindFirstMock.mockResolvedValueOnce(
      conversation({ coworker_id: "cow_123" }),
    );

    const response = await createApp(delegatedCoworker).request(
      `http://localhost/${cid}`,
    );

    expect(response.status).toBe(200);
  });

  it("rejects a delegated coworker on another coworker's conversation", async () => {
    conversationFindFirstMock.mockResolvedValueOnce(
      conversation({ coworker_id: "cow_other" }),
    );

    const response = await createApp(delegatedCoworker).request(
      `http://localhost/${cid}`,
    );

    expect(response.status).toBe(403);
  });
});
