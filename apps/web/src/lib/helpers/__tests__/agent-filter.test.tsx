import type { AgentWithCreditsPrice } from "@sokosumi/database";
import { AgentStatus } from "@sokosumi/database";

import type { GalleryFilterState } from "@/hooks/use-gallery-filter";
import { SPECIAL_AGENT_CATEGORY_SLUGS } from "@/lib/constants/agent-categories";

import { filterAgents } from "../agent-filter";

// Helper function to create mock category
function createMockCategory(slug: string, name: string) {
  const now = new Date();
  return {
    id: `category-${Math.random().toString(36).substring(7)}`,
    createdAt: now,
    updatedAt: now,
    name,
    slug,
    description: null,
    image: null,
    styles: null,
    priority: 0,
  };
}

// Helper function to create mock agents
function createMockAgent(
  overrides: Partial<AgentWithCreditsPrice> = {},
): AgentWithCreditsPrice {
  const now = new Date();
  const oldDate = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000); // 30 days ago

  const createdAt = overrides.createdAt ?? oldDate;

  return {
    id: `agent-${Math.random().toString(36).substring(7)}`,
    createdAt,
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
    pricing: {
      id: "pricing-1",
      createdAt: now,
      updatedAt: now,
      pricingType: "FREE",
      agentFixedPricingId: null,
      fixedPricing: null,
    },
    status: AgentStatus.ONLINE,
    isShown: true,
    riskClassification: "MINIMAL",
    summary: null,
    demoInput: null,
    demoOutput: null,
    tags: [],
    overrideTags: [],
    categories: [],
    exampleOutput: [],
    overrideExampleOutput: [],
    userAgentRating: [],
    organizations: [],
    blacklistedOrganizations: [],
    creditsPrice: {
      cents: BigInt(0),
      includedFee: BigInt(0),
    },
    ...overrides,
  };
}

