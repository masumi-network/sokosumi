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

function createMockAgent(overrides: Partial<Agent> = {}): Agent {
  const now = new Date();

  return {
    id: `agent-${Math.random().toString(36).substring(7)}`,
    createdAt: now,
    updatedAt: now,
    blockchainIdentifier: `blockchain-${Math.random().toString(36).substring(7)}`,
    name: "Test Agent",
    overrideName: null,
    description: "Test description",
    overrideDescription: null,
    apiBaseUrl: "https://api.example.com",
    overrideApiBaseUrl: null,
    capabilityName: "test-capability",
    overrideCapabilityName: null,
    capabilityVersion: "1.0.0",
    overrideCapabilityVersion: null,
    authorName: "Test Author",
    overrideAuthorName: null,
    authorImage: null,
    overrideAuthorImage: null,
    authorContactEmail: null,
    overrideAuthorContactEmail: null,
    authorContactOther: null,
    overrideAuthorContactOther: null,
    authorOrganization: null,
    overrideAuthorOrganization: null,
    legalPrivacyPolicy: null,
    overrideLegalPrivacyPolicy: null,
    legalDpa: null,
    overrideLegalDpa: null,
    legalTerms: null,
    overrideLegalTerms: null,
    legalOther: null,
    overrideLegalOther: null,
    lastUptimeCheck: now,
    uptimeCount: 100,
    uptimeCheckCount: 100,
    image: "https://example.com/image.png",
    overrideImage: null,
    icon: null,
    metadataVersion: 1,
    paymentType: "WEB3_CARDANO_V1",
    pricingId: "pricing-1",
    status: "ONLINE",
    isShown: true,
    riskClassification: "MINIMAL",
    summary: null,
    ...overrides,
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
          overrideLegalDpa: "https://example.com/override-dpa.pdf",
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
      overrideTags: [{ name: "override-tag" }],
    };

    expect(getAgentTagsFromAgent(agent)).toEqual(["override-tag"]);
  });

  it("falls back to default tags when overrides are absent", () => {
    const agent = {
      tags: [{ name: "base-tag" }],
      overrideTags: [],
    };

    expect(getAgentTagsFromAgent(agent)).toEqual(["base-tag"]);
  });
});

describe("getAgentExampleOutputsFromAgent", () => {
  it("prefers override example outputs when present", () => {
    const now = new Date("2026-03-17T10:00:00.000Z");
    const agent = {
      exampleOutput: [
        {
          id: "example_base",
          createdAt: now,
          updatedAt: now,
          name: "Base output",
          mimeType: "image/png",
          url: "https://example.com/base.png",
          agentId: "agent_123",
          agentIdOverride: null,
        },
      ],
      overrideExampleOutput: [
        {
          id: "example_override",
          createdAt: now,
          updatedAt: now,
          name: "Override output",
          mimeType: "image/png",
          url: "https://example.com/override.png",
          agentId: null,
          agentIdOverride: "agent_123",
        },
      ],
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
