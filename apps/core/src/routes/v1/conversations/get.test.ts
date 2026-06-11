import { OpenAPIHono } from "@hono/zod-openapi";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { OpenAPIHonoWithAuth } from "@/lib/hono";
import { defaultValidationHook } from "@/lib/hono";
import type { AuthVariables } from "@/middleware/auth";

import mountListConversations from "./get";

const { conversationFindManyMock } = vi.hoisted(() => ({
  conversationFindManyMock: vi.fn(),
}));

vi.mock("@/lib/db/prisma", () => ({
  default: {
    conversation: { findMany: conversationFindManyMock },
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

  mountListConversations(app as unknown as OpenAPIHonoWithAuth);
  return app;
}

function conversation(id: string, metadata: Record<string, unknown>) {
  return {
    id,
    userId: "user_123",
    title: "Chat",
    metadata,
    createdAt: new Date("2025-01-01T00:00:00.000Z"),
    updatedAt: new Date("2025-01-01T00:00:00.000Z"),
  };
}

const idA = "550e8400-e29b-41d4-a716-446655440001";
const idB = "550e8400-e29b-41d4-a716-446655440002";
const idC = "550e8400-e29b-41d4-a716-446655440003";

const delegatedCoworker: AuthVariables["authContext"] = {
  actor: "coworker",
  coworkerId: "cow_123",
  delegation: {
    userId: "delegated_user_123",
    organizationId: "delegated_org_123",
  },
};

describe("GET /conversations", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns every conversation for a user session", async () => {
    conversationFindManyMock.mockResolvedValueOnce([
      conversation(idA, { coworker_id: "cow_123" }),
      conversation(idB, { coworker_id: "cow_other" }),
      conversation(idC, { userId: "user_123" }),
    ]);

    const response = await createApp().request("http://localhost/");
    const body = (await response.json()) as { data: Array<{ id: string }> };

    expect(response.status).toBe(200);
    expect(body.data.map((c) => c.id)).toEqual([idA, idB, idC]);
  });

  it("filters to the delegated coworker's own conversations", async () => {
    conversationFindManyMock.mockResolvedValueOnce([
      conversation(idA, { coworker_id: "cow_123" }),
      conversation(idB, { coworker_id: "cow_other" }),
      conversation(idC, { userId: "user_123" }),
    ]);

    const response =
      await createApp(delegatedCoworker).request("http://localhost/");
    const body = (await response.json()) as { data: Array<{ id: string }> };

    expect(response.status).toBe(200);
    expect(body.data.map((c) => c.id)).toEqual([idA]);
  });
});
