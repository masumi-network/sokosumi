import { OpenAPIHono } from "@hono/zod-openapi";
import type { RequestIdVariables } from "hono/request-id";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { errorHandler } from "@/helpers/error-handler";
import { defaultValidationHook, type OpenAPIHonoWithAuth } from "@/lib/hono";
import type { AuthVariables } from "@/middleware/auth";

const { prismaTransactionMock } = vi.hoisted(() => ({
  prismaTransactionMock: vi.fn(),
}));

vi.mock("@/lib/db/prisma", () => ({
  default: {
    $transaction: prismaTransactionMock,
  },
}));

const { default: mountGetChatRoom } = await import("./[id]/get");
const { default: mountPatchChatRoom } = await import("./[id]/patch");

const ROOM_ID = "550e8400-e29b-41d4-a716-446655440000";
const USER_ID = "user_123";
const ORG_ID = "org_1";

const userAuthContext: AuthVariables["authContext"] = {
  actor: "user",
  userId: USER_ID,
  organizationId: ORG_ID,
  role: "user",
};

const coworkerAuthContext: AuthVariables["authContext"] = {
  actor: "coworker",
  coworkerId: "cow_123",
  vendorId: "01960001-0001-7001-8001-000000000001",
  context: { userId: USER_ID, organizationId: ORG_ID },
};

const orchestratorAuthContext: AuthVariables["authContext"] = {
  actor: "orchestrator",
  context: { userId: USER_ID, organizationId: ORG_ID },
};

function createApp(authContext: AuthVariables["authContext"]) {
  const app = new OpenAPIHono<{
    Variables: AuthVariables & RequestIdVariables;
  }>({
    defaultHook: defaultValidationHook,
  });

  app.use("*", async (c, next) => {
    c.set("requestId", "req_chat_rooms_auth");
    c.set("isAuthenticated", true);
    c.set("authContext", authContext);
    await next();
  });

  app.onError(errorHandler);
  mountGetChatRoom(app as unknown as OpenAPIHonoWithAuth);
  mountPatchChatRoom(app as unknown as OpenAPIHonoWithAuth);
  return app;
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("chat room session auth guards", () => {
  it.each([
    ["coworker", coworkerAuthContext],
    ["orchestrator", orchestratorAuthContext],
  ] as const)(
    "rejects %s actor on GET /{id} with 403",
    async (_label, auth) => {
      const response = await createApp(auth).request(`/${ROOM_ID}`);

      expect(response.status).toBe(403);
      expect(prismaTransactionMock).not.toHaveBeenCalled();
    },
  );

  it.each([
    ["coworker", coworkerAuthContext],
    ["orchestrator", orchestratorAuthContext],
  ] as const)(
    "rejects %s actor on PATCH /{id} with 403",
    async (_label, auth) => {
      const response = await createApp(auth).request(`/${ROOM_ID}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name: "Renamed" }),
      });

      expect(response.status).toBe(403);
      expect(prismaTransactionMock).not.toHaveBeenCalled();
    },
  );

  it("allows session user past the auth gate on GET /{id}", async () => {
    prismaTransactionMock.mockResolvedValueOnce({
      room: {
        id: ROOM_ID,
        organizationId: ORG_ID,
        name: "general",
        slug: "general",
        kind: "channel",
        directKey: null,
        topic: null,
        createdByUserId: USER_ID,
        createdAt: new Date("2025-01-01T00:00:00.000Z"),
        updatedAt: new Date("2025-01-01T00:00:00.000Z"),
        archivedAt: null,
        userMembers: [
          {
            user: {
              id: USER_ID,
              name: "Ada",
              email: "ada@example.com",
              image: null,
              sessions: [],
            },
          },
        ],
        coworkerMembers: [],
      },
      unreadCounts: new Map([[ROOM_ID, 0]]),
    });

    const response = await createApp(userAuthContext).request(`/${ROOM_ID}`);

    expect(response.status).toBe(200);
    expect(prismaTransactionMock).toHaveBeenCalled();
  });
});
