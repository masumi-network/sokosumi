import { beforeEach, describe, expect, it, vi } from "vitest";

import { OpenAPIHonoWithAuth } from "@/lib/hono";

import mountGetAgentReviews from "./get";

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
  getAgentRatingDistributionMock,
  getCreditCostsOrThrowMock,
  getRecentAgentReviewsMock,
} = vi.hoisted(() => ({
  agentFindFirstMock: vi.fn(),
  buildAvailableAgentWhereClauseMock: vi.fn(),
  getAgentRatingDistributionMock: vi.fn(),
  getCreditCostsOrThrowMock: vi.fn(),
  getRecentAgentReviewsMock: vi.fn(),
}));

vi.mock("@/helpers/agent", () => ({
  getCardanoV2ReadySources: () => Promise.resolve([]),
  buildAvailableAgentWhereClause: buildAvailableAgentWhereClauseMock,
  getCreditCostsOrThrow: getCreditCostsOrThrowMock,
}));

vi.mock("@/helpers/agent-rating", () => ({
  getAgentRatingDistribution: getAgentRatingDistributionMock,
  getRecentAgentReviews: getRecentAgentReviewsMock,
}));

vi.mock("@/lib/db/prisma", () => ({
  default: {
    agent: {
      findFirst: agentFindFirstMock,
    },
  },
}));

function createApp() {
  const app = new OpenAPIHonoWithAuth();

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

  mountGetAgentReviews(app);
  return app;
}

describe("GET /agents/{id}/reviews", () => {
  beforeEach(() => {
    vi.clearAllMocks();

    buildAvailableAgentWhereClauseMock.mockReturnValue({
      isAvailable: true,
    });
    getCreditCostsOrThrowMock.mockResolvedValue([]);
    agentFindFirstMock.mockResolvedValue({ id: "agent_123" });
    getAgentRatingDistributionMock.mockResolvedValue({
      "1": 0,
      "2": 1,
      "3": 2,
      "4": 3,
      "5": 4,
    });
    getRecentAgentReviewsMock.mockResolvedValue([
      {
        id: "rating_123",
        rating: 5,
        comment: "Great results.",
        createdAt: new Date("2026-03-17T10:00:00.000Z"),
        updatedAt: new Date("2026-03-17T10:00:00.000Z"),
        user: {
          id: "user_123",
          name: "Jane Doe",
          image: "https://example.com/avatar.png",
        },
      },
    ]);
  });

  it("returns public review distribution and recent comments", async () => {
    const app = createApp();
    const response = await app.request("http://localhost/agent_123/reviews");
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(agentFindFirstMock).toHaveBeenCalledWith({
      where: {
        id: "agent_123",
        isAvailable: true,
      },
      select: {
        id: true,
      },
    });
    // Defaults to the recent-review limit with no offset.
    expect(getRecentAgentReviewsMock).toHaveBeenCalledWith(
      "agent_123",
      10,
      expect.anything(),
      0,
    );
    expect(body.data).toEqual({
      distribution: {
        "1": 0,
        "2": 1,
        "3": 2,
        "4": 3,
        "5": 4,
      },
      ratingsWithComments: [
        {
          id: "rating_123",
          rating: 5,
          comment: "Great results.",
          createdAt: "2026-03-17T10:00:00.000Z",
          updatedAt: "2026-03-17T10:00:00.000Z",
          user: {
            id: "user_123",
            name: "Jane Doe",
            image: "https://example.com/avatar.png",
          },
        },
      ],
    });
  });

  it("forwards limit and offset query params to the review reader", async () => {
    const app = createApp();
    const response = await app.request(
      "http://localhost/agent_123/reviews?limit=5&offset=10",
    );

    expect(response.status).toBe(200);
    expect(getRecentAgentReviewsMock).toHaveBeenCalledWith(
      "agent_123",
      5,
      expect.anything(),
      10,
    );
  });
});
