import { beforeEach, describe, expect, it, vi } from "vitest";

import { OpenAPIHonoWithAuth } from "@/lib/hono";
import type { AuthVariables } from "@/middleware/auth";

import mountGetMyAgentReview from "./get";

vi.mock("@/middleware/auth", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/middleware/auth")>();
  const { stubAuthMiddleware } = await import(
    "@/test-fixtures/auth-middleware"
  );
  return { ...actual, authMiddleware: stubAuthMiddleware };
});

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
  const app = new OpenAPIHonoWithAuth();

  app.use("*", async (c, next) => {
    c.set("requestId", "test-req-id");
    c.set("isAuthenticated", true);
    c.set("authContext", authContext);
    return await next();
  });

  mountGetMyAgentReview(app);
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
});
