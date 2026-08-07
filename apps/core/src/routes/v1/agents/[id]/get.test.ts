import { OpenAPIHono } from "@hono/zod-openapi";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { formatZodErrorMessage, unprocessableEntity } from "@/helpers/error";
import type { OpenAPIHonoWithAuth } from "@/lib/hono";
import type { AuthVariables } from "@/middleware/auth";

import mountGetAgentById from "./get";

const {
  buildAvailableAgentWhereClauseMock,
  calculateAgentRatingMock,
  calculateAverageExecutionTimeMock,
  getAgentCostMock,
  getAgentAuthorImageMock,
  getAgentDescriptionMock,
  getAgentIconMock,
  getAgentImageMock,
  getAgentNameMock,
  getCreditCostsOrThrowMock,
  prismaTransactionMock,
  agentFindFirstMock,
} = vi.hoisted(() => ({
  buildAvailableAgentWhereClauseMock: vi.fn(),
  calculateAgentRatingMock: vi.fn(),
  calculateAverageExecutionTimeMock: vi.fn(),
  getAgentCostMock: vi.fn(),
  getAgentAuthorImageMock: vi.fn(),
  getAgentDescriptionMock: vi.fn(),
  getAgentIconMock: vi.fn(),
  getAgentImageMock: vi.fn(),
  getAgentNameMock: vi.fn(),
  getCreditCostsOrThrowMock: vi.fn(),
  prismaTransactionMock: vi.fn(),
  agentFindFirstMock: vi.fn(),
}));

vi.mock("@/helpers/agent", () => ({
  AGENT_PRICING_READ_TRANSACTION_OPTIONS: { isolationLevel: "RepeatableRead" },
  getCardanoV2ReadySources: () => Promise.resolve([]),
  buildAvailableAgentWhereClause: buildAvailableAgentWhereClauseMock,
  calculateAgentRating: calculateAgentRatingMock,
  calculateAverageExecutionTime: calculateAverageExecutionTimeMock,
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

  mountGetAgentById(app as unknown as OpenAPIHonoWithAuth);
  return app;
}

describe("GET /agents/{id}", () => {
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
    calculateAverageExecutionTimeMock.mockResolvedValue(120);
    calculateAgentRatingMock.mockResolvedValue({
      total: 3,
      average: 4.5,
    });
    agentFindFirstMock.mockResolvedValue({
      id: "agent_123",
      createdAt: new Date("2026-03-17T10:00:00.000Z"),
      updatedAt: new Date("2026-03-17T10:00:00.000Z"),
      name: "Research Assistant",
      description: "Finds information",
      image: null,
      icon: null,
      summary: "A short summary",
      riskClassification: "HIGH",
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
            dark: {
              color: "text-white",
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
      tags: [
        {
          id: "tag_123",
          createdAt: new Date("2026-03-17T10:00:00.000Z"),
          updatedAt: new Date("2026-03-17T10:00:00.000Z"),
          name: "research",
        },
      ],
      metadataOverride: {
        tags: [],
        exampleOutputs: [],
      },
      exampleOutput: [
        {
          id: "example_123",
          createdAt: new Date("2026-03-17T10:00:00.000Z"),
          updatedAt: new Date("2026-03-17T10:00:00.000Z"),
          name: "Generated summary",
          mimeType: "image/png",
          url: "https://example.com/output.png",
          agentId: "agent_123",
          metadataOverrideId: null,
        },
      ],
    });
    prismaTransactionMock.mockImplementation(async (callback) => {
      return await callback({
        agent: {
          findFirst: agentFindFirstMock,
        },
      });
    });
  });

  it("returns parsed category styles in the detail response", async () => {
    const app = createApp();
    const response = await app.request("http://localhost/agent_123");
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.data.categories[0]).toMatchObject({
      id: "cat_123",
      slug: "research",
      styles: {
        dark: {
          color: "text-white",
        },
      },
    });
    expect(body.data.riskClassification).toBe("HIGH");
    expect(body.data.tags).toEqual(["research"]);
    expect(body.data.exampleOutputs).toEqual([
      {
        name: "Generated summary",
        mimeType: "image/png",
        url: "https://example.com/output.png",
      },
    ]);
  });
});
