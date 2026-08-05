import { OpenAPIHono } from "@hono/zod-openapi";
import { PricingType } from "@sokosumi/database";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { formatZodErrorMessage, unprocessableEntity } from "@/helpers/error";

import mountGetAgents from "./get";

const {
  agentCountMock,
  agentFindManyMock,
  buildAvailableAgentWhereClauseMock,
  calculateAgentRatingsMock,
  calculateAverageExecutionTimesMock,
  getAgentCostMock,
  getAgentAuthorImageMock,
  getAgentDescriptionMock,
  getAgentIconMock,
  getAgentImageMock,
  getAgentNameMock,
  getCreditCostsOrThrowMock,
  prismaTransactionMock,
} = vi.hoisted(() => ({
  agentCountMock: vi.fn(),
  agentFindManyMock: vi.fn(),
  buildAvailableAgentWhereClauseMock: vi.fn(),
  calculateAgentRatingsMock: vi.fn(),
  calculateAverageExecutionTimesMock: vi.fn(),
  getAgentCostMock: vi.fn(),
  getAgentAuthorImageMock: vi.fn(),
  getAgentDescriptionMock: vi.fn(),
  getAgentIconMock: vi.fn(),
  getAgentImageMock: vi.fn(),
  getAgentNameMock: vi.fn(),
  getCreditCostsOrThrowMock: vi.fn(),
  prismaTransactionMock: vi.fn(),
}));

vi.mock("@/helpers/agent", () => ({
  getCardanoV2ReadySources: () => Promise.resolve([]),
  buildAvailableAgentWhereClause: buildAvailableAgentWhereClauseMock,
  calculateAgentRatings: calculateAgentRatingsMock,
  calculateAverageExecutionTimes: calculateAverageExecutionTimesMock,
  getAgentCost: getAgentCostMock,
  getAgentAuthorImage: getAgentAuthorImageMock,
  getAgentDescription: getAgentDescriptionMock,
  getAgentIcon: getAgentIconMock,
  getAgentImage: getAgentImageMock,
  getAgentName: getAgentNameMock,
  getCreditCostsOrThrow: getCreditCostsOrThrowMock,
}));

vi.mock("@/lib/db/prisma", () => ({
  default: {
    agent: {
      findMany: agentFindManyMock,
      count: agentCountMock,
    },
    $transaction: prismaTransactionMock,
  },
}));

function createApp() {
  const app = new OpenAPIHono({
    defaultHook: (result) => {
      if (!result.success && result.error) {
        throw unprocessableEntity(formatZodErrorMessage(result.error));
      }
    },
  });

  app.use("*", async (c, next) => {
    c.set("requestId", "test-req-id");
    return await next();
  });

  mountGetAgents(app);
  return app;
}

