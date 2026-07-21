import type { Agent } from "@sokosumi/database";
import { RiskClassification } from "@sokosumi/database";
import { describe, expect, it } from "vitest";

import {
  agentDetailSchema,
  agentLegalSchema,
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