describe("filterAgents", () => {
  // Test case 1: No filters - should return all agents
  it("should return all agents when no query and no categories provided", () => {
    const agents = [
      createMockAgent({ name: "Agent 1" }),
      createMockAgent({ name: "Agent 2" }),
      createMockAgent({ name: "Agent 3" }),
    ];
    const filterState: GalleryFilterState = {
      query: "",
      categories: [],
    };
    const result = filterAgents(agents, filterState);
    expect(result).toEqual(agents);
  });

  // Test case 2: Query filtering - should filter by name
  it("should filter agents by name when query is provided", () => {
    const agents = [
      createMockAgent({ name: "Alpha Agent" }),
      createMockAgent({ name: "Beta Agent" }),
      createMockAgent({ name: "Gamma Agent" }),
    ];
    const filterState: GalleryFilterState = {
      query: "Alpha",
      categories: [],
    };
    const result = filterAgents(agents, filterState);
    expect(result).toHaveLength(1);
    expect(result[0].name).toBe("Alpha Agent");
  });

  // Test case 3: Query filtering - should filter by description
  it("should filter agents by description when query is provided", () => {
    const agents = [
      createMockAgent({
        name: "Agent 1",
        description: "This agent helps with coding",
      }),
      createMockAgent({
        name: "Agent 2",
        description: "This agent helps with design",
      }),
      createMockAgent({
        name: "Agent 3",
        description: "This agent helps with writing",
      }),
    ];
    const filterState: GalleryFilterState = {
      query: "coding",
      categories: [],
    };
    const result = filterAgents(agents, filterState);
    expect(result).toHaveLength(1);
    expect(result[0].name).toBe("Agent 1");
  });

  // Test case 4: Query filtering - should be case insensitive
  it("should perform case-insensitive query matching", () => {
    const agents = [
      createMockAgent({ name: "Alpha Agent" }),
      createMockAgent({ name: "BETA AGENT" }),
      createMockAgent({ name: "gamma agent" }),
    ];
    const filterState: GalleryFilterState = {
      query: "ALPHA",
      categories: [],
    };
    const result = filterAgents(agents, filterState);
    expect(result).toHaveLength(1);
    expect(result[0].name).toBe("Alpha Agent");
  });

  // Test case 5: Query filtering - should trim whitespace
  it("should trim whitespace from query before filtering", () => {
    const agents = [
      createMockAgent({ name: "Alpha Agent" }),
      createMockAgent({ name: "Beta Agent" }),
    ];
    const filterState: GalleryFilterState = {
      query: "  Alpha  ",
      categories: [],
    };
    const result = filterAgents(agents, filterState);
    expect(result).toHaveLength(1);
    expect(result[0].name).toBe("Alpha Agent");
  });

  // Test case 6: Category filtering - should filter by regular category slug
  it("should filter agents by regular category slug", () => {
    const agents = [
      createMockAgent({
        name: "Agent 1",
        categories: [createMockCategory("coding", "Coding")],
      }),
      createMockAgent({
        name: "Agent 2",
        categories: [createMockCategory("design", "Design")],
      }),
      createMockAgent({
        name: "Agent 3",
        categories: [createMockCategory("coding", "Coding")],
      }),
    ];
    const filterState: GalleryFilterState = {
      query: "",
      categories: ["coding"],
    };
    const result = filterAgents(agents, filterState);
    expect(result).toHaveLength(2);
    expect(result.map((a) => a.name)).toEqual(["Agent 1", "Agent 3"]);
  });

  // Test case 7: Category filtering - Featured category
  it("should filter agents by Featured category", () => {
    const agents = [
      createMockAgent({
        name: "Featured Agent",
        categories: [
          createMockCategory(SPECIAL_AGENT_CATEGORY_SLUGS.FEATURED, "Featured"),
        ],
      }),
      createMockAgent({
        name: "Regular Agent",
        categories: [createMockCategory("coding", "Coding")],
      }),
      createMockAgent({
        name: "Another Featured",
        categories: [
          createMockCategory(SPECIAL_AGENT_CATEGORY_SLUGS.FEATURED, "Featured"),
        ],
      }),
    ];
    const filterState: GalleryFilterState = {
      query: "",
      categories: [SPECIAL_AGENT_CATEGORY_SLUGS.FEATURED],
    };
    const result = filterAgents(agents, filterState);
    expect(result).toHaveLength(2);
    expect(result.map((a) => a.name)).toEqual([
      "Featured Agent",
      "Another Featured",
    ]);
  });

  // Test case 8: Category filtering - New category
  it("should filter agents by New category", () => {
    const agents = [
      createMockAgent({
        name: "New Agent",
        categories: [
          createMockCategory(SPECIAL_AGENT_CATEGORY_SLUGS.NEW, "New"),
        ],
      }),
      createMockAgent({
        name: "Old Agent",
        categories: [createMockCategory("coding", "Coding")],
      }),
      createMockAgent({
        name: "Another New",
        categories: [
          createMockCategory(SPECIAL_AGENT_CATEGORY_SLUGS.NEW, "New"),
        ],
      }),
    ];
    const filterState: GalleryFilterState = {
      query: "",
      categories: [SPECIAL_AGENT_CATEGORY_SLUGS.NEW],
    };
    const result = filterAgents(agents, filterState);
    expect(result).toHaveLength(2);
    expect(result.map((a) => a.name)).toEqual(["New Agent", "Another New"]);
  });

  // Test case 9: Category filtering - Others category
  it("should filter agents by Others category", () => {
    const oldDate = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000); // 30 days ago
    const agents = [
      createMockAgent({
        name: "Other Agent",
        createdAt: oldDate,
        categories: [
          createMockCategory(SPECIAL_AGENT_CATEGORY_SLUGS.DEFAULT, "Others"),
        ],
      }),
      createMockAgent({
        name: "Featured Agent",
        createdAt: oldDate,
        categories: [
          createMockCategory(SPECIAL_AGENT_CATEGORY_SLUGS.FEATURED, "Featured"),
        ],
      }),
      createMockAgent({
        name: "Categorized Agent",
        createdAt: oldDate,
        categories: [createMockCategory("coding", "Coding")],
      }),
      createMockAgent({
        name: "Another Other",
        createdAt: oldDate,
        categories: [
          createMockCategory(SPECIAL_AGENT_CATEGORY_SLUGS.DEFAULT, "Others"),
        ],
      }),
    ];
    const filterState: GalleryFilterState = {
      query: "",
      categories: [SPECIAL_AGENT_CATEGORY_SLUGS.DEFAULT],
    };
    const result = filterAgents(agents, filterState);
    expect(result).toHaveLength(2);
    expect(result.map((a) => a.name)).toEqual(["Other Agent", "Another Other"]);
  });

  // Test case 10: Multiple categories - should match any selected category
  it("should return agents matching any of the selected categories", () => {
    const agents = [
      createMockAgent({
        name: "Coding Agent",
        categories: [createMockCategory("coding", "Coding")],
      }),
      createMockAgent({
        name: "Design Agent",
        categories: [createMockCategory("design", "Design")],
      }),
      createMockAgent({
        name: "Writing Agent",
        categories: [createMockCategory("writing", "Writing")],
      }),
    ];
    const filterState: GalleryFilterState = {
      query: "",
      categories: ["coding", "design"],
    };
    const result = filterAgents(agents, filterState);
    expect(result).toHaveLength(2);
    expect(result.map((a) => a.name)).toEqual(["Coding Agent", "Design Agent"]);
  });

  // Test case 11: Combined query and category filtering
  it("should filter by both query and categories", () => {
    const agents = [
      createMockAgent({
        name: "Alpha Coding",
        description: "Coding helper",
        categories: [createMockCategory("coding", "Coding")],
      }),
      createMockAgent({
        name: "Beta Coding",
        description: "Another coding helper",
        categories: [createMockCategory("coding", "Coding")],
      }),
      createMockAgent({
        name: "Alpha Design",
        description: "Design helper",
        categories: [createMockCategory("design", "Design")],
      }),
    ];
    const filterState: GalleryFilterState = {
      query: "Alpha",
      categories: ["coding"],
    };
    const result = filterAgents(agents, filterState);
    expect(result).toHaveLength(1);
    expect(result[0].name).toBe("Alpha Coding");
  });

  // Test case 12: Empty query with categories - should only filter by categories
  it("should filter only by categories when query is empty", () => {
    const agents = [
      createMockAgent({
        name: "Agent 1",
        categories: [createMockCategory("coding", "Coding")],
      }),
      createMockAgent({
        name: "Agent 2",
        categories: [createMockCategory("design", "Design")],
      }),
      createMockAgent({
        name: "Agent 3",
        categories: [createMockCategory("coding", "Coding")],
      }),
    ];
    const filterState: GalleryFilterState = {
      query: "",
      categories: ["coding"],
    };
    const result = filterAgents(agents, filterState);
    expect(result).toHaveLength(2);
    expect(result.map((a) => a.name)).toEqual(["Agent 1", "Agent 3"]);
  });

  // Test case 13: Query with no categories - should only filter by query
  it("should filter only by query when no categories selected", () => {
    const agents = [
      createMockAgent({ name: "Alpha Agent" }),
      createMockAgent({ name: "Beta Agent" }),
      createMockAgent({ name: "Alpha Beta" }),
    ];
    const filterState: GalleryFilterState = {
      query: "Alpha",
      categories: [],
    };
    const result = filterAgents(agents, filterState);
    expect(result).toHaveLength(2);
    expect(result.map((a) => a.name)).toEqual(["Alpha Agent", "Alpha Beta"]);
  });

  // Test case 14: Featured agent should not appear in Others (they have different categories)
  it("should not return featured agents when filtering by Others", () => {
    const oldDate = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    const agents = [
      createMockAgent({
        name: "Featured Agent",
        createdAt: oldDate,
        categories: [
          createMockCategory(SPECIAL_AGENT_CATEGORY_SLUGS.FEATURED, "Featured"),
        ],
      }),
      createMockAgent({
        name: "Other Agent",
        createdAt: oldDate,
        categories: [
          createMockCategory(SPECIAL_AGENT_CATEGORY_SLUGS.DEFAULT, "Others"),
        ],
      }),
    ];
    const filterState: GalleryFilterState = {
      query: "",
      categories: [SPECIAL_AGENT_CATEGORY_SLUGS.DEFAULT],
    };
    const result = filterAgents(agents, filterState);
    expect(result).toHaveLength(1);
    expect(result[0].name).toBe("Other Agent");
  });

  // Test case 15: New agent should not appear in Others (they have different categories)
  it("should not return agents with different categories when filtering by Others", () => {
    const newDate = new Date(Date.now() - 1 * 24 * 60 * 60 * 1000);
    const oldDate = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    const agents = [
      createMockAgent({
        name: "New Agent",
        createdAt: newDate,
        categories: [
          createMockCategory(SPECIAL_AGENT_CATEGORY_SLUGS.NEW, "New"),
        ],
      }),
      createMockAgent({
        name: "Other Agent",
        createdAt: oldDate,
        categories: [
          createMockCategory(SPECIAL_AGENT_CATEGORY_SLUGS.DEFAULT, "Others"),
        ],
      }),
    ];
    const filterState: GalleryFilterState = {
      query: "",
      categories: [SPECIAL_AGENT_CATEGORY_SLUGS.DEFAULT],
    };
    const result = filterAgents(agents, filterState);
    expect(result).toHaveLength(1);
    expect(result[0].name).toBe("Other Agent");
  });

  // Test case 16: Agent with regular category should not appear when filtering by Others
  it("should not return agents with regular categories when filtering by Others", () => {
    const oldDate = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    const agents = [
      createMockAgent({
        name: "Categorized Agent",
        createdAt: oldDate,
        categories: [createMockCategory("coding", "Coding")],
      }),
      createMockAgent({
        name: "Other Agent",
        createdAt: oldDate,
        categories: [
          createMockCategory(SPECIAL_AGENT_CATEGORY_SLUGS.DEFAULT, "Others"),
        ],
      }),
    ];
    const filterState: GalleryFilterState = {
      query: "",
      categories: [SPECIAL_AGENT_CATEGORY_SLUGS.DEFAULT],
    };
    const result = filterAgents(agents, filterState);
    expect(result).toHaveLength(1);
    expect(result[0].name).toBe("Other Agent");
  });

  // Test case 17: Edge case - null description handling
  it("should handle agents with null description", () => {
    const agents = [
      createMockAgent({ name: "Agent 1", description: null }),
      createMockAgent({ name: "Agent 2", description: "Has description" }),
    ];
    const filterState: GalleryFilterState = {
      query: "Agent",
      categories: [],
    };
    const result = filterAgents(agents, filterState);
    expect(result).toHaveLength(2);
    expect(result.map((a) => a.name)).toEqual(["Agent 1", "Agent 2"]);
  });
});