describe("GET /agents", () => {
  beforeEach(() => {
    vi.clearAllMocks();

    buildAvailableAgentWhereClauseMock.mockReturnValue({
      isAvailable: true,
    });
    getCreditCostsOrThrowMock.mockResolvedValue([]);
    getAgentCostMock.mockReturnValue({ cents: BigInt(0) });
    getAgentAuthorImageMock.mockReturnValue(null);
    getAgentNameMock.mockImplementation((agent) => agent.name);
    getAgentDescriptionMock.mockImplementation((agent) => agent.description);
    getAgentImageMock.mockImplementation((agent) => agent.image);
    getAgentIconMock.mockImplementation((agent) => agent.icon);
    calculateAverageExecutionTimesMock.mockResolvedValue(
      new Map([["agent_123", 120]]),
    );
    calculateAgentRatingsMock.mockResolvedValue(
      new Map([["agent_123", { total: 3, average: 4.5 }]]),
    );
    agentFindManyMock.mockResolvedValue([
      {
        id: "agent_123",
        createdAt: new Date("2026-03-17T10:00:00.000Z"),
        updatedAt: new Date("2026-03-17T10:00:00.000Z"),
        name: "Research Assistant",
        description: "Finds information",
        image: null,
        icon: null,
        summary: "A short summary",
        riskClassification: "MINIMAL",
        pricing: {
          pricingType: PricingType.FREE,
          fixedPricing: null,
        },
        // main denormalised the popularity sort onto Agent.jobCount (#3642),
        // replacing the _count relation aggregate.
        jobCount: 2,
        categories: [
          {
            id: "cat_123",
            createdAt: new Date("2026-03-17T10:00:00.000Z"),
            updatedAt: new Date("2026-03-17T10:00:00.000Z"),
            name: "Research",
            slug: "research",
            description: "Agents for research tasks",
            image: null,
            icon: null,
            priority: 0,
            styles: JSON.stringify({
              light: {
                color: "text-default-foreground",
              },
            }),
          },
        ],
        overrideAuthorName: null,
        authorName: "Jane Doe",
        overrideAuthorImage: null,
        authorImage: null,
        overrideAuthorOrganization: null,
        authorOrganization: "Sokosumi",
        overrideAuthorContactEmail: null,
        authorContactEmail: "jane@example.com",
        overrideAuthorContactOther: null,
        authorContactOther: null,
        overrideLegalPrivacyPolicy: null,
        legalPrivacyPolicy: null,
        overrideLegalTerms: null,
        legalTerms: null,
        overrideLegalDpa: null,
        legalDpa: null,
        overrideLegalOther: null,
        legalOther: null,
      },
    ]);
    agentCountMock.mockResolvedValue(1);
  });

  it("lists agents without opening an interactive transaction", async () => {
    const app = createApp();
    const response = await app.request("http://localhost/");

    expect(response.status).toBe(200);
    expect(prismaTransactionMock).not.toHaveBeenCalled();
    expect(agentFindManyMock).toHaveBeenCalled();
    expect(agentCountMock).toHaveBeenCalled();
  });

  it("orders by jobCount without live jobs._count and skips average execution SQL", async () => {
    const app = createApp();
    const response = await app.request("http://localhost/");
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(agentFindManyMock).toHaveBeenCalledWith(
      expect.objectContaining({
        orderBy: [{ jobCount: "desc" }, { createdAt: "desc" }, { id: "desc" }],
      }),
    );
    const findManyArg = agentFindManyMock.mock.calls[0]?.[0] as {
      orderBy: unknown[];
      include?: Record<string, unknown>;
    };
    expect(JSON.stringify(findManyArg.orderBy)).not.toContain("_count");
    expect(findManyArg.include).not.toHaveProperty("_count");
    expect(calculateAverageExecutionTimesMock).not.toHaveBeenCalled();
    expect(body.data[0]?.metrics.executions).toMatchObject({
      count: 2,
      averageTime: null,
    });
    expect(body.data[0]?.metrics.ratings).toMatchObject({
      total: 3,
      average: 4.5,
    });
    expect(calculateAgentRatingsMock).toHaveBeenCalled();
  });

  it("filters by a single category slug and returns parsed category styles", async () => {
    const app = createApp();
    const response = await app.request("http://localhost/?category=research");
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(agentFindManyMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          AND: [
            { isAvailable: true },
            {
              categories: {
                some: {
                  slug: {
                    in: ["research"],
                  },
                },
              },
            },
          ],
        },
      }),
    );
    expect(body.data[0]?.categories[0]).toMatchObject({
      id: "cat_123",
      slug: "research",
      styles: {
        light: {
          color: "text-default-foreground",
        },
      },
    });
    expect(body.data[0]).not.toHaveProperty("riskClassification");
  });

  it("parses repeated and comma-separated category filters", async () => {
    const app = createApp();
    const response = await app.request(
      "http://localhost/?category=research,writing&category=research",
    );

    expect(response.status).toBe(200);
    expect(agentFindManyMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          AND: [
            { isAvailable: true },
            {
              categories: {
                some: {
                  slug: {
                    in: ["research", "writing"],
                  },
                },
              },
            },
          ],
        },
      }),
    );
  });

  it("matches uncategorized agents when category=uncategorized", async () => {
    const app = createApp();
    const response = await app.request(
      "http://localhost/?category=uncategorized",
    );

    expect(response.status).toBe(200);
    expect(agentFindManyMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          AND: [
            { isAvailable: true },
            {
              categories: {
                none: {},
              },
            },
          ],
        },
      }),
    );
  });

  it("combines uncategorized and database categories with OR semantics", async () => {
    const app = createApp();
    const response = await app.request(
      "http://localhost/?category=uncategorized&category=research",
    );

    expect(response.status).toBe(200);
    expect(agentFindManyMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          AND: [
            { isAvailable: true },
            {
              OR: [
                {
                  categories: {
                    none: {},
                  },
                },
                {
                  categories: {
                    some: {
                      slug: {
                        in: ["research"],
                      },
                    },
                  },
                },
              ],
            },
          ],
        },
      }),
    );
  });

  it("deduplicates uncategorized across repeated and comma-separated values", async () => {
    const app = createApp();
    const response = await app.request(
      "http://localhost/?category=uncategorized,research&category=uncategorized",
    );

    expect(response.status).toBe(200);
    expect(agentFindManyMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          AND: [
            { isAvailable: true },
            {
              OR: [
                {
                  categories: {
                    none: {},
                  },
                },
                {
                  categories: {
                    some: {
                      slug: {
                        in: ["research"],
                      },
                    },
                  },
                },
              ],
            },
          ],
        },
      }),
    );
  });

  it("does not treat default as an uncategorized alias", async () => {
    const app = createApp();
    const response = await app.request("http://localhost/?category=default");

    expect(response.status).toBe(200);
    expect(agentFindManyMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          AND: [
            { isAvailable: true },
            {
              categories: {
                some: {
                  slug: {
                    in: ["default"],
                  },
                },
              },
            },
          ],
        },
      }),
    );
  });

  it("rejects empty category values", async () => {
    const app = createApp();
    const response = await app.request("http://localhost/?category=research,");

    expect(response.status).toBe(422);
    expect(agentFindManyMock).not.toHaveBeenCalled();
    expect(agentCountMock).not.toHaveBeenCalled();
  });

  it("advances pagination from the consumed raw row when its summary is skipped", async () => {
    agentFindManyMock.mockResolvedValue([
      {
        id: "agent_unreadable",
        pricing: {
          pricingType: PricingType.FIXED,
          fixedPricing: { amounts: [] },
        },
      },
      { id: "agent_next_page" },
    ]);
    agentCountMock.mockResolvedValue(2);

    const app = createApp();
    const response = await app.request("http://localhost/?limit=1");
    const body = (await response.json()) as {
      data: unknown[];
      meta: { pagination: { nextCursor: string | null } };
    };

    expect(response.status).toBe(200);
    expect(body.data).toEqual([]);
    expect(body.meta.pagination.nextCursor).toBe("agent_unreadable");
    expect(getAgentCostMock).not.toHaveBeenCalled();
  });

  it("propagates unexpected pricing failures", async () => {
    const consoleErrorSpy = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);
    getAgentCostMock.mockImplementation(() => {
      throw new Error("unexpected pricing failure");
    });

    try {
      const app = createApp();
      const response = await app.request("http://localhost/");

      expect(response.status).toBe(500);
    } finally {
      consoleErrorSpy.mockRestore();
    }
  });
});
