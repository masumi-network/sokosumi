import { OpenAPIHono } from "@hono/zod-openapi";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  formatZodErrorMessage,
  notFound,
  unprocessableEntity,
} from "@/helpers/error";
import type { OpenAPIHonoWithAuth } from "@/lib/hono";
import type { AuthVariables } from "@/middleware/auth";

import mountPostFavoriteAgent from "./post";

const {
  addAgentToFavoritesMock,
  requireAvailableAgentOrThrowMock,
  prismaTransactionMock,
} = vi.hoisted(() => ({
  addAgentToFavoritesMock: vi.fn(),
  requireAvailableAgentOrThrowMock: vi.fn(),
  prismaTransactionMock: vi.fn(),
}));

vi.mock("@/helpers/agent", () => ({
  addAgentToFavorites: addAgentToFavoritesMock,
  requireAvailableAgentOrThrow: requireAvailableAgentOrThrowMock,
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

  mountPostFavoriteAgent(app as unknown as OpenAPIHonoWithAuth);
  return app;
}

function postFavorite(agentId: unknown) {
  return new Request("http://localhost/favorites", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ agentId }),
  });
}

describe("POST /agents/favorites", () => {
  beforeEach(() => {
    vi.clearAllMocks();

    requireAvailableAgentOrThrowMock.mockResolvedValue(undefined);
    addAgentToFavoritesMock.mockResolvedValue(undefined);
    prismaTransactionMock.mockImplementation(async (callback) => {
      return await callback({});
    });
  });

  it("adds an available agent to the caller's favorites", async () => {
    const app = createApp();
    const response = await app.request(postFavorite("agent_123"));
    const body = await response.json();

    expect(response.status).toBe(201);
    expect(requireAvailableAgentOrThrowMock).toHaveBeenCalledWith(
      "agent_123",
      expect.anything(),
    );
    expect(addAgentToFavoritesMock).toHaveBeenCalledWith(
      "user_123",
      "agent_123",
      expect.anything(),
    );
    expect(body.data).toEqual({ agentId: "agent_123" });
  });

  it("returns 404 when the agent is not available", async () => {
    requireAvailableAgentOrThrowMock.mockRejectedValue(
      notFound("Agent not found"),
    );

    const app = createApp();
    const response = await app.request(postFavorite("agent_123"));

    expect(response.status).toBe(404);
    expect(addAgentToFavoritesMock).not.toHaveBeenCalled();
  });
});
