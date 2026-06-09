import { OpenAPIHono } from "@hono/zod-openapi";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { formatZodErrorMessage, unprocessableEntity } from "@/helpers/error";
import type { OpenAPIHonoWithAuth } from "@/lib/hono";
import type { AuthVariables } from "@/middleware/auth";

import mountDeleteFavoriteAgent from "./delete";

const { removeAgentFromFavoritesMock, prismaTransactionMock } = vi.hoisted(
  () => ({
    removeAgentFromFavoritesMock: vi.fn(),
    prismaTransactionMock: vi.fn(),
  }),
);

vi.mock("@/helpers/agent", () => ({
  removeAgentFromFavorites: removeAgentFromFavoritesMock,
}));

vi.mock("@/lib/db/prisma", () => ({
  default: {
    $transaction: prismaTransactionMock,
  },
}));

function createApp() {
  const app = new OpenAPIHono<{
    Variables: AuthVariables;
  }>({
    defaultHook: (result) => {
      if (!result.success && result.error) {
        throw unprocessableEntity(formatZodErrorMessage(result.error));
      }
    },
  });

  app.use("*", async (c, next) => {
    c.set("requestId", "test-req-id");
    c.set("isAuthenticated", true);
    c.set("authContext", {
      actor: "user",
      userId: "user_123",
      organizationId: null,
      role: "user",
    });
    return await next();
  });

  mountDeleteFavoriteAgent(app as unknown as OpenAPIHonoWithAuth);
  return app;
}

describe("DELETE /agents/favorites/{agentId}", () => {
  beforeEach(() => {
    vi.clearAllMocks();

    removeAgentFromFavoritesMock.mockResolvedValue(undefined);
    prismaTransactionMock.mockImplementation(async (callback) => {
      return await callback({});
    });
  });

  it("removes an agent from the caller's favorites", async () => {
    const app = createApp();
    const response = await app.request("http://localhost/favorites/agent_123", {
      method: "DELETE",
    });
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(removeAgentFromFavoritesMock).toHaveBeenCalledWith(
      "user_123",
      "agent_123",
      expect.anything(),
    );
    expect(body.data).toEqual({ agentId: "agent_123" });
  });
});
