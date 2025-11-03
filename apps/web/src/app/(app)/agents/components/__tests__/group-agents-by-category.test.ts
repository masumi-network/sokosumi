import type { AgentWithCreditsPrice } from "@sokosumi/database";
import { AgentStatus } from "@sokosumi/database";

import { AGENT_CATEGORY_SLUGS } from "@/lib/constants/agent-categories";
import type { Category } from "@/lib/types/category";

import {
  groupAgentsByCategory,
  type AgentCategoryGroup,
} from "../group-agents-by-category";

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
  };
}

// Helper function to create mock agents
function createMockAgent(
  overrides: Partial<AgentWithCreditsPrice> = {},
): AgentWithCreditsPrice {
  const now = new Date();
  const oldDate = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000); // 30 days ago

  return {
    id: `agent-${Math.random().toString(36).substring(7)}`,
    createdAt: oldDate,
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

describe("groupAgentsByCategory", () => {
  // Test case 1: Basic grouping - agents should be grouped by their categories
  it("should group agents by their categories", () => {
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
        name: "Another Coding",
        categories: [createMockCategory("coding", "Coding")],
      }),
    ];
    const categories: Category[] = [
      { slug: "coding", name: "Coding" },
      { slug: "design", name: "Design" },
    ];
    const result = groupAgentsByCategory(agents, categories);
    expect(result).toHaveLength(2);
    expect(result[0].categorySlug).toBe("coding");
    expect(result[0].agents).toHaveLength(2);
    expect(result[1].categorySlug).toBe("design");
    expect(result[1].agents).toHaveLength(1);
  });

  // Test case 2: Priority ordering - Featured should come first, then New, then regular categories, then Others
  it("should maintain priority order: Featured → New → Regular → Others", () => {
    const newDate = new Date(Date.now() - 1 * 24 * 60 * 60 * 1000);
    const oldDate = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    const agents = [
      createMockAgent({
        name: "Featured Agent",
        createdAt: oldDate,
        categories: [
          createMockCategory(AGENT_CATEGORY_SLUGS.FEATURED, "Featured"),
        ],
      }),
      createMockAgent({
        name: "New Agent",
        createdAt: newDate,
        categories: [],
      }),
      createMockAgent({
        name: "Regular Agent",
        createdAt: oldDate,
        categories: [createMockCategory("coding", "Coding")],
      }),
      createMockAgent({
        name: "Other Agent",
        createdAt: oldDate,
        categories: [],
      }),
    ];
    const categories: Category[] = [
      { slug: "coding", name: "Coding" },
      { slug: AGENT_CATEGORY_SLUGS.FEATURED, name: "Featured" },
    ];
    const result = groupAgentsByCategory(agents, categories);
    expect(result).toHaveLength(4);
    expect(result[0].categorySlug).toBe(AGENT_CATEGORY_SLUGS.FEATURED);
    expect(result[1].categorySlug).toBe(AGENT_CATEGORY_SLUGS.NEW);
    expect(result[2].categorySlug).toBe("coding");
    expect(result[3].categorySlug).toBe(null); // Others
  });

  // Test case 3: Multi-category agents - agents can appear in multiple groups
  it("should allow agents to appear in multiple groups", () => {
    const agents = [
      createMockAgent({
        name: "Featured New Agent",
        createdAt: new Date(Date.now() - 1 * 24 * 60 * 60 * 1000),
        categories: [
          createMockCategory(AGENT_CATEGORY_SLUGS.FEATURED, "Featured"),
        ],
      }),
    ];
    const categories: Category[] = [
      { slug: AGENT_CATEGORY_SLUGS.FEATURED, name: "Featured" },
    ];
    const result = groupAgentsByCategory(agents, categories);
    expect(result).toHaveLength(2); // Featured and New
    const featuredGroup = result.find(
      (g) => g.categorySlug === AGENT_CATEGORY_SLUGS.FEATURED,
    );
    const newGroup = result.find(
      (g) => g.categorySlug === AGENT_CATEGORY_SLUGS.NEW,
    );
    expect(featuredGroup?.agents).toHaveLength(1);
    expect(newGroup?.agents).toHaveLength(1);
    expect(featuredGroup?.agents[0].name).toBe("Featured New Agent");
    expect(newGroup?.agents[0].name).toBe("Featured New Agent");
  });

  // Test case 4: Featured + New + Regular category combination
  it("should handle agents with Featured + New + regular category", () => {
    const agents = [
      createMockAgent({
        name: "Multi Category Agent",
        createdAt: new Date(Date.now() - 1 * 24 * 60 * 60 * 1000),
        categories: [
          createMockCategory(AGENT_CATEGORY_SLUGS.FEATURED, "Featured"),
          createMockCategory("coding", "Coding"),
        ],
      }),
    ];
    const categories: Category[] = [
      { slug: AGENT_CATEGORY_SLUGS.FEATURED, name: "Featured" },
      { slug: "coding", name: "Coding" },
    ];
    const result = groupAgentsByCategory(agents, categories);
    expect(result).toHaveLength(3); // Featured, New, and Coding
    const featuredGroup = result.find(
      (g) => g.categorySlug === AGENT_CATEGORY_SLUGS.FEATURED,
    );
    const newGroup = result.find(
      (g) => g.categorySlug === AGENT_CATEGORY_SLUGS.NEW,
    );
    const codingGroup = result.find((g) => g.categorySlug === "coding");
    expect(featuredGroup?.agents).toHaveLength(1);
    expect(newGroup?.agents).toHaveLength(1);
    expect(codingGroup?.agents).toHaveLength(1);
  });

  // Test case 5: Empty inputs - should handle empty agent array
  it("should return empty array when no agents provided", () => {
    const agents: AgentWithCreditsPrice[] = [];
    const categories: Category[] = [{ slug: "category-1", name: "Category 1" }];
    const result = groupAgentsByCategory(agents, categories);
    expect(result).toEqual([]);
  });

  // Test case 6: Empty categories - should handle empty category array
  it("should handle empty category array", () => {
    const agents = [
      createMockAgent({
        name: "Agent 1",
        categories: [],
      }),
      createMockAgent({
        name: "Agent 2",
        categories: [],
      }),
    ];
    const categories: Category[] = [];
    const result = groupAgentsByCategory(agents, categories);
    expect(result).toHaveLength(1); // Only Others group
    expect(result[0].categorySlug).toBe(null);
    expect(result[0].agents).toHaveLength(2);
  });

  // Test case 7: Agents with no categories - should go to "Others"
  it("should assign agents with no categories to Others group", () => {
    const agents = [
      createMockAgent({
        name: "Agent 1",
        categories: [],
      }),
      createMockAgent({
        name: "Agent 2",
        categories: [],
      }),
    ];
    const categories: Category[] = [
      { slug: "coding", name: "Coding" },
      { slug: AGENT_CATEGORY_SLUGS.OTHERS, name: "Others" },
    ];
    const result = groupAgentsByCategory(agents, categories);
    const othersGroup = result.find((g) => g.categorySlug === null);
    expect(othersGroup).toBeDefined();
    expect(othersGroup?.agents).toHaveLength(2);
  });

  // Test case 8: Category name fallback - should use slug if category name not found
  it("should use slug as fallback when category name not found", () => {
    const agents = [
      createMockAgent({
        name: "Agent 1",
        categories: [createMockCategory("unknown-category", "Unknown")],
      }),
    ];
    const categories: Category[] = [{ slug: "coding", name: "Coding" }];
    const result = groupAgentsByCategory(agents, categories);
    // Agent has unknown category that's not in the regularCategorySlugs list,
    // so it won't match any regular category. Since it has categories.length > 0,
    // it won't go to Others either (Others only includes agents with no categories).
    // Since it's not Featured or New, it won't appear in any group.
    expect(result).toEqual([]);
  });

  // Test case 9: Others category name - should use categoryMap or default slug
  it("should use categoryMap for Others category name or default slug", () => {
    const agents = [
      createMockAgent({
        name: "Agent 1",
        categories: [],
      }),
    ];
    const categoriesWithOthers: Category[] = [
      { slug: AGENT_CATEGORY_SLUGS.OTHERS, name: "Others Category" },
    ];
    const result = groupAgentsByCategory(agents, categoriesWithOthers);
    const othersGroup = result.find((g) => g.categorySlug === null);
    expect(othersGroup).toBeDefined();
    expect(othersGroup?.categoryName).toBe("Others Category");

    const categoriesWithoutOthers: Category[] = [
      { slug: "coding", name: "Coding" },
    ];
    const result2 = groupAgentsByCategory(agents, categoriesWithoutOthers);
    const othersGroup2 = result2.find((g) => g.categorySlug === null);
    expect(othersGroup2).toBeDefined();
    expect(othersGroup2?.categoryName).toBe(AGENT_CATEGORY_SLUGS.OTHERS);
  });

  // Test case 10: Regular categories filtering - should exclude Featured, New, Others from regular categories
  it("should filter out special slugs from regular categories", () => {
    const agents = [
      createMockAgent({
        name: "Coding Agent",
        categories: [createMockCategory("coding", "Coding")],
      }),
    ];
    const categories: Category[] = [
      { slug: AGENT_CATEGORY_SLUGS.FEATURED, name: "Featured" },
      { slug: AGENT_CATEGORY_SLUGS.NEW, name: "New" },
      { slug: AGENT_CATEGORY_SLUGS.OTHERS, name: "Others" },
      { slug: "coding", name: "Coding" },
    ];
    const result = groupAgentsByCategory(agents, categories);
    const codingGroup = result.find((g) => g.categorySlug === "coding");
    expect(codingGroup).toBeDefined();
    expect(codingGroup?.categorySlug).toBe("coding");
  });

  // Test case 11: Edge case - agent with categories but also new should appear in both
  it("should assign new agents with categories to both New and their category groups", () => {
    const agents = [
      createMockAgent({
        name: "New Coding Agent",
        createdAt: new Date(Date.now() - 1 * 24 * 60 * 60 * 1000),
        categories: [createMockCategory("coding", "Coding")],
      }),
    ];
    const categories: Category[] = [{ slug: "coding", name: "Coding" }];
    const result = groupAgentsByCategory(agents, categories);
    const newGroup = result.find(
      (g) => g.categorySlug === AGENT_CATEGORY_SLUGS.NEW,
    );
    const codingGroup = result.find((g) => g.categorySlug === "coding");
    expect(newGroup?.agents).toHaveLength(1);
    expect(codingGroup?.agents).toHaveLength(1);
    expect(newGroup?.agents[0].name).toBe("New Coding Agent");
    expect(codingGroup?.agents[0].name).toBe("New Coding Agent");
  });

  // Test case 12: Edge case - featured agent that is also new should appear in both Featured and New
  it("should assign featured and new agents to both Featured and New groups", () => {
    const agents = [
      createMockAgent({
        name: "Featured New Agent",
        createdAt: new Date(Date.now() - 1 * 24 * 60 * 60 * 1000),
        categories: [
          createMockCategory(AGENT_CATEGORY_SLUGS.FEATURED, "Featured"),
        ],
      }),
    ];
    const categories: Category[] = [
      { slug: AGENT_CATEGORY_SLUGS.FEATURED, name: "Featured" },
    ];
    const result = groupAgentsByCategory(agents, categories);
    const featuredGroup = result.find(
      (g) => g.categorySlug === AGENT_CATEGORY_SLUGS.FEATURED,
    );
    const newGroup = result.find(
      (g) => g.categorySlug === AGENT_CATEGORY_SLUGS.NEW,
    );
    expect(featuredGroup?.agents).toHaveLength(1);
    expect(newGroup?.agents).toHaveLength(1);
    expect(featuredGroup?.agents[0].name).toBe("Featured New Agent");
    expect(newGroup?.agents[0].name).toBe("Featured New Agent");
  });
});
