import type { Agent } from "@sokosumi/database";
import { RiskClassification } from "@sokosumi/database";
import { describe, expect, it } from "vitest";

import {
  agentDetailSchema,
  agentLegalSchema,
  agentListItemSchema,
  agentListSchema,
  agentSummarySchema,
  getAgentExampleOutputsFromAgent,
  getAgentLegalFromAgent,
  getAgentTagsFromAgent,
} from "./agent.schema";

function createMockAgent(
  overrides: Partial<Agent> & {
    metadataOverride?: {
      legalDpa?: string | null;
      description?: string | null;
      name?: string | null;
    } | null;
  } = {},
) {
  const now = new Date();
  const { metadataOverride, ...agentOverrides } = overrides;

  return {
    id: `agent-${Math.random().toString(36).substring(7)}`,
    createdAt: now,
    updatedAt: now,
    blockchainIdentifier: `blockchain-${Math.random().toString(36).substring(7)}`,
    name: "Test Agent",
    description: "Test description",
    apiBaseUrl: "https://api.example.com",
    capabilityName: "test-capability",
    capabilityVersion: "1.0.0",
    authorName: "Test Author",
    authorImage: null,
    authorContactEmail: null,
    authorContactOther: null,
    authorOrganization: null,
    legalPrivacyPolicy: null,
    legalDpa: null,
    legalTerms: null,
    legalOther: null,
    lastUptimeCheck: now,
    uptimeCount: 100,
    uptimeCheckCount: 100,
    image: "https://example.com/image.png",
    icon: null,
    metadataVersion: 1,
    paymentType: "WEB3_CARDANO_V1",
    pricingId: "pricing-1",
    status: "ONLINE",
    isShown: true,
    riskClassification: "MINIMAL",
    summary: null,
    metadataOverride: metadataOverride ?? null,
    ...agentOverrides,
  };
}

describe("agentLegalSchema", () => {
  it("includes a nullable dpa field", () => {
    expect(
      agentLegalSchema.parse({
        privacyPolicy: null,
        terms: null,
        dpa: "https://example.com/dpa.pdf",
        other: null,
      }),
    ).toEqual({
      privacyPolicy: null,
      terms: null,
      dpa: "https://example.com/dpa.pdf",
      other: null,
    });
  });
});

describe("getAgentLegalFromAgent", () => {
  it("returns DPA from the override value when present", () => {
    expect(
      getAgentLegalFromAgent(
        createMockAgent({
          legalDpa: "https://example.com/dpa.pdf",
          metadataOverride: {
            legalDpa: "https://example.com/override-dpa.pdf",
          },
        }),
      ),
    ).toEqual({
      privacyPolicy: null,
      terms: null,
      dpa: "https://example.com/override-dpa.pdf",
      other: null,
    });
  });
});

const baseAgentResponse = {
  id: "agent_123",
  createdAt: new Date("2026-03-17T10:00:00.000Z"),
  updatedAt: new Date("2026-03-17T10:00:00.000Z"),
  name: "Research Assistant",
  image: null,
  icon: null,
  credits: 10,
  summary: "Helpful summary",
  description: "Detailed description",
  metrics: {
    executions: {
      count: 2,
      averageTime: 120,
    },
    ratings: {
      total: 3,
      average: 4.5,
    },
  },
  author: {
    name: "Jane Doe",
    image: null,
    organization: "Sokosumi",
    email: "jane@example.com",
    other: null,
  },
  legal: {
    privacyPolicy: null,
    terms: null,
    dpa: null,
    other: null,
  },
  categories: [],
};

