import { OpenAPIHono } from "@hono/zod-openapi";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { OpenAPIHonoWithAuth } from "@/lib/hono";
import { defaultValidationHook } from "@/lib/hono";
import type { AuthVariables } from "@/middleware/auth";

import mountPatchConversation from "./patch";

const {
  conversationFindFirstMock,
  conversationUpdateMock,
  coworkerFindFirstMock,
  prismaTransactionMock,
} = vi.hoisted(() => ({
  conversationFindFirstMock: vi.fn(),
  conversationUpdateMock: vi.fn(),
  coworkerFindFirstMock: vi.fn(),
  prismaTransactionMock: vi.fn(),
}));

vi.mock("@/lib/db/prisma", () => ({
  default: {
    $transaction: prismaTransactionMock,
    conversation: {
      findFirst: conversationFindFirstMock,
      update: conversationUpdateMock,
    },
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

  mountPatchConversation(app as unknown as OpenAPIHonoWithAuth);
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
  delegation: {
    userId: "delegated_user_123",
    organizationId: "delegated_org_123",
  },
};

function patch(app: ReturnType<typeof createApp>) {
  return app.request(`http://localhost/${cid}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ title: "Renamed" }),
  });
}

describe("PATCH /conversations/{id}", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    conversationUpdateMock.mockImplementation(async () =>
      conversation({ coworker_id: "cow_123" }),
    );
    prismaTransactionMock.mockImplementation(
      async (cb: (tx: unknown) => unknown) =>
        cb({
          conversation: {
            findFirst: conversationFindFirstMock,
            update: conversationUpdateMock,
          },
          coworker: { findFirst: coworkerFindFirstMock },
        }),
    );
  });

  it("returns 404 when the conversation is missing", async () => {
    conversationFindFirstMock.mockResolvedValueOnce(null);

    expect((await patch(createApp())).status).toBe(404);
    expect(conversationUpdateMock).not.toHaveBeenCalled();
  });

  it("updates the conversation for the owning user", async () => {
    conversationFindFirstMock.mockResolvedValueOnce(
      conversation({ userId: "user_123" }),
    );

    expect((await patch(createApp())).status).toBe(200);
    expect(conversationUpdateMock).toHaveBeenCalled();
  });

  it("allows a delegated coworker on its own conversation", async () => {
    conversationFindFirstMock.mockResolvedValueOnce(
      conversation({ coworker_id: "cow_123" }),
    );

    expect((await patch(createApp(delegatedCoworker))).status).toBe(200);
  });

  it("rejects a delegated coworker on another coworker's conversation", async () => {
    conversationFindFirstMock.mockResolvedValueOnce(
      conversation({ coworker_id: "cow_other" }),
    );

    expect((await patch(createApp(delegatedCoworker))).status).toBe(403);
    expect(conversationUpdateMock).not.toHaveBeenCalled();
  });

  it("re-pins the coworker binding so a coworker cannot rebind its conversation", async () => {
    conversationFindFirstMock.mockResolvedValueOnce(
      conversation({ coworker_id: "cow_123" }),
    );

    const response = await createApp(delegatedCoworker).request(
      `http://localhost/${cid}`,
      {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ metadata: { coworker_id: "cow_other" } }),
      },
    );

    expect(response.status).toBe(200);
    const data = conversationUpdateMock.mock.calls[0]![0].data as {
      metadata: Record<string, unknown>;
    };
    expect(data.metadata.coworker_id).toBe("cow_123");
  });
});
