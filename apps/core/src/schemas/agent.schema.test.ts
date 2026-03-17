import type { Agent } from "@sokosumi/database";
import { describe, expect, it } from "vitest";

import { agentLegalSchema, getAgentLegalFromAgent } from "./agent.schema";

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
    demoInput: null,
    demoOutput: null,
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