describe("agent response schemas", () => {
  it("keeps detail-only fields out of the summary schema", () => {
    const parsed = agentSummarySchema.parse({
      ...baseAgentResponse,
      riskClassification: RiskClassification.MINIMAL,
      tags: ["research"],
      exampleOutputs: [
        {
          name: "Sample output",
          mimeType: "image/png",
          url: "https://example.com/output.png",
        },
      ],
    });

    expect(parsed).not.toHaveProperty("riskClassification");
    expect(parsed).not.toHaveProperty("tags");
    expect(parsed).not.toHaveProperty("exampleOutputs");
  });

  it("includes detail-only fields in the detail schema", () => {
    expect(
      agentDetailSchema.parse({
        ...baseAgentResponse,
        riskClassification: RiskClassification.HIGH,
        tags: ["research", "analysis"],
        exampleOutputs: [
          {
            name: "Sample output",
            mimeType: "image/png",
            url: "https://example.com/output.png",
          },
        ],
      }),
    ).toMatchObject({
      riskClassification: RiskClassification.HIGH,
      tags: ["research", "analysis"],
      exampleOutputs: [
        {
          name: "Sample output",
          mimeType: "image/png",
          url: "https://example.com/output.png",
        },
      ],
    });
  });
});

describe("getAgentTagsFromAgent", () => {
  it("prefers override tags when present", () => {
    const agent = {
      tags: [{ name: "base-tag" }],
      metadataOverride: {
        tags: [{ name: "override-tag" }],
      },
    };

    expect(getAgentTagsFromAgent(agent)).toEqual(["override-tag"]);
  });

  it("falls back to default tags when overrides are absent", () => {
    const agent = {
      tags: [{ name: "base-tag" }],
      metadataOverride: {
        tags: [],
      },
    };

    expect(getAgentTagsFromAgent(agent)).toEqual(["base-tag"]);
  });
});

describe("getAgentExampleOutputsFromAgent", () => {
  it("prefers override example outputs when present", () => {
    const agent = {
      exampleOutput: [
        {
          name: "Base output",
          mimeType: "image/png",
          url: "https://example.com/base.png",
        },
      ],
      metadataOverride: {
        exampleOutputs: [
          {
            name: "Override output",
            mimeType: "image/png",
            url: "https://example.com/override.png",
          },
        ],
      },
    };

    expect(getAgentExampleOutputsFromAgent(agent)).toEqual([
      {
        name: "Override output",
        mimeType: "image/png",
        url: "https://example.com/override.png",
      },
    ]);
  });
});

function cardanoListItem() {
  return {
    kind: "cardano" as const,
    id: "agent_cardano_1",
    createdAt: "2026-03-17T10:00:00.000Z",
    updatedAt: "2026-03-17T10:00:00.000Z",
    name: "Research Assistant",
    image: null,
    icon: null,
    credits: 0,
    summary: null,
    description: "Finds information",
    metrics: {
      executions: { count: 0, averageTime: null },
      ratings: { total: 0, average: null },
    },
    author: {
      name: "Jane Doe",
      image: null,
      organization: null,
      email: null,
      other: null,
    },
    legal: {
      privacyPolicy: null,
      terms: null,
      dpa: null,
      other: null,
    },
    categories: [],
  };
}

function x402ListItem() {
  return {
    kind: "x402" as const,
    id: "agent_x402_1",
    specification: "bazaar" as const,
    name: "Bazaar Research Agent",
    description: null,
    image: null,
    x402ResourcesUrl: "https://agent.example.com/.well-known/x402",
    openApiSpecUrl: null,
    pricingType: "fixed" as const,
    isPayable: true as const,
    paymentSources: [
      {
        caip2Network: "eip155:84532",
        asset: "0x036cbd53842c5426634e7929541ec2318f3dcf7e",
        decimals: 6,
        payTo: "0x1111111111111111111111111111111111111111",
        amount: "250000",
        credits: 0.5,
      },
    ],
  };
}

describe("agentListItemSchema", () => {
  it("discriminates a mixed catalog page on kind", () => {
    const parsed = agentListSchema.parse([cardanoListItem(), x402ListItem()]);
    expect(parsed.map((item) => item.kind)).toEqual(["cardano", "x402"]);
  });

  it("rejects an item whose kind is neither rail", () => {
    expect(
      agentListItemSchema.safeParse({
        ...cardanoListItem(),
        kind: "solana",
      }).success,
    ).toBe(false);
  });
});
