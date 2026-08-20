import { OpenAPIHono } from "@hono/zod-openapi";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { formatZodErrorMessage, unprocessableEntity } from "@/helpers/error";
import type { OpenAPIHonoWithAuth } from "@/lib/hono";
import type { AuthVariables } from "@/middleware/auth";

import mountGetMyAgentReview from "./get";

const {
  agentFindFirstMock,
  buildAvailableAgentWhereClauseMock,
  getCreditCostsOrThrowMock,
  getUserAgentReviewMock,
  prismaTransactionMock,
} = vi.hoisted(() => ({
  agentFindFirstMock: vi.fn(),
  buildAvailableAgentWhereClauseMock: vi.fn(),
  getCreditCostsOrThrowMock: vi.fn(),
  getUserAgentReviewMock: vi.fn(),
  prismaTransactionMock: vi.fn(),
}));

vi.mock("@/helpers/agent", () => ({
  getCardanoV2ReadySources: () => Promise.resolve([]),
  buildAvailableAgentWhereClause: buildAvailableAgentWhereClauseMock,
  getCreditCostsOrThrow: getCreditCostsOrThrowMock,
}));

vi.mock("@/helpers/agent-rating", () => ({
  getUserAgentReview: getUserAgentReviewMock,
}));

vi.mock("@/lib/db/prisma", () => ({
  default: {
    $transaction: prismaTransactionMock,
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
    defaultHook: (result) => {
      if (!result.success && result.error) {
        throw unprocessableEntity(formatZodErrorMessage(result.error));
      }
    },
  });

  app.use("*", async (c, next) => {
    c.set("requestId", "test-req-id");
    c.set("isAuthenticated", true);
    c.set("authContext", authContext);
    return await next();
  });

  mountGetMyAgentReview(app as unknown as OpenAPIHonoWithAuth);
  return app;
}

describe("GET /agents/{id}/reviews/me", () => {
  beforeEach(() => {
    vi.clearAllMocks();

    buildAvailableAgentWhereClauseMock.mockReturnValue({
      isAvailable: true,
    });
    getCreditCostsOrThrowMock.mockResolvedValue([]);
    agentFindFirstMock.mockResolvedValue({ id: "agent_123" });
    prismaTransactionMock.mockImplementation(async (callback) => {
      return await callback({
        agent: {
          findFirst: agentFindFirstMock,
        },
      });
    });
  });

  it("returns the caller's own review for the agent", async () => {
    getUserAgentReviewMock.mockResolvedValue({
      id: "rating_123",
      rating: 4,
      comment: "Solid output.",
    });

    const app = createApp();
    const response = await app.request("http://localhost/agent_123/reviews/me");
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(getUserAgentReviewMock).toHaveBeenCalledWith(
      "agent_123",
      "user_123",
      expect.anything(),
    );
    expect(body.data).toEqual({
      id: "rating_123",
      rating: 4,
      comment: "Solid output.",
    });
  });

  it("returns null when the caller has not rated the agent", async () => {
    getUserAgentReviewMock.mockResolvedValue(null);

    const app = createApp();
    const response = await app.request("http://localhost/agent_123/reviews/me");
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.data).toBeNull();
  });

  it("returns 404 when the agent is not available", async () => {
    agentFindFirstMock.mockResolvedValue(null);

    const app = createApp();
    const response = await app.request("http://localhost/agent_123/reviews/me");

    expect(response.status).toBe(404);
    expect(getUserAgentReviewMock).not.toHaveBeenCalled();
  });

  it("allows orchestrator with context headers as the context user", async () => {
    getUserAgentReviewMock.mockResolvedValue({
      id: "rating_123",
      rating: 4,
      comment: "Solid output.",
    });

    const app = createApp({
      actor: "orchestrator",
      orchestratorId: "orch_123",
      context: { userId: "user_123", organizationId: null },
    });
    const response = await app.request("http://localhost/agent_123/reviews/me");
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(getUserAgentReviewMock).toHaveBeenCalledWith(
      "agent_123",
      "user_123",
      expect.anything(),
    );
    expect(body.data).toEqual({
      id: "rating_123",
      rating: 4,
      comment: "Solid output.",
    });
  });

  it("returns 403 for bare orchestrator without context headers", async () => {
    const app = createApp({
      actor: "orchestrator",
      orchestratorId: "orch_123",
    });
    const response = await app.request("http://localhost/agent_123/reviews/me");

    expect(response.status).toBe(403);
    expect(getUserAgentReviewMock).not.toHaveBeenCalled();
  });
});
