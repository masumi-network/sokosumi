import { OpenAPIHono } from "@hono/zod-openapi";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { formatZodErrorMessage, unprocessableEntity } from "@/helpers/error";
import type { OpenAPIHonoWithAuth } from "@/lib/hono";
import type { AuthVariables } from "@/middleware/auth";

import mountGetCatalog from "./get";

const {
  agentFindManyMock,
  buildAgentSummariesMock,
  buildAvailableAgentWhereClauseMock,
  getAgentAuthorImageMock,
  getCreditCostsOrThrowMock,
  coworkerFindManyMock,
  prismaTransactionMock,
} = vi.hoisted(() => ({
  agentFindManyMock: vi.fn(),
  buildAgentSummariesMock: vi.fn(),
  buildAvailableAgentWhereClauseMock: vi.fn(),
  getAgentAuthorImageMock: vi.fn(),
  getCreditCostsOrThrowMock: vi.fn(),
  coworkerFindManyMock: vi.fn(),
  prismaTransactionMock: vi.fn(),
}));

vi.mock("@/helpers/agent", () => ({
  buildAvailableAgentWhereClause: buildAvailableAgentWhereClauseMock,
  getCreditCostsOrThrow: getCreditCostsOrThrowMock,
  getAgentAuthorImage: getAgentAuthorImageMock,
}));

vi.mock("@/helpers/agent-summary", () => ({
  buildAgentSummaries: buildAgentSummariesMock,
}));

vi.mock("@/lib/db/prisma", () => ({
  default: {
    $transaction: prismaTransactionMock,
    coworker: {
      findMany: coworkerFindManyMock,
    },
  },
}));

const agentRow = {
  id: "agent_123",
  tags: [{ name: "research" }, { name: "analysis" }],
  overrideTags: [],
  exampleOutput: [
    {
      name: "Sample",
      mimeType: "image/png",
      url: "https://example.com/output.png",
    },
  ],
  overrideExampleOutput: [],
};

const agentSummary = {
  id: "agent_123",
  createdAt: new Date("2026-03-17T10:00:00.000Z"),
  updatedAt: new Date("2026-03-17T10:00:00.000Z"),
  name: "Research Assistant",
  image: null,
  icon: null,
  credits: 100,
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
  riskClassification: "MINIMAL",
};

const coworkerRow = {
  id: "cow_123",
  createdAt: new Date("2026-03-17T10:00:00.000Z"),
  updatedAt: new Date("2026-03-17T10:00:00.000Z"),
  archivedAt: null,
  isWhitelisted: true,
  priority: 10,
  slug: "ops-agent",
  name: "Ops Agent",
  caption: null,
  company: null,
  companyLogo: null,
  url: null,
  baseURL: null,
  description: "Ops helper",
  capabilities: ["chat", "tasks"],
  image: null,
  metadata: null,
};

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

  mountGetCatalog(app as unknown as OpenAPIHonoWithAuth);
  return app;
}

describe("GET /catalog", () => {
  beforeEach(() => {
    vi.clearAllMocks();

    buildAvailableAgentWhereClauseMock.mockReturnValue({ isAvailable: true });
    getCreditCostsOrThrowMock.mockResolvedValue([]);
    getAgentAuthorImageMock.mockReturnValue(null);
    agentFindManyMock.mockResolvedValue([agentRow]);
    buildAgentSummariesMock.mockResolvedValue([agentSummary]);
    coworkerFindManyMock.mockResolvedValue([coworkerRow]);
    prismaTransactionMock.mockImplementation(async (callback) =>
      callback({ agent: { findMany: agentFindManyMock } }),
    );
  });

  it("returns all agents with detail metadata and coworkers in one response", async () => {
    const app = createApp();
    const response = await app.request("http://localhost/");
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.data.agents).toHaveLength(1);
    expect(body.data.agents[0]).toMatchObject({
      id: "agent_123",
      name: "Research Assistant",
      riskClassification: "MINIMAL",
      tags: ["research", "analysis"],
    });
    expect(body.data.agents[0].exampleOutputs[0]).toMatchObject({
      name: "Sample",
      mimeType: "image/png",
      url: "https://example.com/output.png",
    });
    expect(body.data.coworkers).toHaveLength(1);
    expect(body.data.coworkers[0]).toMatchObject({
      id: "cow_123",
      slug: "ops-agent",
      capabilities: ["chat", "tasks"],
    });
  });

  it("defaults coworkers to the whitelisted scope", async () => {
    const app = createApp();
    const response = await app.request("http://localhost/");

    expect(response.status).toBe(200);
    expect(coworkerFindManyMock).toHaveBeenCalledWith({
      where: { archivedAt: null, isWhitelisted: true },
      orderBy: [{ priority: "desc" }, { slug: "asc" }],
    });
  });

  it("returns all active coworkers when coworkerScope=all", async () => {
    const app = createApp();
    const response = await app.request("http://localhost/?coworkerScope=all");

    expect(response.status).toBe(200);
    expect(coworkerFindManyMock).toHaveBeenCalledWith({
      where: { archivedAt: null },
      orderBy: [{ priority: "desc" }, { slug: "asc" }],
    });
  });

  it("returns archived coworkers when coworkerScope=archived", async () => {
    const app = createApp();
    const response = await app.request(
      "http://localhost/?coworkerScope=archived",
    );

    expect(response.status).toBe(200);
    expect(coworkerFindManyMock).toHaveBeenCalledWith({
      where: { archivedAt: { not: null } },
      orderBy: [{ priority: "desc" }, { slug: "asc" }],
    });
  });

  it("rejects an invalid coworkerScope value", async () => {
    const app = createApp();
    const response = await app.request("http://localhost/?coworkerScope=bogus");

    expect(response.status).toBe(422);
    expect(coworkerFindManyMock).not.toHaveBeenCalled();
    expect(prismaTransactionMock).not.toHaveBeenCalled();
  });
});
