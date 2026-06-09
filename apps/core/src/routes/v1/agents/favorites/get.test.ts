import { OpenAPIHono } from "@hono/zod-openapi";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { formatZodErrorMessage, unprocessableEntity } from "@/helpers/error";
import type { OpenAPIHonoWithAuth } from "@/lib/hono";
import type { AuthVariables } from "@/middleware/auth";

import mountGetFavoriteAgents from "./get";

const {
  agentFindManyMock,
  buildAgentSummariesMock,
  buildAvailableAgentWhereClauseMock,
  getCreditCostsOrThrowMock,
  prismaTransactionMock,
} = vi.hoisted(() => ({
  agentFindManyMock: vi.fn(),
  buildAgentSummariesMock: vi.fn(),
  buildAvailableAgentWhereClauseMock: vi.fn(),
  getCreditCostsOrThrowMock: vi.fn(),
  prismaTransactionMock: vi.fn(),
}));

vi.mock("@/helpers/agent", () => ({
  buildAvailableAgentWhereClause: buildAvailableAgentWhereClauseMock,
  getCreditCostsOrThrow: getCreditCostsOrThrowMock,
}));

vi.mock("@/helpers/agent-summary", () => ({
  buildAgentSummaries: buildAgentSummariesMock,
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

  mountGetFavoriteAgents(app as unknown as OpenAPIHonoWithAuth);
  return app;
}

const SUMMARY = {
  id: "agent_123",
  createdAt: new Date("2026-03-17T10:00:00.000Z"),
  updatedAt: new Date("2026-03-17T10:00:00.000Z"),
  name: "Research Assistant",
  image: null,
  icon: null,
  credits: 5,
  summary: "A short summary",
  description: "Finds information",
  metrics: {
    executions: { count: 2, averageTime: 120 },
    ratings: { total: 3, average: 4.5 },
  },
  author: {
    name: "Jane Doe",
    image: null,
    organization: "Sokosumi",
    email: "jane@example.com",
    other: null,
  },
  legal: { privacyPolicy: null, terms: null, dpa: null, other: null },
  categories: [],
};

describe("GET /agents/favorites", () => {
  beforeEach(() => {
    vi.clearAllMocks();

    buildAvailableAgentWhereClauseMock.mockReturnValue({ isAvailable: true });
    getCreditCostsOrThrowMock.mockResolvedValue([]);
    agentFindManyMock.mockResolvedValue([{ id: "agent_123" }]);
    buildAgentSummariesMock.mockResolvedValue([SUMMARY]);
    prismaTransactionMock.mockImplementation(async (callback) => {
      return await callback({
        agent: {
          findMany: agentFindManyMock,
        },
      });
    });
  });

  it("returns the caller's availability-filtered favorite agents", async () => {
    const app = createApp();
    const response = await app.request("http://localhost/favorites");
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(agentFindManyMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          AND: [
            { isAvailable: true },
            {
              agentLists: {
                some: {
                  userId: "user_123",
                  type: "FAVORITE",
                },
              },
            },
          ],
        },
      }),
    );
    expect(body.data).toHaveLength(1);
    expect(body.data[0]?.id).toBe("agent_123");
  });

  it("returns an empty list when the caller has no favorites", async () => {
    agentFindManyMock.mockResolvedValue([]);
    buildAgentSummariesMock.mockResolvedValue([]);

    const app = createApp();
    const response = await app.request("http://localhost/favorites");
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.data).toEqual([]);
  });
});
