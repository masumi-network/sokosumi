import type { AgentWithCategories } from "@sokosumi/utils";
import { describe, expect, it } from "vitest";

import { getAgentLegal } from "@/lib/helpers/agent";

function createMockAgent(
  overrides: Partial<AgentWithCategories> = {},
): AgentWithCategories {
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
    demoInput: null,
    demoOutput: null,
    categories: [],
    ...overrides,
  };
}

describe("getAgentLegal", () => {
  it("returns legal data when DPA is the only legal link", () => {
    const legal = getAgentLegal(
      createMockAgent({
        legalDpa: "https://example.com/dpa.pdf",
      }),
    );

    expect(legal).toEqual({
      privacyPolicy: null,
      terms: null,
      dpa: "https://example.com/dpa.pdf",
      other: null,
    });
  });

  it("prefers override DPA over the base DPA", () => {
    const legal = getAgentLegal(
      createMockAgent({
        legalDpa: "https://example.com/dpa.pdf",
        overrideLegalDpa: "https://example.com/override-dpa.pdf",
      }),
    );

    expect(legal?.dpa).toBe("https://example.com/override-dpa.pdf");
  });

  it("keeps existing legal behavior when DPA is absent", () => {
    const legal = getAgentLegal(
      createMockAgent({
        legalTerms: "https://example.com/terms",
        legalPrivacyPolicy: "https://example.com/privacy",
        legalOther: "https://example.com/legal",
      }),
    );

    expect(legal).toEqual({
      privacyPolicy: "https://example.com/privacy",
      terms: "https://example.com/terms",
      dpa: null,
      other: "https://example.com/legal",
    });
  });
});
